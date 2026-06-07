import {
	isDomCellRenderer,
	type ColumnDef,
	type InternalColumnDef,
	type ColumnRenderPlan,
	type ColumnRenderMode,
	type CompiledGridPlan,
} from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { IndexMapper } from './IndexMapper.js';

export class ColumnModel<TRowData = unknown> {
	private engine!: GridEngine<TRowData>;
	private columnMap = new Map<string, InternalColumnDef<TRowData>>();
	private displayedColumns: InternalColumnDef<TRowData>[] = [];
	private valueGetterDependents = new Map<string, string[]>();
	private indexMapper = new IndexMapper<string>();
	private defaultColWidth = 100;
	private columnPlans = new Map<string, ColumnRenderPlan<TRowData>>();
	private planVersion = 0;
	private compiledPlan: CompiledGridPlan<TRowData> | null = null;
	private compiledPlanPinLeft = -1;
	private compiledPlanPinRight = -1;
	private compiledPlanGeometryVersion = -1;

	public init(engine: GridEngine<TRowData>): void {
		this.engine = engine;
	}

	public updateColumns(columns: ColumnDef<TRowData>[], columnWidths: Record<string, number>, defaultColWidth?: number): void {
		if (defaultColWidth !== undefined) {
			this.defaultColWidth = defaultColWidth;
		}
		const normalizedColumns = columns.map((column) => this.normalizeColumn(column));
		this.columnMap.clear();
		this.valueGetterDependents.clear();
		this.indexMapper.setIds(normalizedColumns.map((column) => column.field));
		for (const column of normalizedColumns) {
			this.indexMapper.setVisible(column.field, column.hide !== true);
		}

		for (const col of normalizedColumns) {
			if (col.field) {
				this.columnMap.set(col.field, col);
				if (col.valueGetter && col.valueGetterDependencies) {
					for (const dependency of col.valueGetterDependencies) {
						const dependents = this.valueGetterDependents.get(dependency);
						if (dependents) {
							dependents.push(col.field);
						} else {
							this.valueGetterDependents.set(dependency, [col.field]);
						}
					}
				}
			}
		}

		const widths = this.getDisplayedColumns(normalizedColumns).map((col) => {
			const customWidth = columnWidths[col.field] ?? col.width;
			return customWidth !== undefined ? customWidth : this.defaultColWidth;
		});
		this.displayedColumns = normalizedColumns.filter((column) => column.hide !== true);

		this.engine.geometry.updateColumns(widths, this.defaultColWidth);
		this.engine.data.updateCompiledGetters(normalizedColumns);

		// Compute ColumnRenderPlans
		this.columnPlans.clear();
		for (const col of normalizedColumns) {
			if (col.field) {
				const hasValueGetter = !!col.valueGetter;
				const hasFormatter = !!(col as any).valueFormatter;
				const hasFormulaSupport = true;
				const capabilities = col.cellRendererCapabilities;
				const fallbackStrategy = col.cellRendererCapabilities?.scrollBehavior === 'fallback' ? 'cached' : 'blank';

				let mode: ColumnRenderMode = 'primitive';
				if (col.cellRenderer) {
					const scrollBehavior = col.cellRendererCapabilities?.scrollBehavior;
					if (scrollBehavior === 'live') {
						mode = 'custom-live';
					} else if (scrollBehavior === 'defer') {
						mode = 'custom-defer';
					} else if (scrollBehavior === 'fallback') {
						mode = 'custom-fallback';
					} else {
						mode = 'custom-skeleton';
					}
				} else if (hasValueGetter || hasFormatter) {
					mode = 'primitive-formatted';
				}

				const plan: ColumnRenderPlan<TRowData> = {
					colId: col.field,
					field: col.field,
					mode,
					hasValueGetter,
					hasFormatter,
					hasFormulaSupport,
					canUseCachedDisplayValue: hasValueGetter || hasFormulaSupport || !!col.cellRenderer,
					capabilities,
					fallbackStrategy,
					rendererType: col.cellRenderer,
				};

				this.columnPlans.set(col.field, plan);
			}
		}
		this.compiledPlan = null;
	}

	private normalizeColumn(column: ColumnDef<TRowData>): InternalColumnDef<TRowData> {
		if (!column.renderer) return column as InternalColumnDef<TRowData>;
		const renderer = column.renderer;
		if (renderer.kind === 'text') {
			return { ...column, cellRenderer: undefined, cellRendererCapabilities: undefined };
		}
		if (renderer.kind === 'dom') {
			return {
				...column,
				cellRenderer: renderer.renderer,
				cellRendererCapabilities: {
					...renderer.renderer.capabilities,
					...renderer.capabilities,
					scrollBehavior: renderer.capabilities?.scrollBehavior ?? 'live',
				},
			};
		}
		if (renderer.kind === 'imperativeReact') {
			return {
				...column,
				cellRenderer: renderer.component as InternalColumnDef<TRowData>['cellRenderer'],
				cellRendererCapabilities: {
					scrollBehavior: 'live',
					estimatedCost: 'cheap',
					...renderer.capabilities,
					imperativeUpdate: true,
				},
			};
		}
		return {
			...column,
			cellRenderer: renderer.component as InternalColumnDef<TRowData>['cellRenderer'],
			cellRendererCapabilities: {
				scrollBehavior: 'fallback',
				deferFallback: 'snapshot',
				estimatedCost: 'medium',
				...renderer.capabilities,
				imperativeUpdate: false,
			},
		};
	}

	public getCompiledPlan(): CompiledGridPlan<TRowData> {
		const pinLeftCount = Math.min(this.engine.viewport.pinLeftColumns, this.displayedColumns.length);
		const pinRightCount = Math.min(this.engine.viewport.pinRightColumns, Math.max(0, this.displayedColumns.length - pinLeftCount));
		const geometryVersion = this.engine.geometryVersion;
		if (
			this.compiledPlan &&
			this.compiledPlanPinLeft === pinLeftCount &&
			this.compiledPlanPinRight === pinRightCount &&
			this.compiledPlanGeometryVersion === geometryVersion
		) {
			return this.compiledPlan;
		}

		const displayedColumns = this.displayedColumns;
		const columnPlans = displayedColumns.map((column) => this.columnPlans.get(column.field)!);
		const totalWidth = this.engine.geometry.getTotalWidth(this.defaultColWidth);
		const colLefts = this.engine.geometry.colLefts.slice(0, displayedColumns.length);
		const colWidths = this.engine.geometry.colWidths.slice(0, displayedColumns.length);
		const pinRightStart = Math.max(pinLeftCount, displayedColumns.length - pinRightCount);
		const pinLeftWidth = pinLeftCount > 0 ? (colLefts[Math.min(pinLeftCount, displayedColumns.length)] ?? 0) : 0;
		const pinRightBaseLeft = pinRightStart < displayedColumns.length ? (colLefts[pinRightStart] ?? totalWidth) : totalWidth;
		const pinRightWidth = Math.max(0, totalWidth - pinRightBaseLeft);
		const next: CompiledGridPlan<TRowData> = {
			version: ++this.planVersion,
			columns: Array.from(this.columnMap.values()),
			displayedColumns,
			columnPlans,
			colFields: displayedColumns.map((column) => column.field),
			colWidths,
			colLefts,
			totalWidth,
			pinLeftCount,
			pinRightCount,
			pinRightStart,
			pinLeftWidth,
			pinRightWidth,
			pinRightBaseLeft,
			hasCustomRenderers: displayedColumns.some((column) => !!column.cellRenderer),
			hasDomRenderers: displayedColumns.some((column) => isDomCellRenderer(column.cellRenderer)),
			hasFormattedValues: columnPlans.some((plan) => plan.hasFormatter),
			hasValueGetters: columnPlans.some((plan) => plan.hasValueGetter),
		};
		this.compiledPlan = next;
		this.compiledPlanPinLeft = pinLeftCount;
		this.compiledPlanPinRight = pinRightCount;
		this.compiledPlanGeometryVersion = geometryVersion;
		return next;
	}

	public getCompiledPlanVersion(): number {
		// Return the current planVersion directly without triggering a rebuild.
		// getCompiledPlan() increments planVersion on every cache miss, so calling
		// it from getRenderStats() (polled every 250 ms) caused the counter to tick
		// up continuously even when nothing actually changed.
		return this.planVersion;
	}

	public getColumnPlan(colField: string): ColumnRenderPlan<TRowData> | undefined {
		return this.columnPlans.get(colField);
	}

	public getColumnPlans(): ColumnRenderPlan<TRowData>[] {
		return Array.from(this.columnPlans.values());
	}

	public getColumnIndex(colField: string): number {
		return this.indexMapper.idToVisualIndex(colField);
	}

	public getColumnField(colIdx: number): string | null {
		return this.indexMapper.visualIndexToId(colIdx);
	}

	public getPhysicalColumnIndex(colField: string): number {
		return this.indexMapper.idToPhysicalIndex(colField);
	}

	public getIndexMapper(): IndexMapper<string> {
		return this.indexMapper;
	}

	public getColumnDef(colField: string): ColumnDef<TRowData> | undefined {
		return this.columnMap.get(colField);
	}

	public getDisplayedColumns(columns?: ColumnDef<TRowData>[]): ColumnDef<TRowData>[] {
		if (!columns) return this.displayedColumns;
		const columnByField = new Map(columns.map((column) => [column.field, column]));
		return this.indexMapper
			.getVisibleIds()
			.map((field) => columnByField.get(field))
			.filter((column): column is ColumnDef<TRowData> => !!column);
	}

	public getDisplayedColumnCount(): number {
		return this.indexMapper.length;
	}

	public hasValueGetter(colField: string): boolean {
		return !!this.columnMap.get(colField)?.valueGetter;
	}

	public getValueGetterDependents(changedField: string): string[] {
		return this.valueGetterDependents.get(changedField) ?? [];
	}

	public getColLeft(colIdx: number): number {
		return this.engine.geometry.getColLeft(colIdx, this.defaultColWidth);
	}

	public getColWidth(colIdx: number): number {
		return this.engine.geometry.getColWidth(colIdx, this.defaultColWidth);
	}

	public getTotalWidth(): number {
		return this.engine.geometry.getTotalWidth(this.defaultColWidth);
	}
}

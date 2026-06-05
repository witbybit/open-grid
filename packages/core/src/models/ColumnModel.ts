import type { ColumnDef } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { IndexMapper } from './IndexMapper.js';

export class ColumnModel<TRowData = unknown> {
	private engine!: GridEngine<TRowData>;
	private columnMap = new Map<string, ColumnDef<TRowData>>();
	private displayedColumns: ColumnDef<TRowData>[] = [];
	private valueGetterDependents = new Map<string, string[]>();
	private indexMapper = new IndexMapper<string>();
	private defaultColWidth = 100;

	public init(engine: GridEngine<TRowData>): void {
		this.engine = engine;
	}

	public updateColumns(columns: ColumnDef<TRowData>[], columnWidths: Record<string, number>, defaultColWidth?: number): void {
		if (defaultColWidth !== undefined) {
			this.defaultColWidth = defaultColWidth;
		}
		this.columnMap.clear();
		this.valueGetterDependents.clear();
		this.indexMapper.setIds(columns.map((column) => column.field));
		for (const column of columns) {
			this.indexMapper.setVisible(column.field, column.hide !== true);
		}

		for (const col of columns) {
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

		const widths = this.getDisplayedColumns(columns).map((col) => {
			const customWidth = columnWidths[col.field] ?? col.width;
			return customWidth !== undefined ? customWidth : this.defaultColWidth;
		});
		this.displayedColumns = columns.filter((column) => column.hide !== true);

		this.engine.geometry.updateColumns(widths, this.defaultColWidth);
		this.engine.data.updateCompiledGetters(columns);
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

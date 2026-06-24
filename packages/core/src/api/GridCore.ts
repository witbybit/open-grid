import { GridKernel } from '../kernel/GridKernel.js';
import type { CellAddress } from '../domains/cells/CellAddress.js';
import { CellValueEngine } from '../domains/cells/CellValueEngine.js';
import type { CellDataPort } from '../domains/cells/CellValueEngine.js';
import { registerCellCommands } from '../domains/cells/CellCommands.js';
import type { ColumnDef } from '../domains/columns/ColumnDef.js';
import type { ColumnId } from '../domains/columns/ColumnId.js';
import { ColumnModel } from '../domains/columns/ColumnModel.js';
import { computeColumnLayout } from '../domains/columns/ColumnLayout.js';
import { registerColumnCommands } from '../domains/columns/ColumnCommands.js';
import { EditModel } from '../domains/editing/EditModel.js';
import { registerEditingCommands } from '../domains/editing/EditingCommands.js';
import { LayoutSnapshot } from '../domains/layout/LayoutSnapshot.js';
import { RowHeightModel } from '../domains/layout/RowHeightModel.js';
import { RowPipeline } from '../domains/pipeline/RowPipeline.js';
import { registerPipelineCommands } from '../domains/pipeline/PipelineCommands.js';
import type { VisualModelView } from '../domains/pipeline/VisualModel.js';
import type { VisualRow } from '../domains/pipeline/VisualRow.js';
import { buildRenderPlan } from '../domains/render/RenderPlan.js';
import type { RenderPlan } from '../domains/render/RenderPlan.js';
import type { RenderColumn, RenderDisplayConfig, RendererEngineView } from '../domains/render/RendererEngineView.js';
import { ClientRowModel } from '../domains/rows/client/ClientRowModel.js';
import { InfiniteRowModel } from '../domains/rows/infinite/InfiniteRowModel.js';
import { ServerRowModel } from '../domains/rows/server/ServerRowModel.js';
import { registerRowCommands } from '../domains/rows/RowCommands.js';
import type { GetRowId } from '../domains/rows/RowIdentity.js';
import type { RowId } from '../domains/rows/RowId.js';
import type { RowModelPlugin } from '../domains/rows/RowModelPlugin.js';
import type { RowModelType } from '../domains/rows/RowModelType.js';
import { SelectionModel } from '../domains/selection/SelectionModel.js';
import { registerSelectionCommands } from '../domains/selection/SelectionCommands.js';
import { createCellAddress } from '../domains/cells/CellAddress.js';
import { ViewportModel } from '../domains/viewport/ViewportModel.js';
import type { ViewportSnapshot } from '../domains/viewport/ViewportModel.js';
import type { VisibleWindow } from '../domains/viewport/VisibleWindow.js';

export interface GridCoreOptions<TRow> {
	readonly rowModelType?: RowModelType;
	readonly columns: readonly ColumnDef<TRow>[];
	readonly getRowId?: GetRowId<TRow>;
	readonly rowHeight?: number;
	readonly overscanPx?: number;
	readonly defaultColWidth?: number;
	readonly showGroupPanel?: boolean;
	readonly showFilterChipBar?: boolean;
	readonly showFloatingFilters?: boolean;
	readonly showStatusBar?: boolean;
	readonly enableColumnReorder?: boolean;
	readonly loading?: boolean;
}

/**
 * The private composition root (ARCHITECTURE.md §1, "Public API Direction"). Builds the kernel and
 * every domain, registers all commands, and owns the reactive glue that keeps the derived models
 * (pipeline → visual model → layout) in sync after each commit. The public {@link GridApi} is a thin
 * facade over this; nothing outside the core sees `GridCore` directly.
 */
export class GridCore<TRow> {
	readonly kernel = new GridKernel();
	readonly rowModel: RowModelPlugin<TRow>;
	readonly columnModel: ColumnModel<TRow>;
	readonly selectionModel = new SelectionModel();
	readonly editModel = new EditModel();
	readonly cellEngine: CellValueEngine<TRow>;
	readonly pipeline: RowPipeline<TRow>;
	readonly viewport: ViewportModel;

	private readonly rowHeights: RowHeightModel;
	private readonly disposers: Array<() => void> = [];
	private columnLayoutDirty = true;
	private cachedLayout: LayoutSnapshot | null = null;
	private readonly displayConfig: RenderDisplayConfig;

	constructor(options: GridCoreOptions<TRow>) {
		const type = options.rowModelType ?? 'client';
		this.rowModel = createRowModel<TRow>(type, options.getRowId);
		const clientModel = this.rowModel instanceof ClientRowModel ? this.rowModel : null;

		this.columnModel = new ColumnModel<TRow>(options.columns);
		// Client owns the full dataset → full-mode pipeline (filter/sort/group/tree). Infinite/server
		// are windowed: the pipeline projects the full logical height with loading rows in the gaps.
		this.pipeline =
			type === 'client'
				? new RowPipeline<TRow>(() => this.rowModel.query.getLoadedRows())
				: new RowPipeline<TRow>(() => this.rowModel.query.getLoadedRows(), {
						getTotalRowCount: () => this.rowModel.query.getRowCount(),
						getNodeByIndex: (index) => this.rowModel.query.getRowByIndex(index),
					});
		this.rowHeights = new RowHeightModel(0, options.rowHeight ?? 40);
		this.viewport = new ViewportModel(options.overscanPx ?? 0);
		this.displayConfig = {
			defaultRowHeight: options.rowHeight ?? 40,
			defaultColWidth: options.defaultColWidth ?? 150,
			showGroupPanel: options.showGroupPanel ?? false,
			showFilterChipBar: options.showFilterChipBar ?? false,
			showFloatingFilters: options.showFloatingFilters ?? false,
			showStatusBar: options.showStatusBar ?? false,
			enableColumnReorder: options.enableColumnReorder ?? false,
			loading: options.loading ?? false,
		};

		const port: CellDataPort<TRow> = {
			getRow: (id) => this.rowModel.query.getRowById(id),
			persist: (id, data) => {
				if (!clientModel) throw new Error('cell persistence requires a client row model');
				return clientModel.writeRowDataStructural(id, data);
			},
		};
		this.cellEngine = new CellValueEngine<TRow>(port, {
			getValueGetter: (columnId) => this.columnModel.getValueGetter(columnId),
			getValueFormatter: (columnId) => this.columnModel.getValueFormatter(columnId),
		});

		const resolveValueSetter = (columnId: ColumnId) => this.columnModel.getValueSetter(columnId);

		// Register every command on the single kernel gateway (R1).
		this.disposers.push(registerRowCommands(this.kernel, this.rowModel));
		this.disposers.push(registerCellCommands(this.kernel, this.rowModel, this.cellEngine, { resolveValueSetter }));
		this.disposers.push(registerColumnCommands(this.kernel, this.columnModel));
		this.disposers.push(registerPipelineCommands(this.kernel, this.pipeline));
		this.disposers.push(registerSelectionCommands(this.kernel, this.selectionModel));
		this.disposers.push(registerEditingCommands(this.kernel, this.rowModel, this.editModel, this.cellEngine, { resolveValueSetter }));

		// Reactive glue: keep derived models current after each commit (DERIVED only — never dispatches).
		this.disposers.push(
			this.kernel.subscribe((event) => {
				switch (event.type) {
					case 'rows.replaced':
					case 'rows.changed':
					case 'cells.changed':
						this.recomputePipeline();
						break;
					case 'pipeline.changed':
						this.syncRowCount();
						break;
					case 'columns.changed':
						this.columnLayoutDirty = true;
						break;
				}
			}),
		);

		this.recomputePipeline();
	}

	getVisualModel(): VisualModelView<TRow> {
		return this.pipeline.getVisualModel();
	}

	getVisualRowCount(): number {
		return this.pipeline.getVisualModel().count;
	}

	getLayoutSnapshot(): LayoutSnapshot {
		if (!this.cachedLayout || this.columnLayoutDirty) {
			this.cachedLayout = new LayoutSnapshot(this.rowHeights, computeColumnLayout(this.columnModel));
			this.columnLayoutDirty = false;
		}
		return this.cachedLayout;
	}

	getRenderPlan(): RenderPlan {
		const layout = this.getLayoutSnapshot();
		const window = this.viewport.getVisibleWindow(this.rowHeights);
		return buildRenderPlan(this.getVisualModel(), layout, window, {
			getField: (columnId) => this.columnModel.getField(columnId) ?? String(columnId),
			getCellValue: (rowId, field) => this.cellEngine.getDisplayValue(addressFor(rowId, field)),
		});
	}

	getCellValue(address: CellAddress): unknown {
		return this.cellEngine.getRawValue(address);
	}

	/** Header descriptors for the visible columns, enriched with layout + current sort direction. */
	getColumnHeaders(): RenderColumn[] {
		const layout = this.getLayoutSnapshot();
		const sort = this.pipeline.getSortModel();
		return layout.columns.entries.map((entry) => {
			const direction = sort.find((key) => key.columnId === entry.columnId)?.direction ?? null;
			return {
				columnId: entry.columnId,
				field: this.columnModel.getField(entry.columnId) ?? String(entry.columnId),
				header: this.columnModel.getHeader(entry.columnId),
				lane: entry.lane,
				left: entry.left,
				width: entry.width,
				sortable: this.columnModel.isSortable(entry.columnId),
				sortDirection: direction,
			};
		});
	}

	getVisualRow(index: number): VisualRow<TRow> | null {
		return this.pipeline.getVisualModel().getByVisualIndex(index);
	}

	getViewportSnapshot(): ViewportSnapshot {
		return this.viewport.getSnapshot();
	}

	getVisibleWindow(): VisibleWindow {
		return this.viewport.getVisibleWindow(this.rowHeights);
	}

	isRowSelected(rowId: RowId): boolean {
		return this.selectionModel.getState().selectedRowIds.has(rowId);
	}

	/**
	 * The clean read surface the DOM renderer consumes (ARCHITECTURE.md §3 R12). Assembles the
	 * engine's snapshots into one view so the renderer reads nothing of the engine's internals.
	 */
	getRendererView(): RendererEngineView<TRow> {
		return {
			getVisualRowCount: () => this.getVisualRowCount(),
			getVisualRow: (index) => this.getVisualRow(index),
			getVisualModel: () => this.getVisualModel(),
			getDisplayConfig: () => this.displayConfig,
			getGeometry: () => this.getLayoutSnapshot(),
			getColumns: () => this.getColumnHeaders(),
			getViewport: () => this.getViewportSnapshot(),
			getVisibleWindow: () => this.getVisibleWindow(),
			getCellDisplayValue: (rowId, field) => this.cellEngine.getDisplayValue(addressFor(rowId, field)),
			isRowSelected: (rowId) => this.isRowSelected(rowId),
			subscribe: (listener) => this.kernel.subscribe(listener),
			getVersion: (domain) => this.kernel.getVersion(domain),
		};
	}

	destroy(): void {
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		this.kernel.destroy();
	}

	private recomputePipeline(): void {
		this.pipeline.recompute();
		this.syncRowCount();
	}

	private syncRowCount(): void {
		this.rowHeights.setRowCount(this.pipeline.getVisualModel().count);
	}
}

function createRowModel<TRow>(type: RowModelType, getRowId?: GetRowId<TRow>): RowModelPlugin<TRow> {
	switch (type) {
		case 'client':
			return new ClientRowModel<TRow>(getRowId);
		case 'infinite':
			return new InfiniteRowModel<TRow>(getRowId);
		case 'server':
			return new ServerRowModel<TRow>(getRowId);
	}
}

function addressFor(rowId: RowId, field: string): CellAddress {
	// Only the field is used for a value read; the column id is irrelevant here so we reuse the field.
	return createCellAddress(rowId, field as unknown as ColumnId, field);
}

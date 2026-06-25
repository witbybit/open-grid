import { GridKernel } from '../kernel/GridKernel.js';
import type { GridCommand } from '../kernel/GridCommand.js';
import { SidebarStore } from '../sidebar/SidebarStore.js';
import { GridCapabilityManager } from '../plugins/GridCapabilityManager.js';
import type { GridCapability } from '../plugins/GridCapabilityManager.js';
import { DagEngine } from '../domains/dag/DagEngine.js';
import { SpreadsheetFillEngine } from '../domains/dag/SpreadsheetFillEngine.js';
import { StatusBarModel } from '../domains/statusbar/StatusBarModel.js';
import { PaginationModel } from '../domains/pagination/PaginationModel.js';
import { ChartOverlayController } from '../domains/chart/ChartOverlayController.js';
import type { PaginationConfig } from '../domains/pagination/PaginationModel.js';
import { DataIntegrityManager } from '../domains/integrity/DataIntegrityManager.js';
import { PersistenceController } from '../domains/persistence/PersistenceController.js';
import { GridWorkspaceController } from '../domains/persistence/GridWorkspaceController.js';
import { GridExportEngine } from '../domains/export/GridExportEngine.js';
import { ClipboardController } from '../domains/export/ClipboardController.js';
import type { GridWorkspaceAdapter } from '../domains/persistence/GridWorkspaceController.js';
import type { PersistenceAdapter } from '../domains/persistence/PersistenceAdapter.js';
import { createGridStateSnapshot, applyGridState } from '../domains/persistence/GridStateSchema.js';
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
	readonly persistenceAdapter?: PersistenceAdapter;
	readonly workspaceAdapter?: GridWorkspaceAdapter;
	/** Override the initial set of enabled capabilities. Defaults to the standard set. */
	readonly capabilities?: Iterable<GridCapability>;
	/** When provided, enables client-side pagination. */
	readonly pagination?: PaginationConfig;
}

/**
 * The private composition root (ARCHITECTURE.md §1, "Public API Direction"). Builds the kernel and
 * every domain, registers all commands, and owns the reactive glue that keeps the derived models
 * (pipeline → visual model → layout) in sync after each commit. The public {@link GridApi} is a thin
 * facade over this; nothing outside the core sees `GridCore` directly.
 */
export class GridCore<TRow> {
	readonly kernel = new GridKernel();
	readonly sidebar = new SidebarStore();
	readonly capabilities: GridCapabilityManager;
	readonly integrity: DataIntegrityManager<TRow>;
	readonly persistence: PersistenceController | null = null;
	readonly workspace: GridWorkspaceController | null = null;
	readonly rowModel: RowModelPlugin<TRow>;
	readonly columnModel: ColumnModel<TRow>;
	readonly selectionModel = new SelectionModel();
	readonly editModel = new EditModel();
	readonly cellEngine: CellValueEngine<TRow>;
	readonly pipeline: RowPipeline<TRow>;
	readonly viewport: ViewportModel;
	readonly exportEngine: GridExportEngine<TRow>;
	readonly clipboard: ClipboardController<TRow>;
	readonly dag: DagEngine<TRow>;
	readonly fill: SpreadsheetFillEngine;
	readonly statusBar: StatusBarModel<TRow>;
	readonly pagination: PaginationModel | null;
	readonly chart: ChartOverlayController<TRow>;

	private readonly rowHeights: RowHeightModel;
	private readonly disposers: Array<() => void> = [];
	private columnLayoutDirty = true;
	private cachedLayout: LayoutSnapshot | null = null;
	private readonly displayConfig: RenderDisplayConfig;

	constructor(options: GridCoreOptions<TRow>) {
		this.capabilities = new GridCapabilityManager(options.capabilities);
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

		// Export + clipboard
		this.exportEngine = new GridExportEngine<TRow>(
			() => this.getColumnHeaders(),
			(rowId, field) => this.cellEngine.getDisplayValue(addressFor(rowId, field)),
			() => this.pipeline.getVisualModel().toArray(),
		);
		this.clipboard = new ClipboardController<TRow>({
			getColumns: () => this.getColumnHeaders(),
			getCellValue: (rowId, field) => this.cellEngine.getDisplayValue(addressFor(rowId, field)),
			getVisualRows: () => this.pipeline.getVisualModel().toArray(),
			getSelection: () => this.selectionModel.getState(),
			getRow: (rowId) => this.rowModel.query.getRowById(rowId)?.data ?? null,
			dispatch: (cmd) => this.kernel.dispatch(cmd as GridCommand),
		});

		// DAG computed columns + fill engine
		this.dag = new DagEngine<TRow>();
		this.fill = new SpreadsheetFillEngine({
			getCellValue: (rowId, field) => this.cellEngine.getDisplayValue(addressFor(rowId, field)),
			setCellValue: (rowId, field, value) => {
				this.kernel.dispatch({ type: 'cell.setValue', payload: { address: addressFor(rowId, field), value } });
			},
			fieldForColumn: (columnId) => this.columnModel.getField(columnId) ?? null,
		});

		// Status bar — auto-subscribes to kernel events
		this.statusBar = new StatusBarModel<TRow>({
			getVisualRowCount: () => this.getVisualRowCount(),
			getTotalRowCount: () => this.rowModel.query.getRowCount(),
			getSelectedRowIds: () => this.selectionModel.getState().selectedRowIds,
			getLoadedRows: () => this.rowModel.query.getLoadedRows().map((n) => ({ id: n.id, data: n.data })),
			getCellValue: (rowId, field) => this.cellEngine.getDisplayValue(addressFor(rowId, field)),
			subscribeToKernel: (fn) => this.kernel.subscribe(fn),
		});
		this.disposers.push(this.statusBar.subscribeToKernel());

		// Pagination (optional)
		if (options.pagination) {
			const pg = new PaginationModel(options.pagination);
			(this as unknown as { pagination: PaginationModel }).pagination = pg;
		} else {
			(this as unknown as { pagination: null }).pagination = null;
		}

		// Chart overlay controller
		this.chart = new ChartOverlayController<TRow>(
			(rowId, field) => this.cellEngine.getDisplayValue(addressFor(rowId, field)),
			() => {
				const vm = this.pipeline.getVisualModel();
				const ids: RowId[] = [];
				for (let i = 0; i < vm.count; i++) {
					const row = vm.getByVisualIndex(i);
					if (row && (row.kind === 'data' || row.kind === 'tree')) ids.push(row.rowId as RowId);
				}
				return ids;
			},
		);

		// Data integrity manager — starts empty; consumers register validators after createGrid().
		this.integrity = new DataIntegrityManager<TRow>({
			getRowIds: () => this.rowModel.query.getLoadedRows().map((n) => n.id),
			getRow: (rowId) => this.rowModel.query.getRowById(rowId)?.data ?? null,
			getCellValue: (rowId, field) => this.cellEngine.getDisplayValue(addressFor(rowId, field)),
		});
		this.disposers.push(this.integrity.subscribeToKernel((listener) => this.kernel.subscribe(listener)));

		// Persistence + workspace (optional)
		const readPort = {
			getColumnState: () => this.columnModel.getState(),
			getSortModel: () => this.pipeline.getSortModel(),
			getFilterModel: () => this.pipeline.getFilterModel(),
			getGroupBy: () => this.pipeline.getGroupBy(),
			getSidebarOpenPanel: () => this.sidebar.getOpenPanel(),
		};
		const writePort = {
			setColumnState: (state: import('../domains/columns/ColumnState.js').ColumnState[]) =>
				this.kernel.dispatch({ type: 'columns.setState', payload: { state } }),
			setSortModel: (m: import('../domains/pipeline/PipelineModels.js').SortModel) =>
				this.kernel.dispatch({ type: 'pipeline.setSortModel', payload: { model: m } }),
			setFilterModel: (m: import('../domains/pipeline/PipelineModels.js').FilterModel) =>
				this.kernel.dispatch({ type: 'pipeline.setFilterModel', payload: { model: m } }),
			setGroupBy: (m: import('../domains/pipeline/GroupModel.js').GroupByModel) =>
				this.kernel.dispatch({ type: 'pipeline.setGroupBy', payload: { model: m } }),
			setSidebarOpenPanel: (id: string | null) =>
				id ? this.sidebar.openPanel(id) : this.sidebar.closePanel(),
		};

		if (options.persistenceAdapter) {
			const ctrl = new PersistenceController(options.persistenceAdapter, readPort, writePort);
			(this as unknown as { persistence: PersistenceController }).persistence = ctrl;
			this.disposers.push(ctrl.subscribeToKernel((listener) => this.kernel.subscribe(listener)));
			// Restore saved state immediately
			ctrl.loadAndApply();
		}

		if (options.workspaceAdapter) {
			const ctrl = new GridWorkspaceController(
				options.workspaceAdapter,
				() => createGridStateSnapshot(readPort),
				(state) => applyGridState(state, writePort),
			);
			(this as unknown as { workspace: GridWorkspaceController }).workspace = ctrl;
		}

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
			getFilterModel: () => this.pipeline.getFilterModel(),
			getGroupBy: () => this.pipeline.getGroupBy(),
			getCellIssue: (rowId, field) => this.integrity.getCellIssue(rowId, field),
			getCellDisplayValue: (rowId, field) => this.cellEngine.getDisplayValue(addressFor(rowId, field)),
			isRowSelected: (rowId) => this.isRowSelected(rowId),
			subscribe: (listener) => this.kernel.subscribe(listener),
			getVersion: (domain) => this.kernel.getVersion(domain),
			setScroll: (scrollTop, scrollLeft) => this.viewport.setScroll(scrollTop, scrollLeft),
			setSize: (width, height) => this.viewport.setSize(width, height),
		};
	}

	destroy(): void {
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		this.persistence?.destroy();
		this.workspace?.destroy();
		this.integrity.destroy();
		this.statusBar.destroy();
		this.pagination?.destroy();
		this.chart.destroy();
		this.sidebar.destroy();
		this.capabilities.destroy();
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

import type {
	FilterModel,
	SortModel,
	RowModel,
	ClientStructuralRowModel,
	InfiniteControllableRowModel,
	ServerPageControllableRowModel,
	RowExpansionStateReadableModel,
	RowModelCapability,
	RowModelCapabilities,
} from './rowModel.js';
import type { GridQueryModel } from './query/GridQueryModel.js';
import { evaluateQueryModel, createQueryEvaluationContext } from './query/evaluateQueryModel.js';
import {
	asClientStructuralRowModel,
	asRowExpansionStateReadableModel,
	asInfiniteControllableRowModel,
	asServerPageControllableRowModel,
	asCapableRowModel,
	UnsupportedRowModelOperationError,
} from './rowModel.js';
import type { GridDomainVersions } from './state/GridDomainVersions.js';
export type { RowModel, RowRefreshReason, RowModelRefreshResult } from './rowModel.js';
import type { InfiniteDatasource } from './infiniteRowModel.js';
import type { ServerDatasource, ServerPageState } from './serverPageRowModel.js';
import { ViewportController, type ViewportRange } from './viewportController.js';
import { GridEngine } from './engine/GridEngine.js';
import type { ClientRowModelRuntime, InfiniteRowModelRuntime, ServerPageRowModelRuntime } from './engine/runtimePorts.js';
import { createClientRowModelRuntime, createInfiniteRowModelRuntime, createServerPageRowModelRuntime } from './engine/createRowModelRuntimes.js';
import type { GridRuntimePorts, RuntimePortBinding, RuntimePortBindResult } from './engine/rendererPorts.js';
import { HEADLESS_PORTS } from './engine/rendererPorts.js';
import { type GridInstrumentation, NOOP_INSTRUMENTATION } from './diagnostics/GridInstrumentation.js';
import type { RenderStats } from './renderer/renderOrchestrator.js';
import { createRowsAccessor } from './rowsAccessor.js';
import type { AggregationDef } from './rows/stages/aggregateStage.js';
import { exportToCsv, type CsvExportOptions } from './export/csvExport.js';
import type { PersistenceStatus, PersistedGridState } from './persistence/statePersistence.js';
import type { GridViewDefinition, GridWorkspaceState, SaveViewOptions } from './workspace/workspaceTypes.js';
import { extractPersistedState, preparePersistedGridStateRestore, areRowHeightsEqual } from './persistence/statePersistence.js';
import { BUILT_IN_THEME_ORDER, getBuiltInTheme, isBuiltInThemeName, type BuiltInThemeName, type ThemeTokens } from './renderer/themes.js';

// ── Focused sub-modules — re-export so callers of store.ts continue to work ──
export { RowNode } from './rowNode.js';
export type { GridInsightLayer, GridInsightLayerId, GridInsightSeverity, GridCellDecoration, GridRowDecoration } from './insights/insightTypes.js';
export { GridInsightRegistry } from './insights/GridInsightRegistry.js';

export { isDomCellRenderer, getValueByPath, setValueByPath, compilePathGetter, validateColumns } from './columnDef.js';
export { compileStyleRules } from './styling/styleRules.js';
export type {
	CellCopyParams,
	CellPasteParams,
	ValueGetterParams,
	ValueSetterParams,
	CellRendererPhase,
	CellRendererCapabilities,
	ImperativeCellHandle,
	DomCellRendererParams,
	DomCellRendererHandle,
	DomCellRenderer,
	ColumnRendererSpec,
	ColumnRenderMode,
	ColumnRenderPlan,
	CompiledGridPlan,
	ColumnDef,
	InternalColumnDef,
	GridRowClassParams,
	GridCellClassParams,
	RowStyleRule,
	GroupRowStyleRule,
	DetailRowStyleRule,
	CellStyleRule,
	HeaderCellStyleRule,
	GridStyleRule,
} from './columnDef.js';
export type { FloatingFilterRendererParams } from './renderer/floatingFilterRenderer.js';

export {
	isDataVisualRow,
	isFullWidthVisualRow,
	isSelectableVisualRow,
	isEditableVisualRow,
	canEditCell,
	canFocusVisualRow,
	isDataCellSelectable,
} from './visualRow.js';
export type { DataVisualRow, GroupVisualRow, DetailVisualRow, FooterVisualRow, LoadingVisualRow, VisualRow } from './visualRow.js';

export type { PersistenceStatus };
export type { PersistedGridState as SerializableGridState } from './persistence/statePersistence.js';

// ── Extracted modules — re-export for backward compat ────────────────────────
export * from './api/GridApi.js';
export * from './api/GridEvents.js';
export type { GridInitialState, ColumnState, GridCellRangeBounds } from './state/GridState.js';
// ── Internal imports (for use by definitions in this file) ───────────────────
import { RowNode } from './rowNode.js';
import type { ColumnDef, GridStyleRule } from './columnDef.js';
import { validateColumns } from './columnDef.js';
import type { VisualRow } from './visualRow.js';
import type {
	CellSubscription,
	ActiveEditState,
	GridCellPointer,
	GridSelectionSource,
	GridCellAccess,
	CellState,
	GridPlugin,
	GridPluginController,
	GridPluginRuntime,
	GridRowsAccessor,
	GridWriteResult,
	RowDataTransaction,
	RowNodeTransaction,
	GridTransaction,
	RowSelectionGesture,
	RowSelectionChangeResult,
	SelectRowsOptions,
	SelectAllRowsOptions,
	InternalGridApi,
	GridApi,
	GridSnapshotKeyListener,
	GridSnapshotSelector,
	GridSnapshotSelectorEquality,
	GridSnapshotListener,
	GridStateSnapshot,
} from './api/GridApi.js';
import { createGridStateSnapshot } from './api/createGridStateSnapshot.js';
import type { InternalGridState, GridInitialState, ColumnState, RowModelType } from './state/GridState.js';
import type { GridEventPayloadMap, GridEventListener } from './api/GridEvents.js';
import { GridEventName } from './api/GridEvents.js';
import { GridPluginRegistry } from './plugins/GridPluginRegistry.js';
import { createGridPluginRuntime } from './plugins/createGridPluginRuntime.js';
import type { AutoSizeColumnOptions, AutoSizeAllColumnsOptions } from './features/ColumnAutoSizeController.js';
import { makeNoopIntegrityApi } from './features/dataIntegrity/noopIntegrityApi.js';

export { validateRowIds } from './ids.js';

// prettier-ignore
const _FALLBACK_CAPS: Record<RowModelType, RowModelCapabilities> = {
	infinite: { fullDataset: false, loadedDataset: true, pagedDataset: false, clientMutation: false, loadedRowMutation: true, pageRowMutation: false, transactions: false, rowOrder: false, blockLoading: true, serverPagination: false, clientSort: false, clientFilter: false, serverSort: true, serverFilter: true, clientGrouping: false, clientTree: false, aggregation: false, masterDetail: false, allRowSelection: false, loadedRowSelection: true, pageRowSelection: false },
	server:   { fullDataset: false, loadedDataset: false, pagedDataset: true, clientMutation: false, loadedRowMutation: false, pageRowMutation: true, transactions: false, rowOrder: false, blockLoading: false, serverPagination: true, clientSort: false, clientFilter: false, serverSort: true, serverFilter: true, clientGrouping: false, clientTree: false, aggregation: false, masterDetail: false, allRowSelection: false, loadedRowSelection: false, pageRowSelection: true },
	client:   { fullDataset: true, loadedDataset: false, pagedDataset: false, clientMutation: true, loadedRowMutation: false, pageRowMutation: false, transactions: true, rowOrder: true, blockLoading: false, serverPagination: false, clientSort: true, clientFilter: true, serverSort: false, serverFilter: false, clientGrouping: true, clientTree: true, aggregation: true, masterDetail: true, allRowSelection: true, loadedRowSelection: false, pageRowSelection: false },
};

const _EMPTY_WS_STATE: GridWorkspaceState = {
	views: [],
	activeViewId: null,
	defaultViewId: null,
	autoSaveEnabled: true,
	dirty: false,
	lastSavedAt: null,
	lastError: null,
	loading: false,
};

/**
 * Internal runtime composition root.
 *
 * This class is used by core implementation wiring and test fixtures.
 * The supported external surface is the frozen GridApi returned by createGrid().
 */
export class GridStore<TRowData = unknown> implements InternalGridApi<TRowData> {
	public engine: GridEngine<TRowData>;

	private readonly viewportController: ViewportController<TRowData>;
	private readonly pluginRuntime: GridPluginRuntime<TRowData>;
	private readonly pluginRegistry: GridPluginRegistry<TRowData>;

	private containerElement: HTMLElement | null = null;
	private rendererPorts: GridRuntimePorts = HEADLESS_PORTS;
	private instrumentation: GridInstrumentation = NOOP_INSTRUMENTATION;
	private portBindingGeneration = 0;
	private activeBindingGeneration: number | null = null;
	private storeDestroyed = false;
	private cachedStateSnapshotState: InternalGridState<TRowData> | null = null;
	private cachedStateSnapshot: GridStateSnapshot<TRowData> | null = null;

	constructor(
		initialState: Partial<GridInitialState<TRowData>> = {},
		engineOptions?: {
			capabilities?: import('./capabilities/capabilityTypes.js').GridCapabilitiesConfig<TRowData>;
			dataIntegrity?: import('./features/dataIntegrity/integrityTypes.js').GridDataIntegrityConfig<TRowData>;
		}
	) {
		validateColumns(initialState.columns || []);
		this.engine = new GridEngine<TRowData>({
			capabilities: engineOptions?.capabilities,
			dataIntegrity: engineOptions?.dataIntegrity,
			columns: initialState.columns || [],
			selection: initialState.selection,
			selectedRowIds: initialState.selectedRowIds ?? [],
			rowSelection: initialState.rowSelection,
			rowHeights: initialState.rowHeights || {},
			columnWidths: initialState.columnWidths || {},
			defaultRowHeight: initialState.defaultRowHeight || 40,
			defaultColWidth: initialState.defaultColWidth || 100,
			enableColumnReorder: initialState.enableColumnReorder ?? true,
			activeEdit: initialState.activeEdit || null,
			sortModel: initialState.sortModel || null,
			filterModel: initialState.filterModel || null,
			queryModel: initialState.queryModel || null,
			getRowId: initialState.getRowId,
			loading: initialState.loading,
			loadingSkeletonCount: initialState.loadingSkeletonCount,
			styleRules: initialState.styleRules,
			groupBy: initialState.groupBy,
			getParentId: initialState.getParentId,
			masterDetailEnabled: initialState.masterDetailEnabled,
			groupRowHeight: initialState.groupRowHeight,
			detailRowHeight: initialState.detailRowHeight,
			detailRenderer: initialState.detailRenderer,
			rowModelConfig: initialState.rowModelConfig,
			showGroupFooter: initialState.showGroupFooter,
			enableStickyGroupRows: initialState.enableStickyGroupRows,
			showGroupPanel: initialState.showGroupPanel,
			showFilterChipBar: initialState.showFilterChipBar,
			showFloatingFilters: initialState.showFloatingFilters,
			showStatusBar: initialState.showStatusBar,
			pagination: initialState.pagination,
			expansion: initialState.expansion,
			themeName: initialState.themeName,
			rowOverscanPx: initialState.rowOverscanPx ?? 400,
			colBuffer: initialState.colBuffer ?? 2,
			// Always normalize runtimeLimits so all callers can assume it exists.
			runtimeLimits: {
				maxRenderedRows: 500,
				maxRenderedCells: 20_000,
				suppressRenderedRangeLimit: false,
				...initialState.runtimeLimits,
			},
			overscanAdaptive: initialState.overscanAdaptive,
			getContainerElement: () => this.containerElement,
		});
		this.viewportController = new ViewportController<TRowData>(this.engine);
		this.pluginRuntime = createGridPluginRuntime(this as unknown as GridPluginRuntime<TRowData>);
		this.pluginRegistry = new GridPluginRegistry<TRowData>(this.pluginRuntime, this.engine.runtimeFaults);

		// Wire up the lazy api ref so integrity modules can call GridApi methods in rules
		this.engine.setApiRef(this as unknown as import('./api/GridApi.js').GridApi<TRowData>);
		this.integrity = this.engine.dataIntegrity?.buildApi() ?? makeNoopIntegrityApi<TRowData>();

		// Apply persisted pin counts at construction time before any renders occur
		if (initialState.pinnedColumns) {
			this.viewportController.pinLeftColumns = initialState.pinnedColumns.left ?? 0;
			this.viewportController.pinRightColumns = initialState.pinnedColumns.right ?? 0;
		}

		// Notify plugins of viewport shifts
		this.engine.subscribeToKey('visibleRowRange', () => {
			const range = this.state.visibleRowRange;
			this.pluginRegistry.notifyViewportChange(range);
		});
	}

	private get state(): InternalGridState<TRowData> {
		return this.engine.getState();
	}

	public getPluginController = (): GridPluginController<TRowData> => this.pluginRegistry;
	public getState = (): InternalGridState<TRowData> => this.engine.getState();

	public getStateSnapshot = (): GridStateSnapshot<TRowData> => {
		const currentState = this.state;
		if (this.cachedStateSnapshotState === currentState && this.cachedStateSnapshot) {
			return this.cachedStateSnapshot;
		}
		const snapshot = createGridStateSnapshot(currentState);
		this.cachedStateSnapshotState = currentState;
		this.cachedStateSnapshot = snapshot;
		return snapshot;
	};

	public getRowId = (row: TRowData): string => this.engine.getRowId(row);

	public isRowLoading = (rowId: string): boolean => this.engine.isRowLoading(rowId);

	public getCellValue = (rowId: string, colField: string): unknown => this.engine.getCellDisplayValue(rowId, colField);

	public getFormula = (rowId: string, colField: string): string | undefined => this.engine.getFormula(rowId, colField);
	public hasFormula = (rowId: string, colField: string): boolean => this.engine.hasFormula(rowId, colField);
	public setFormula = (rowId: string, colField: string, formula: string): void => {
		this.engine.setCellValue(rowId, colField, formula);
	};
	public clearFormula = (rowId: string, colField: string): void =>
		this.engine.syncFormulaForCell(rowId, colField, this.engine.getRawCellValue(rowId, colField));

	public getCachedDisplayValue = (rowId: string, colField: string): string | undefined => this.engine.getCachedDisplayValue(rowId, colField);

	public getCheapDisplayValue = (rowId: string, colField: string): string => this.engine.getCheapDisplayValue(rowId, colField);

	public getComputedCellValue = (rowId: string, colField: string): unknown => this.engine.getComputedCellValue(rowId, colField);

	public getRowOverscanPx = (): number => {
		return this.state.rowOverscanPx ?? 400;
	};

	public setRowOverscanPx = (px: number): void => {
		this.engine.setRowOverscanPx(px);
	};

	/**
	 * Updates a single cell value. Triggers valueSetter, undo history, and formula recalculation.
	 *
	 * For bulk mutations prefer `updateRows` (functional mapper) or `applyTransaction`
	 * (structured add/remove/update). Calling this in a loop fires O(N) individual
	 * invalidations instead of one coalesced batch.
	 */
	public setCellValue = (rowId: string, colField: string, value: unknown): GridWriteResult => this.engine.setCellValue(rowId, colField, value);

	/**
	 * Applies multiple cell value writes as a single atomic operation.
	 * valueSetter runs per-cell, but notifications, cellValueChanged events, and undo
	 * are coalesced — one RAF flush and one undo entry for the entire batch.
	 * Use this instead of looping setCellValue for paste, clear, and programmatic bulk edits.
	 */
	public batchCellValues = (
		updates: { rowId: string; colField: string; value: unknown }[],
		source: 'paste' | 'api' | 'fill' = 'api'
	): GridWriteResult => this.engine.batchCellValues(updates, source);

	public getCellState = (rowId: string, colField: string): CellState => {
		const computedValue = this.getCellValue(rowId, colField);
		const isEditing = this.state.activeEdit?.rowId === rowId && this.state.activeEdit?.colField === colField;

		let value = computedValue;
		if (this.engine.hasFormula(rowId, colField)) {
			value = this.engine.getFormula(rowId, colField);
		} else {
			value = this.engine.getRawCellValue(rowId, colField);
		}

		return {
			value,
			computedValue,
			isEditing,
		};
	};

	public selectCell = (pointer: GridCellPointer | null, source: GridSelectionSource = 'api'): void => {
		this.engine.selectRange(pointer, pointer, source);
	};

	public selectRange = (start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'api'): void => {
		this.engine.selectRange(start, end, source);
	};

	public extendSelection = (end: GridCellPointer, source: GridSelectionSource = 'api'): void => {
		const state = this.getState();
		this.engine.selectRange(state.selection.anchor ?? state.selection.focus ?? end, end, source);
	};

	public applyRowSelectionGesture = (gesture: RowSelectionGesture): RowSelectionChangeResult | null => {
		return this.engine.applyRowSelectionGesture(gesture);
	};

	public selectRows = (rowIds: string[], options?: SelectRowsOptions): void =>
		options?.mode === 'replace' ? this.engine.replaceRowIds(rowIds, 'api') : this.engine.selectRowIds(rowIds, 'api');

	public deselectRows = (rowIds: string[]): void => this.engine.deselectRowIds(rowIds, 'api');

	public toggleRowSelection = (rowId: string): void => this.engine.toggleRowId(rowId, 'api');

	public selectAllRows = (options?: SelectAllRowsOptions): void => this.engine.selectAllDataRows('api', options?.scope, options?.mode);

	public clearRowSelection = (): void => this.engine.clearRowSelection('api');

	public isRowNodeSelected = (rowId: string): boolean => {
		return this.state.selectedRowIds.includes(rowId);
	};

	public getSelectedRowCount = (): number => this.state.selectedRowIds.length;

	public getSelectedRowIds = (): string[] => this.state.selectedRowIds.slice();

	public setColumnWidth = (colField: string, width: number): void => this.engine.resizeColumn(colField, width);
	public autoSizeColumn = (colField: string, options?: AutoSizeColumnOptions): void => this.engine.autoSizeColumn(colField, options);
	public autoSizeAllColumns = (options?: AutoSizeAllColumnsOptions): void => this.engine.autoSizeAllColumns(options);
	public getColumnDistinctValues = (colField: string): (string | number | null)[] => this.engine.getColumnDistinctValues(colField);
	public copySelectedRange = (): Promise<void> => this.engine.copySelectedRange();
	public pasteFromClipboard = (): Promise<void> => this.engine.pasteFromClipboard();
	public copyRange = (minRow: number, maxRow: number, minCol: number, maxCol: number): Promise<void> =>
		this.engine.copyRange(minRow, maxRow, minCol, maxCol);
	public setColumnVisible = (colField: string, visible: boolean): void => this.setColumnsVisible([colField], visible);

	public setColumnsVisible = (colFields: string[], visible: boolean): void => {
		const fieldSet = new Set(colFields);
		if (fieldSet.size === 0) return;
		let changed = false;
		const columns = this.state.columns.map((column) => {
			if (!fieldSet.has(column.field) || column.hide === !visible) return column;
			changed = true;
			return { ...column, hide: !visible };
		});
		if (changed) {
			this.engine.setColumns(columns, false);
			// Clear filters for columns being hidden so stale filter state doesn't accumulate
			if (!visible && this.state.filterModel) {
				const newModel = { ...this.state.filterModel };
				let filterChanged = false;
				for (const field of fieldSet) {
					if (field in newModel) {
						delete newModel[field];
						filterChanged = true;
					}
				}
				if (filterChanged) {
					this.engine.setFilterModel(Object.keys(newModel).length > 0 ? newModel : null, false);
				}
			}
		}
	};

	public getColumns = (): ColumnDef<TRowData>[] => {
		return this.state.columns.slice();
	};

	public getDisplayedColumns = (): ColumnDef<TRowData>[] => this.engine.getDisplayedColumns();
	public setPinnedColumns = (pins: { left?: number; right?: number }): void => this.setViewportPins(pins);
	public getPinnedColumns = (): { left: number; right: number } => this.engine.getPinnedColumns();
	public moveColumn = (colField: string, toIndex: number): void => this.engine.moveColumn(colField, toIndex);
	public setColumnOrder = (colFields: string[]): void => this.engine.setColumnOrderByFields(colFields);
	public setColumnReorderEnabled = (enabled: boolean): void => this.engine.setColumnReorderEnabled(enabled);
	public setRowHeight = (rowId: string, height: number): void => this.engine.resizeRow(rowId, height);

	public setSortModel = (sortModel: SortModel | null): void => {
		this.engine.setSortModel(sortModel);
	};

	public setFilterModel = (filterModel: FilterModel | null): void => {
		this.engine.setFilterModel(filterModel);
	};

	public getQueryModel = (): GridQueryModel | null => {
		return this.state.queryModel ?? null;
	};

	public setQueryModel = (model: GridQueryModel | null): void => {
		this.engine.setQueryModel(model);
	};

	public clearQueryModel = (): void => {
		this.engine.setQueryModel(null);
	};

	public evaluateQueryForRow = (rowId: string): boolean => {
		const queryModel = this.state.queryModel;
		if (!queryModel) return true;
		const node = this.getRowNodeById(rowId);
		if (!node) return false;
		const ctx = createQueryEvaluationContext(this.state.columns);
		return evaluateQueryModel(queryModel, node, ctx);
	};

	public setGroupBy = (colIds: string[]): void => {
		this.engine.setGroupBy(colIds);
	};

	public getGroupBy = (): string[] => {
		return this.state.groupBy ?? [];
	};

	public addGroupBy = (colId: string, atIndex?: number): void => {
		this.engine.addGroupBy(colId, atIndex);
	};

	public removeGroupBy = (colId: string): void => {
		this.engine.removeGroupBy(colId);
	};

	public moveGroupBy = (colId: string, toIndex: number): void => {
		this.engine.moveGroupBy(colId, toIndex);
	};

	public setAggDefs = (defs: AggregationDef<TRowData>[]): void => {
		this.engine.setAggDefs(defs);
	};

	public getAggDefs = (): AggregationDef<TRowData>[] => {
		return this.state.aggDefs ?? [];
	};

	public expandAllGroups = (): void => {
		this.engine.groupingFeature.expandAllGroups();
	};

	public collapseAllGroups = (): void => {
		this.engine.groupingFeature.collapseAllGroups();
	};

	public setShowGroupFooter = (enabled: boolean): void => {
		this.engine.setShowGroupFooter(enabled);
	};

	public setStickyGroupRows = (enabled: boolean): void => {
		this.engine.setStickyGroupRows(enabled);
	};

	public setShowGroupPanel = (enabled: boolean): void => {
		this.engine.setShowGroupPanel(enabled);
	};

	public setShowFloatingFilters = (enabled: boolean): void => {
		this.engine.setShowFloatingFilters(enabled);
	};

	public setShowFilterChipBar = (enabled: boolean): void => {
		this.engine.setShowFilterChipBar(enabled);
	};

	public exportCsv = (options?: CsvExportOptions): void => {
		exportToCsv(this, options);
	};

	// All persistence methods are overridden by the private runtime composition root when an adapter is configured.
	public hasPersistence = (): boolean => false;
	public clearPersistedState = (): void => {};
	public setAutoSave = (_enabled: boolean): void => {};
	public isAutoSaveEnabled = (): boolean => true;
	public getPersistenceStatus = (): PersistenceStatus => ({ status: 'idle', autoSave: true });
	public subscribeToPersistenceStatus =
		(_listener: (status: PersistenceStatus) => void): (() => void) =>
		() => {};
	public saveNow = (): void => {};

	// All workspace methods are overridden by the composition root when a workspace adapter is configured.
	public hasWorkspace = (): boolean => false;
	public getWorkspaceState = (): GridWorkspaceState => _EMPTY_WS_STATE;
	public subscribeToWorkspaceState =
		(_listener: (state: GridWorkspaceState) => void): (() => void) =>
		() => {};
	public listViews = (): Promise<readonly GridViewDefinition[]> => Promise.resolve([]);
	public saveView = (_name: string, _options?: SaveViewOptions): Promise<GridViewDefinition> =>
		Promise.reject(new Error('[open-grid] No workspace adapter configured'));
	public updateView = (_id: string, _state?: PersistedGridState): Promise<void> => Promise.resolve();
	public applyView = (_id: string): Promise<void> => Promise.resolve();
	public deleteView = (_id: string): Promise<void> => Promise.resolve();
	public duplicateView = (_id: string, _name: string): Promise<GridViewDefinition> =>
		Promise.reject(new Error('[open-grid] No workspace adapter configured'));
	public renameView = (_id: string, _name: string): Promise<void> => Promise.resolve();
	public setDefaultView = (_id: string | null): Promise<void> => Promise.resolve();

	public openPanel = (panelId: string): void => {
		this.engine.setSidebarOpenPanel(panelId);
	};

	public closePanel = (): void => {
		this.engine.setSidebarOpenPanel(null);
	};

	public togglePanel = (panelId: string): void => {
		const current = this.state.sidebarOpenPanel;
		this.engine.setSidebarOpenPanel(current === panelId ? null : panelId);
	};

	public getOpenPanel = (): string | null => {
		return this.state.sidebarOpenPanel ?? null;
	};

	public openChart = (): void => {
		this.engine.setChartOpen(true);
	};

	public closeChart = (): void => {
		this.engine.setChartOpen(false);
	};

	public toggleChart = (): void => {
		this.engine.setChartOpen(!this.state.chartOpen);
	};

	public isChartOpen = (): boolean => {
		return this.state.chartOpen ?? false;
	};

	public setStyleRules = (styleRules: GridStyleRule<TRowData>[] | undefined): void => {
		this.engine.setStyleRules(styleRules);
	};

	public toggleGroupExpanded = (groupId: string): void => {
		this.engine.groupingFeature.toggleGroupExpanded(groupId);
	};

	public toggleDetailExpanded = (rowId: string): void => {
		this.engine.groupingFeature.toggleDetailExpanded(rowId);
	};

	public isGroupExpanded = (groupId: string): boolean => {
		return this.getExpansionStateReadableRowModel()?.isGroupExpanded(groupId) ?? false;
	};

	public isDetailExpanded = (rowId: string): boolean => {
		return this.getExpansionStateReadableRowModel()?.isDetailExpanded(rowId) ?? false;
	};

	public getVisualRow = (index: number): VisualRow<TRowData> | null => {
		return this.getRowModel()?.getVisualRow(index) ?? null;
	};

	public getVisualRowCount = (): number => {
		return this.getRowModel()?.getVisualRowCount() ?? 0;
	};

	public getVisualIndexById = (visualRowId: string): number | null => {
		const idx = this.getRowModel()?.getVisualIndexById(visualRowId);
		return idx !== undefined && idx >= 0 ? idx : null;
	};

	public getVisualIndexByRowId = (rowId: string): number | null => {
		const idx = this.getRowModel()?.getVisualIndexByRowId(rowId);
		return idx !== undefined && idx >= 0 ? idx : null;
	};

	public getRowNodeById = (rowId: string): RowNode<TRowData> | null => {
		return this.getRowModel()?.getRowNodeById(rowId) ?? null;
	};

	public getRawRowById = (rowId: string): TRowData | null => {
		return this.getRowModel()?.getRawRowById(rowId) ?? null;
	};

	public addEventListener = <K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	): (() => void) => {
		return this.engine.addEventListener(type, callback);
	};

	public dispatchEvent = <K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void => {
		this.engine.dispatchEvent(type, payload);
	};

	public startEditing = (rowId: string, colField: string): void => {
		this.engine.startEdit(rowId, colField);
	};

	public stopEditing = (cancel: boolean = false): void => {
		this.engine.stopEdit(cancel);
	};

	public commitEdit = async (rowId: string, colField: string, value: unknown): Promise<boolean> => {
		return this.engine.editingFeature.commitEdit(rowId, colField, value);
	};

	// ── Data Integrity API ─────────────────────────────────────────────────────
	public integrity!: import('./features/dataIntegrity/integrityTypes.js').GridIntegrityApi<TRowData>;

	public can = (
		action: import('./capabilities/capabilityTypes.js').GridCapabilityAction,
		params: Partial<import('./capabilities/capabilityTypes.js').GridCapabilityParams<TRowData>> = {}
	): import('./capabilities/capabilityTypes.js').GridCapabilityResult => this.engine.capabilityManager.can(action, params);

	public canEdit = (rowId: string, colField: string): boolean => this.engine.capabilityManager.can('edit', { rowId, colField }).allowed;

	public canCopy = (rowId?: string, colField?: string): boolean => this.engine.capabilityManager.can('copy', { rowId, colField }).allowed;

	public canPaste = (rowId?: string, colField?: string): boolean => this.engine.capabilityManager.can('paste', { rowId, colField }).allowed;

	public canExport = (colField?: string): boolean => this.engine.capabilityManager.can('export', { colField }).allowed;

	public getColumnState = (): ColumnState[] => {
		return this.engine.columnFeature.getColumnState();
	};
	public applyColumnState = (states: ColumnState[], opts?: { applyOrder?: boolean }): void => {
		this.engine.columnFeature.applyColumnState(states, opts);

		if (states.some((s) => s.sort !== undefined)) {
			const sorted = states.filter((s) => s.sort != null).sort((a, b) => (a.sortIndex ?? 999) - (b.sortIndex ?? 999));
			this.engine.setSortModel(sorted.length ? sorted.map((s) => ({ colId: s.field, sort: s.sort! })) : null);
		}

		if (states.some((s) => s.pinned !== undefined)) {
			const left = states.filter((s) => s.pinned === 'left').length;
			const right = states.filter((s) => s.pinned === 'right').length;
			this.setViewportPins({ left, right });
		}
	};
	public getGridState = (): PersistedGridState => {
		return extractPersistedState(this.engine.getState());
	};
	public applyGridState = (state: PersistedGridState): void => {
		const prepared = preparePersistedGridStateRestore(state, this.engine.getState());
		if (!prepared.ok) {
			this.reportRuntimeFault({
				source: 'persistence',
				operation: 'applyGridState',
				error: new Error(prepared.reason),
				context: { persistedStateVersion: (state as { v?: unknown }).v },
			});
			return;
		}

		const result = this.engine.changeApplier.commit({
			reason: 'persistence:restore',
			state: prepared.restore.stateMutation,
			domains: ['columns', 'rows'],
			invalidations: [{ kind: 'full', reason: 'set data' }],
			historyPolicy: 'suppress',
			requestRender: true,
		});

		if (result.status === 'committed') {
			this.engine.commandHistory.clear();
		} else if (result.status !== 'noop') {
			this.reportRuntimeFault({
				source: 'persistence',
				operation: 'applyGridState',
				error: new Error(result.status === 'rejected' ? result.reason : 'persistence restore commit failed'),
				context: { persistedStateVersion: (state as { v?: unknown }).v },
			});
		}
	};

	public registerRowModel = (rowModel: RowModel<TRowData>): void => {
		this.engine.registerRowModel(rowModel);
	};

	public getRowModel = (): RowModel<TRowData> | null => {
		return this.engine.getRowModel();
	};

	private getClientStructuralRowModel(): ClientStructuralRowModel<TRowData> | null {
		return asClientStructuralRowModel(this.getRowModel());
	}

	private getInfiniteControllableRowModel(): InfiniteControllableRowModel<TRowData> | null {
		return asInfiniteControllableRowModel(this.getRowModel());
	}

	private getServerPageControllableRowModel(): ServerPageControllableRowModel<TRowData> | null {
		return asServerPageControllableRowModel(this.getRowModel());
	}

	private getExpansionStateReadableRowModel(): RowExpansionStateReadableModel | null {
		return asRowExpansionStateReadableModel(this.getRowModel());
	}

	private assertInfiniteRowModel(op: string): InfiniteControllableRowModel<TRowData> {
		const m = this.getInfiniteControllableRowModel();
		if (!m)
			throw new UnsupportedRowModelOperationError({ operation: op, rowModelType: this.getRowModelType(), supportedRowModels: ['infinite'] });
		return m;
	}

	private assertServerPageRowModel(op: string): ServerPageControllableRowModel<TRowData> {
		const m = this.getServerPageControllableRowModel();
		if (!m) throw new UnsupportedRowModelOperationError({ operation: op, rowModelType: this.getRowModelType(), supportedRowModels: ['server'] });
		return m;
	}

	private assertClientStructuralRowModel(op: string): ClientStructuralRowModel<TRowData> {
		const m = this.getClientStructuralRowModel();
		if (!m) throw new UnsupportedRowModelOperationError({ operation: op, rowModelType: this.getRowModelType(), supportedRowModels: ['client'] });
		return m;
	}

	public getClientRowModelRuntime = (): ClientRowModelRuntime<TRowData> => createClientRowModelRuntime(this);
	public getInfiniteRowModelRuntime = (): InfiniteRowModelRuntime<TRowData> => createInfiniteRowModelRuntime(this);
	public getServerPageRowModelRuntime = (): ServerPageRowModelRuntime<TRowData> => createServerPageRowModelRuntime(this);

	public getDataRowAtVisualIndex = (index: number): TRowData | null => {
		const vr = this.getVisualRow(index);
		return vr?.kind === 'data' ? vr.node.data : null;
	};

	public getDataRowNodeAtVisualIndex = (index: number): RowNode<TRowData> | null => {
		const vr = this.getVisualRow(index);
		return vr?.kind === 'data' ? vr.node : null;
	};

	public rows = (): GridRowsAccessor<TRowData> => {
		return createRowsAccessor(this);
	};

	public setRows = (rows: TRowData[]): void => {
		this.assertClientStructuralRowModel('setRows');
		this.engine.replaceRows(rows);
	};

	public getRowOrder = (): string[] => this.getClientStructuralRowModel()?.getRowOrder() ?? [];
	public setRowOrder = (rowIds: string[]): void => {
		this.engine.setRowOrder(rowIds);
	};

	public updateRows = (updater: (rows: TRowData[]) => TRowData[]): void => {
		this.assertClientStructuralRowModel('updateRows');
		this.engine.updateRows(updater);
	};

	public applyTransaction = (transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData> | null => {
		return this.engine.applyTransaction(transaction);
	};

	public transaction = (transaction: GridTransaction<TRowData>): RowNodeTransaction<TRowData> | null => {
		let rowResult: RowNodeTransaction<TRowData> | null = null;
		this.engine.batch(() => {
			if (transaction.columns) {
				this.setColumns(transaction.columns);
			}
			if (transaction.rows) {
				this.setRows(transaction.rows);
			}
			if (transaction.rowTransaction) {
				rowResult = this.applyTransaction(transaction.rowTransaction);
			}
			if ('sortModel' in transaction) {
				this.setSortModel(transaction.sortModel ?? null);
			}
			if ('filterModel' in transaction) {
				this.setFilterModel(transaction.filterModel ?? null);
			}
			if (transaction.pins) {
				this.setViewportPins(transaction.pins);
			}
		});
		return rowResult;
	};

	public refreshRows = (): void => {
		this.getRowModel()?.refresh();
	};

	public setRowHeights = (rowHeights: Record<string, number> | undefined): void => {
		const current = this.state.rowHeights;
		const next = rowHeights ?? {};
		if (areRowHeightsEqual(current, next)) return;
		this.engine.setRowHeights(next);
	};

	public setDefaultRowHeight = (defaultRowHeight?: number | undefined): void => {
		if (defaultRowHeight === undefined) return;
		if (this.state.defaultRowHeight === defaultRowHeight) return;
		this.engine.setDefaultRowHeight(defaultRowHeight);
	};

	public getRowModelType = (): RowModelType => {
		const rowModel = this.getRowModel();
		if (asServerPageControllableRowModel(rowModel)) return 'server';
		if (asInfiniteControllableRowModel(rowModel)) return 'infinite';
		return 'client';
	};

	public getRowModelCapabilities = (): RowModelCapabilities => {
		const capable = asCapableRowModel(this.getRowModel());
		return capable ? capable.getCapabilities() : _FALLBACK_CAPS[this.getRowModelType()];
	};

	public supportsRowModelCapability = (capability: RowModelCapability): boolean => {
		return this.getRowModelCapabilities()[capability] === true;
	};

	public purgeCache = (): void => {
		this.assertInfiniteRowModel('purgeCache').purgeCache();
	};

	public setInfiniteDatasource = (datasource: InfiniteDatasource<TRowData>, blockSize?: number): void => {
		this.assertInfiniteRowModel('setInfiniteDatasource').setDatasource(datasource, blockSize);
	};

	public setServerPageDatasource = (datasource: ServerDatasource<TRowData>): void => {
		this.assertServerPageRowModel('setServerPageDatasource').setDatasource(datasource);
	};

	public goToServerPage = (page: number): void => {
		this.assertServerPageRowModel('goToServerPage').goToPage(page);
	};

	public setServerPageSize = (pageSize: number): void => {
		this.assertServerPageRowModel('setServerPageSize').setPageSize(pageSize);
	};

	public refreshServerPage = (reason?: string): void => {
		this.assertServerPageRowModel('refreshServerPage').reloadPage(reason);
	};

	public getServerPageState = (): ServerPageState | null => {
		return this.getServerPageControllableRowModel()?.getPageState() ?? null;
	};

	public nextServerPage = (): void => {
		const model = this.assertServerPageRowModel('nextServerPage');
		const state = model.getPageState();
		if (state.page < state.pageCount - 1) model.goToPage(state.page + 1);
	};

	public previousServerPage = (): void => {
		const model = this.assertServerPageRowModel('previousServerPage');
		const state = model.getPageState();
		if (state.page > 0) model.goToPage(state.page - 1);
	};

	public setViewportPins = (pins: { left?: number; right?: number; top?: number; bottom?: number }): void => {
		if (pins.left !== undefined) this.viewportController.pinLeftColumns = pins.left;
		if (pins.right !== undefined) this.viewportController.pinRightColumns = pins.right;
		if (pins.top !== undefined) this.viewportController.pinTopRows = pins.top;
		if (pins.bottom !== undefined) this.viewportController.pinBottomRows = pins.bottom;
		// Sync column pin counts into state so they can be subscribed to and persisted
		if (pins.left !== undefined || pins.right !== undefined) {
			this.engine.setPinnedColumnsState(this.viewportController.pinLeftColumns, this.viewportController.pinRightColumns);
		}
	};

	public setViewportSize = (width: number, height: number): boolean => {
		return this.viewportController.setViewportSize(width, height);
	};

	public setScrollPosition = (scrollTop: number, scrollLeft: number, timestamp?: number): boolean => {
		return this.viewportController.setScrollPosition(scrollTop, scrollLeft, timestamp);
	};

	public getScrollVelocity = (): { vx: number; vy: number } => {
		return this.viewportController.getVelocity();
	};

	public getVisibleRowRange = (): ViewportRange => {
		return this.viewportController.getVisibleRowRange();
	};

	public getVisibleColumnRange = (): { colStart: number; colEnd: number; total: number } => {
		const r = this.viewportController.getVisibleColumnRange();
		return { colStart: r.startIdx, colEnd: r.endIdx, total: this.engine.stateManager.getState().columns.length };
	};

	public updateVisibleRanges = (): boolean => {
		return this.viewportController.updateVisibleRanges();
	};

	public subscribe = (listener: GridSnapshotListener<TRowData>): (() => void) => {
		return this.engine.subscribe(() => listener(this.getStateSnapshot()));
	};

	public subscribeToKey = <K extends keyof GridStateSnapshot<TRowData>>(key: K, listener: GridSnapshotKeyListener<TRowData, K>): (() => void) => {
		return this.engine.subscribeToKey(key as string, () => listener(this.getStateSnapshot()[key]));
	};

	public subscribeToSnapshotSelector = <K extends keyof GridStateSnapshot<TRowData>, TValue>(
		keys: readonly K[],
		selector: GridSnapshotSelector<TRowData, TValue>,
		listener: (value: TValue) => void,
		isEqual: GridSnapshotSelectorEquality<TValue> = Object.is
	): (() => void) => {
		return this.engine.subscribeToSelector(keys as readonly string[], () => selector(this.getStateSnapshot()), listener, isEqual);
	};

	public subscribeToIntegrity = (listener: (integrity: InternalGridState<TRowData>['integrity']) => void): (() => void) => {
		return this.engine.subscribeToSelector(['integrity'], (state) => state.integrity, listener);
	};

	public subscribeToDomainVersions = (listener: (v: GridDomainVersions) => void): (() => void) => {
		return this.engine.subscribeToDomainVersions(listener);
	};

	public subscribeDomain = (domain: keyof GridDomainVersions, listener: (version: number) => void): (() => void) => {
		return this.engine.subscribeDomain(domain, listener);
	};

	public subscribeToViewport = (listener: GridSnapshotListener<TRowData>): (() => void) => {
		return this.subscribeSnapshotProjection(['visibleRowRange'], (state) => state.visibleRowRange, listener, areViewportRangesEqual);
	};

	public subscribeToSelection = (listener: GridSnapshotListener<TRowData>): (() => void) => {
		return this.subscribeSnapshotProjection(['selection'], (state) => state.selection, listener);
	};

	public subscribeToFocusedCell = (listener: GridSnapshotListener<TRowData>): (() => void) => {
		return this.subscribeSnapshotProjection(['selection'], (state) => state.selection.focus, listener, areCellPointersEqual);
	};

	public subscribeToEditingCell = (listener: GridSnapshotListener<TRowData>): (() => void) => {
		return this.subscribeSnapshotProjection(['activeEdit'], (state) => state.activeEdit, listener, areActiveEditsEqual);
	};

	public subscribeToCell = (rowId: string, colField: string, listener: () => void): (() => void) => {
		const sub: CellSubscription = { rowId, colField, onStoreChange: listener };
		this.registerCellSubscription(sub);
		return () => this.unregisterCellSubscription(sub);
	};

	public subscribeToRow = (rowId: string, listener: GridSnapshotListener<TRowData>): (() => void) => {
		return this.subscribeSnapshotProjection(
			['globalVersion', 'rowHeights'],
			() => this.getRowSubscriptionProjection(rowId),
			listener,
			areRowSubscriptionProjectionsEqual
		);
	};

	public subscribeToColumn = (colField: string, listener: GridSnapshotListener<TRowData>): (() => void) => {
		return this.subscribeSnapshotProjection(
			['columns', 'columnWidths', 'sortModel'],
			(state) => this.getColumnSubscriptionProjection(state, colField),
			listener,
			areColumnSubscriptionProjectionsEqual
		);
	};

	public subscribeToHeaders = (listener: GridSnapshotListener<TRowData>): (() => void) => {
		return this.subscribeSnapshotProjection(
			['columns', 'columnWidths', 'sortModel'],
			(state) => ({
				columns: state.columns,
				columnWidths: state.columnWidths,
				sortModel: state.sortModel,
			}),
			listener,
			areHeaderSubscriptionProjectionsEqual
		);
	};

	public triggerCellNotifications = (rowId: string): void => {
		for (const col of this.state.columns) {
			this.engine.notifyCellChange(rowId, col.field);
		}
	};

	public setColumns = (columns: ColumnDef<TRowData>[]): void => {
		validateColumns(columns);
		this.engine.setColumns(columns);
	};

	public getColumnIndex = (colField: string): number => this.engine.getColumnIndex(colField);

	public getColumnField = (colIndex: number): string | null => this.engine.getColumnField(colIndex);

	public getColumnDef = (colField: string): ColumnDef<TRowData> | undefined => this.engine.getColumnDef(colField);

	public getCellAccess = (rowId: string, colField: string): GridCellAccess<TRowData> | null => this.engine.cellAccess.getByPointer(rowId, colField);

	public registerCellSubscription = (sub: CellSubscription): void => this.engine.registerCellSubscription(sub);

	public unregisterCellSubscription = (sub: CellSubscription): void => this.engine.unregisterCellSubscription(sub);

	public updateCellSubscription = (sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void => {
		this.engine.updateCellSubscription(sub, oldRowId, oldColField, newRowId, newColField);
	};

	public get batchedUpdates(): boolean {
		return this.engine.batchedUpdates;
	}

	public set batchedUpdates(enabled: boolean) {
		this.engine.batchedUpdates = enabled;
	}

	public flushCellUpdatesSync = (): void => this.engine.flushCellUpdatesSync();
	public registerPlugin = (plugin: GridPlugin<TRowData>): void => this.pluginRegistry.registerPlugin(plugin);
	public unregisterPlugin = (name: string): void => this.pluginRegistry.unregisterPlugin(name);
	public getPlugin = <T = unknown>(name: string): T | null => this.pluginRegistry.getPlugin<T>(name);
	public undo = (): void => this.engine.undo();
	public redo = (): void => this.engine.redo();

	public canUndo = (): boolean => this.engine.commandHistory.canUndo();

	public canRedo = (): boolean => this.engine.commandHistory.canRedo();

	/** Bind live renderer and theme ports for an active host. Returns a binding token.
	 *  Rejects concurrent bindings — only one active host is allowed at a time. */
	public bindRuntimePorts = (ports: GridRuntimePorts): RuntimePortBindResult => {
		if (this.storeDestroyed) {
			return { ok: false, reason: 'destroyed' };
		}
		if (this.activeBindingGeneration !== null) {
			this.engine.runtimeFaults.report({
				source: 'store',
				operation: 'bindRuntimePorts',
				error: new Error('Attempted to bind runtime ports while a binding is already active. Unbind first.'),
			});
			return { ok: false, reason: 'already-bound' };
		}
		this.portBindingGeneration++;
		this.activeBindingGeneration = this.portBindingGeneration;
		this.rendererPorts = ports;
		const generation = this.portBindingGeneration;
		return { ok: true, binding: { generation } };
	};

	/** Unbind the active host and restore headless ports. Stale binding tokens report a fault and no-op. */
	public unbindRuntimePorts = (binding: RuntimePortBinding): void => {
		if (binding.generation !== this.activeBindingGeneration) {
			this.engine.runtimeFaults.report({
				source: 'store',
				operation: 'unbindRuntimePorts',
				error: new Error('Attempted to unbind with a stale or unrecognised binding token.'),
			});
			return;
		}
		this.activeBindingGeneration = null;
		this.rendererPorts = HEADLESS_PORTS;
	};

	/** Returns true if the binding token corresponds to the currently active host. */
	public isBindingCurrent = (binding: RuntimePortBinding): boolean => {
		return binding.generation === this.activeBindingGeneration;
	};

	public getInstrumentation = (): GridInstrumentation => this.instrumentation;
	public setInstrumentation = (inst: GridInstrumentation): void => {
		this.instrumentation = inst;
		this.engine.setInstrumentation(inst);
	};

	public getRenderStats = (): RenderStats => {
		const stats = this.rendererPorts.renderer.getStats();
		stats.compiledPlanVersion = this.engine.getCompiledPlanVersion();
		return stats;
	};

	public resetRenderStats = (): void => this.rendererPorts.renderer.resetStats();

	public getRuntimeFaults = () => this.engine.runtimeFaults.snapshot();

	public clearRuntimeFaults = (): void => this.engine.runtimeFaults.clear();

	public reportRuntimeFault = (fault: import('./diagnostics/RuntimeFaultReporter.js').RuntimeFaultInput) => this.engine.runtimeFaults.report(fault);

	public getTheme = (): ThemeTokens => this.rendererPorts.theme.getTheme();

	public getThemeName = (): BuiltInThemeName | null => {
		const portName = this.rendererPorts.theme.getThemeName();
		if (portName !== null) return portName;
		const themeName = this.state.themeName;
		return isBuiltInThemeName(themeName) ? themeName : null;
	};

	public getAvailableThemes = (): BuiltInThemeName[] => {
		const t = this.rendererPorts.theme.getAvailableThemes();
		return t.length > 0 ? t : BUILT_IN_THEME_ORDER.slice();
	};
	public switchTheme = (themeName: string): void => {
		if (!isBuiltInThemeName(themeName) || this.state.themeName === themeName) return;
		this.engine.setThemeName(themeName);
		this.rendererPorts.theme.switchTheme(themeName);
	};
	public mergeTheme = (partial: Partial<ThemeTokens>): void => this.rendererPorts.theme.mergeTheme(partial);
	public onThemeChange = (listener: (theme: ThemeTokens) => void): (() => void) => this.rendererPorts.theme.onThemeChange(listener);
	public setContainerElement = (c: HTMLElement): void => {
		this.containerElement = c;
	};
	public getContainerElement = (): HTMLElement | null => this.rendererPorts.renderer.getContainer();
	public getContainer = (): HTMLElement | null => this.rendererPorts.renderer.getContainer();

	public getInsightDiagnostics = (): Record<string, unknown> => this.engine.insights.getDiagnostics();

	private subscribeSnapshotProjection<TValue>(
		keys: readonly string[],
		selector: (state: InternalGridState<TRowData>) => TValue,
		listener: GridSnapshotListener<TRowData>,
		isEqual: (left: TValue, right: TValue) => boolean = Object.is
	): () => void {
		return this.engine.subscribeToSelector(keys, selector, () => listener(this.getStateSnapshot()), isEqual);
	}

	private getRowSubscriptionProjection(rowId: string) {
		const rowIndex = this.getVisualIndexByRowId(rowId);
		const visualRow = rowIndex === null ? null : this.getVisualRow(rowIndex);
		const visualRowId = visualRow?.id ?? null;
		return {
			rowVersion: this.engine.rowVersions.get(rowId) ?? 0,
			rowIndex,
			visualRowId,
			height: visualRowId ? (this.state.rowHeights[visualRowId] ?? visualRow?.height ?? this.state.defaultRowHeight) : null,
		};
	}

	private getColumnSubscriptionProjection(state: InternalGridState<TRowData>, colField: string) {
		const column = state.columns.find((candidate) => candidate.field === colField) ?? null;
		return {
			column,
			width: state.columnWidths[colField] ?? column?.width ?? state.defaultColWidth,
			sortEntry: state.sortModel?.find((entry) => entry.colId === colField) ?? null,
		};
	}

	public destroy = (): void => {
		this.storeDestroyed = true;
		this.pluginRegistry.destroy();
		this.engine.destroy();
	};
}

function areViewportRangesEqual(left: ViewportRange, right: ViewportRange): boolean {
	return left.startIdx === right.startIdx && left.endIdx === right.endIdx;
}

function areCellPointersEqual(left: GridCellPointer | null, right: GridCellPointer | null): boolean {
	return left === right || (!!left && !!right && left.rowId === right.rowId && left.colField === right.colField);
}

function areActiveEditsEqual(left: ActiveEditState | null, right: ActiveEditState | null): boolean {
	return (
		left === right ||
		(!!left &&
			!!right &&
			left.rowId === right.rowId &&
			left.colField === right.colField &&
			left.validationError === right.validationError)
	);
}

function areRowSubscriptionProjectionsEqual(
	left: { rowVersion: number; rowIndex: number | null; visualRowId: string | null; height: number | null },
	right: { rowVersion: number; rowIndex: number | null; visualRowId: string | null; height: number | null }
): boolean {
	return (
		left.rowVersion === right.rowVersion &&
		left.rowIndex === right.rowIndex &&
		left.visualRowId === right.visualRowId &&
		left.height === right.height
	);
}

function areColumnSubscriptionProjectionsEqual(
	left: { column: ColumnDef<any> | null; width: number; sortEntry: SortModel[number] | null },
	right: { column: ColumnDef<any> | null; width: number; sortEntry: SortModel[number] | null }
): boolean {
	return left.column === right.column && left.width === right.width && left.sortEntry === right.sortEntry;
}

function areHeaderSubscriptionProjectionsEqual(
	left: { columns: readonly ColumnDef<any>[]; columnWidths: Record<string, number>; sortModel: SortModel | null },
	right: { columns: readonly ColumnDef<any>[]; columnWidths: Record<string, number>; sortModel: SortModel | null }
): boolean {
	return left.columns === right.columns && left.columnWidths === right.columnWidths && left.sortModel === right.sortModel;
}

import type { FilterModel, SortModel, RowModel, RowRefreshReason, RowModelRefreshResult } from './rowModel.js';
export type { RowModel, RowRefreshReason, RowModelRefreshResult } from './rowModel.js';
import type { IGridDatasource } from './serverRowModel.js';
import { ViewportController, type ViewportRange } from './viewportController.js';
import { GridEngine } from './engine/GridEngine.js';
import type { ClientRowModelRuntime, ServerRowModelRuntime } from './engine/runtimePorts.js';
import { createClientRowModelRuntime, createServerRowModelRuntime } from './engine/createRowModelRuntimes.js';
import type { RenderStats } from './renderer/renderOrchestrator.js';
import { createEmptyRenderStats } from './renderer/renderOrchestrator.js';
import { createRowsAccessor } from './rowsAccessor.js';
import type { AggregationDef } from './rows/stages/aggregateStage.js';
import { exportToCsv, type CsvExportOptions } from './export/csvExport.js';
import type { PersistenceStatus, PersistedGridState } from './persistence/statePersistence.js';
import { extractPersistedState } from './persistence/statePersistence.js';

// ── Focused sub-modules — re-export so callers of store.ts continue to work ──
export { RowNode } from './rowNode.js';

export { isDomCellRenderer, getValueByPath, setValueByPath, compilePathGetter, validateColumns } from './columnDef.js';
export type {
	CellCopyParams,
	CellPasteParams,
	ValueGetterParams,
	ValueValidatorParams,
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
	GridStyleSlots,
} from './columnDef.js';

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
export * from './state/GridState.js';
// ── Internal imports (for use by definitions in this file) ───────────────────
import { RowNode } from './rowNode.js';
import type { ColumnDef, GridStyleSlots } from './columnDef.js';
import { validateColumns } from './columnDef.js';
import type { VisualRow } from './visualRow.js';
import type {
	CellSubscription,
	GridCellPointer,
	GridSelectionSource,
	GridCellAccess,
	CellState,
	GridPlugin,
	GridPluginController,
	GridPluginRuntime,
	GridRowsAccessor,
	RowDataTransaction,
	RowNodeTransaction,
	GridTransaction,
	RowSelectionGesture,
	RowSelectionChangeResult,
	InternalGridApi,
	GridApi,
} from './api/GridApi.js';
import type { GridState, GridStateUpdater, Listener, ColumnState } from './state/GridState.js';
import type { GridEventPayloadMap, GridEventListener } from './api/GridEvents.js';
import { GridEventName } from './api/GridEvents.js';
import { GridPluginRegistry } from './plugins/GridPluginRegistry.js';
import { createGridPluginRuntime } from './plugins/createGridPluginRuntime.js';

export { validateRowIds } from './ids.js';

export class GridStore<TRowData = unknown> implements InternalGridApi<TRowData> {
	public engine: GridEngine<TRowData>;

	private readonly viewportController: ViewportController<TRowData>;
	private readonly pluginRuntime: GridPluginRuntime<TRowData>;
	private readonly pluginRegistry: GridPluginRegistry<TRowData>;

	constructor(initialState: Partial<GridState<TRowData>> = {}) {
		validateColumns(initialState.columns || []);
		this.engine = new GridEngine<TRowData>({
			columns: initialState.columns || [],
			selection: initialState.selection,
			selectedRowIds: initialState.selectedRowIds ?? [],
			rowHeights: initialState.rowHeights || {},
			columnWidths: initialState.columnWidths || {},
			defaultRowHeight: initialState.defaultRowHeight || 40,
			defaultColWidth: initialState.defaultColWidth || 100,
			enableColumnReorder: initialState.enableColumnReorder ?? true,
			activeEdit: initialState.activeEdit || null,
			sortModel: initialState.sortModel || null,
			filterModel: initialState.filterModel || null,
			getRowId: initialState.getRowId,
			loading: initialState.loading,
			loadingSkeletonCount: initialState.loadingSkeletonCount,
			styleSlots: initialState.styleSlots,
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
			expansion: initialState.expansion,
			rowOverscanPx: initialState.rowOverscanPx ?? 400,
			colBuffer: initialState.colBuffer ?? 1,
			// Phase 2: always normalize runtimeLimits so all callers can assume it exists
			runtimeLimits: {
				maxRenderedRows: 500,
				maxRenderedCells: 20_000,
				suppressRenderedRangeLimit: false,
				...initialState.runtimeLimits,
			},
			overscanAdaptive: initialState.overscanAdaptive,
		});

		this.viewportController = new ViewportController<TRowData>(this.engine);
		this.pluginRuntime = createGridPluginRuntime(this as unknown as GridPluginRuntime<TRowData>);
		this.pluginRegistry = new GridPluginRegistry<TRowData>(this.pluginRuntime, this.engine.runtimeFaults);

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

	private get state(): GridState<TRowData> {
		return this.engine.getState();
	}

	private set state(val: GridState<TRowData>) {
		this.engine.setState(val);
	}

	public getPluginController = (): GridPluginController<TRowData> => this.pluginRegistry;

	public getState = (): GridState<TRowData> => this.engine.getState();

	public setState = (updater: GridStateUpdater<TRowData>): void => this.engine.setState(updater);

	public getRowId = (row: TRowData): string => this.engine.getRowId(row);

	public isRowLoading = (rowId: string): boolean => this.engine.isRowLoading(rowId);

	public getCellValue = (rowId: string, colField: string): unknown => this.engine.getCellDisplayValue(rowId, colField);

	public getCachedDisplayValue = (rowId: string, colField: string): string | undefined => this.engine.getCachedDisplayValue(rowId, colField);

	public getCheapDisplayValue = (rowId: string, colField: string): string => this.engine.getCheapDisplayValue(rowId, colField);

	public getComputedCellValue = (rowId: string, colField: string): unknown => this.engine.getComputedCellValue(rowId, colField);

	public getRowOverscanPx = (): number => {
		return this.state.rowOverscanPx ?? 400;
	};

	public setRowOverscanPx = (px: number): void => {
		this.setState({ rowOverscanPx: px });
	};

	public setCellValue = (rowId: string, colField: string, value: unknown): void => {
		this.engine.setCellValue(rowId, colField, value);
	};

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

	public selectRows = (rowIds: string[]): void => {
		this.engine.selectRowIds(rowIds, 'api');
	};

	public deselectRows = (rowIds: string[]): void => {
		this.engine.deselectRowIds(rowIds, 'api');
	};

	public toggleRowSelection = (rowId: string): void => {
		this.engine.toggleRowId(rowId, 'api');
	};

	public selectAllRows = (): void => {
		this.engine.selectAllDataRows('api');
	};

	public clearRowSelection = (): void => {
		this.engine.clearRowSelection('api');
	};

	public isRowNodeSelected = (rowId: string): boolean => {
		return this.state.selectedRowIds.includes(rowId);
	};

	public getSelectedRowCount = (): number => {
		return this.state.selectedRowIds.length;
	};

	public setColumnWidth = (colField: string, width: number): void => {
		this.engine.resizeColumn(colField, width);
	};

	public setColumnVisible = (colField: string, visible: boolean): void => {
		const columns = this.state.columns;
		const column = columns.find((candidate) => candidate.field === colField);
		if (!column || column.hide === !visible) return;
		this.engine.setColumns(
			columns.map((candidate) => (candidate.field === colField ? { ...candidate, hide: !visible } : candidate)),
			false
		);
	};

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
		}
	};

	public getColumns = (): ColumnDef<TRowData>[] => {
		return this.state.columns.slice();
	};

	public getDisplayedColumns = (): ColumnDef<TRowData>[] => {
		return this.engine.getDisplayedColumns();
	};

	public setPinnedColumns = (pins: { left?: number; right?: number }): void => {
		this.setViewportPins(pins);
	};

	public getPinnedColumns = (): { left: number; right: number } => {
		return this.engine.getPinnedColumns();
	};

	public moveColumn = (colField: string, toIndex: number): void => {
		this.engine.moveColumn(colField, toIndex);
	};

	public setColumnOrder = (colFields: string[]): void => {
		this.engine.setColumnOrderByFields(colFields);
	};

	public setColumnReorderEnabled = (enabled: boolean): void => {
		this.engine.setColumnReorderEnabled(enabled);
	};

	public setRowHeight = (rowId: string, height: number): void => {
		this.engine.resizeRow(rowId, height);
	};

	public setSortModel = (sortModel: SortModel | null): void => {
		this.engine.setSortModel(sortModel);
	};

	public setFilterModel = (filterModel: FilterModel | null): void => {
		this.engine.setFilterModel(filterModel);
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

	public exportCsv = (options?: CsvExportOptions): void => {
		exportToCsv(this, options);
	};

	// All persistence methods are overridden by createApiFacade when an adapter is configured.
	public hasPersistence = (): boolean => false;
	public clearPersistedState = (): void => {};
	public setAutoSave = (_enabled: boolean): void => {};
	public isAutoSaveEnabled = (): boolean => true;
	public getPersistenceStatus = (): PersistenceStatus => ({ status: 'idle', autoSave: true });
	public subscribeToPersistenceStatus =
		(_listener: (status: PersistenceStatus) => void): (() => void) =>
		() => {};
	public saveNow = (): void => {};

	public openPanel = (panelId: string): void => {
		this.setState({ sidebarOpenPanel: panelId });
	};

	public closePanel = (): void => {
		this.setState({ sidebarOpenPanel: null });
	};

	public togglePanel = (panelId: string): void => {
		const current = this.state.sidebarOpenPanel;
		this.setState({ sidebarOpenPanel: current === panelId ? null : panelId });
	};

	public getOpenPanel = (): string | null => {
		return this.state.sidebarOpenPanel ?? null;
	};

	public openChart = (): void => {
		this.setState({ chartOpen: true });
	};

	public closeChart = (): void => {
		this.setState({ chartOpen: false });
	};

	public toggleChart = (): void => {
		this.setState({ chartOpen: !this.state.chartOpen });
	};

	public isChartOpen = (): boolean => {
		return this.state.chartOpen ?? false;
	};

	public setStyleSlots = (styleSlots: GridStyleSlots<TRowData> | undefined): void => {
		this.engine.setStyleSlots(styleSlots);
	};

	public toggleGroupExpanded = (groupId: string): void => {
		this.engine.groupingFeature.toggleGroupExpanded(groupId);
	};

	public toggleDetailExpanded = (rowId: string): void => {
		this.engine.groupingFeature.toggleDetailExpanded(rowId);
	};

	public isGroupExpanded = (groupId: string): boolean => {
		return this.getRowModel()?.isGroupExpanded?.(groupId) ?? false;
	};

	public isDetailExpanded = (rowId: string): boolean => {
		return this.getRowModel()?.isDetailExpanded?.(rowId) ?? false;
	};

	public getVisualRow = (index: number): VisualRow<TRowData> | null => {
		return this.getRowModel()?.getVisualRow(index) ?? null;
	};

	public getVisualRowCount = (): number => {
		return this.getRowModel()?.getVisualRowCount() ?? 0;
	};

	public getVisualRowIndexById = (id: string): number | null => {
		return this.getRowModel()?.getVisualRowIndexById(id) ?? null;
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

	public getColumnState = (): ColumnState[] => {
		return this.engine.columnFeature.getColumnState();
	};

	public applyColumnState = (states: ColumnState[]): void => {
		this.engine.columnFeature.applyColumnState(states);
	};

	public getGridState = (): PersistedGridState => {
		return extractPersistedState(this.engine.getState() as GridState);
	};

	public applyGridState = (state: PersistedGridState): void => {
		const columns = this.engine.getState().columns;
		const knownFields = new Set(columns.map((c) => c.field));
		if (state.columnOrder) {
			const validOrder = state.columnOrder.filter((f) => knownFields.has(f));
			if (validOrder.length === columns.length) this.setColumnOrder(validOrder);
		}
		if (state.columnVisibility) {
			const hidden = Object.entries(state.columnVisibility)
				.filter(([, v]) => v === false)
				.map(([f]) => f)
				.filter((f) => knownFields.has(f));
			const visible = Object.entries(state.columnVisibility)
				.filter(([, v]) => v === true)
				.map(([f]) => f)
				.filter((f) => knownFields.has(f));
			if (hidden.length > 0) this.setColumnsVisible(hidden, false);
			if (visible.length > 0) this.setColumnsVisible(visible, true);
		}
		if (state.columnWidths) {
			for (const [field, width] of Object.entries(state.columnWidths)) {
				if (knownFields.has(field)) this.setColumnWidth(field, width);
			}
		}
		if (state.sortModel !== undefined) {
			if (state.sortModel === null || (Array.isArray(state.sortModel) && state.sortModel.every((s) => knownFields.has(s.colId)))) {
				this.setSortModel(state.sortModel);
			}
		}
		if (state.filterModel !== undefined) this.setFilterModel(state.filterModel);
		if (state.groupBy !== undefined) this.setGroupBy(state.groupBy.filter((f) => knownFields.has(f)));
		if (state.showGroupFooter !== undefined) this.setShowGroupFooter(state.showGroupFooter);
		if (state.enableStickyGroupRows !== undefined) this.setStickyGroupRows(state.enableStickyGroupRows);
		if (state.pinnedColumns !== undefined) this.setPinnedColumns(state.pinnedColumns);
	};

	public registerRowModel = (rowModel: RowModel<TRowData>): void => {
		this.engine.registerRowModel(rowModel);
	};

	public getRowModel = (): RowModel<TRowData> | null => {
		return this.engine.getRowModel();
	};

	public getClientRowModelRuntime = (): ClientRowModelRuntime<TRowData> => createClientRowModelRuntime(this);

	public getServerRowModelRuntime = (): ServerRowModelRuntime<TRowData> => createServerRowModelRuntime(this);

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
		this.getRowModel()?.setRows?.(rows);
	};

	public updateRows = (updater: (rows: TRowData[]) => TRowData[]): void => {
		this.getRowModel()?.updateRows?.(updater);
	};

	public applyTransaction = (transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData> | null => {
		const rowModel = this.getRowModel();
		if (!rowModel?.applyTransaction) return null;
		return rowModel.applyTransaction(transaction);
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
			if ('styleSlots' in transaction) {
				this.setStyleSlots(transaction.styleSlots);
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
		const currentKeys = Object.keys(current);
		const nextKeys = Object.keys(next);
		if (currentKeys.length === nextKeys.length) {
			let equal = true;
			for (const key of currentKeys) {
				if (current[key] !== next[key]) {
					equal = false;
					break;
				}
			}
			if (equal) return;
		}
		this.engine.setState({ rowHeights: next });
	};

	public setDefaultRowHeight = (defaultRowHeight?: number | undefined): void => {
		if (defaultRowHeight === undefined) return;
		if (this.state.defaultRowHeight === defaultRowHeight) return;
		this.engine.setState({ defaultRowHeight });
	};

	public purgeCache = (): void => {
		this.getRowModel()?.purgeCache?.();
	};

	public setServerDatasource = (datasource: IGridDatasource<TRowData>, blockSize?: number): void => {
		this.getRowModel()?.setDatasource?.(datasource, blockSize);
	};

	public goToPage = (page: number): void => {
		this.getRowModel()?.goToPage?.(page);
	};

	public setViewportPins = (pins: { left?: number; right?: number; top?: number; bottom?: number }): void => {
		if (pins.left !== undefined) this.viewportController.pinLeftColumns = pins.left;
		if (pins.right !== undefined) this.viewportController.pinRightColumns = pins.right;
		if (pins.top !== undefined) this.viewportController.pinTopRows = pins.top;
		if (pins.bottom !== undefined) this.viewportController.pinBottomRows = pins.bottom;
		// Sync column pin counts into state so they can be subscribed to and persisted
		if (pins.left !== undefined || pins.right !== undefined) {
			this.engine.setState({
				pinnedColumns: {
					left: this.viewportController.pinLeftColumns,
					right: this.viewportController.pinRightColumns,
				},
			});
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

	public getVisibleColumnRange = (): ViewportRange => {
		return this.viewportController.getVisibleColumnRange();
	};

	public updateVisibleRanges = (): boolean => {
		return this.viewportController.updateVisibleRanges();
	};

	public subscribe = (listener: Listener<TRowData>): (() => void) => {
		return this.engine.subscribe(listener);
	};

	public subscribeToKey = (key: string, listener: Listener<TRowData>): (() => void) => {
		return this.engine.subscribeToKey(key, listener);
	};

	public subscribeToViewport = (listener: Listener<TRowData>): (() => void) => {
		const unsubscribeRows = this.subscribeToKey('visibleRowRange', listener);
		const unsubscribeCols = this.subscribeToKey('visibleColRange', listener);
		return () => {
			unsubscribeRows();
			unsubscribeCols();
		};
	};

	public subscribeToSelection = (listener: Listener<TRowData>): (() => void) => {
		return this.subscribeToKey('selection', listener);
	};

	public subscribeToFocusedCell = (listener: Listener<TRowData>): (() => void) => {
		return this.subscribeToKey('selection', listener);
	};

	public subscribeToEditingCell = (listener: Listener<TRowData>): (() => void) => {
		return this.subscribeToKey('activeEdit', listener);
	};

	public subscribeToCell = (rowId: string, colField: string, listener: () => void): (() => void) => {
		const sub: CellSubscription = { rowId, colField, onStoreChange: listener };
		this.registerCellSubscription(sub);
		return () => this.unregisterCellSubscription(sub);
	};

	public subscribeToRow = (rowId: string, listener: Listener<TRowData>): (() => void) => {
		const unsubscribeData = this.subscribeToKey('globalVersion', listener);
		const unsubscribeHeights = this.subscribeToKey('rowHeights', listener);
		const unsubscribeEvent = this.addEventListener(GridEventName.rowResized, (event) => {
			if (event.payload.rowId === rowId) listener(this.getState());
		});
		return () => {
			unsubscribeData();
			unsubscribeHeights();
			unsubscribeEvent();
		};
	};

	public subscribeToColumn = (colField: string, listener: Listener<TRowData>): (() => void) => {
		const unsubscribeColumns = this.subscribeToKey('columns', listener);
		const unsubscribeWidths = this.subscribeToKey('columnWidths', listener);
		const unsubscribeEvent = this.addEventListener(GridEventName.columnResized, (event) => {
			if (event.payload.colField === colField) listener(this.getState());
		});
		return () => {
			unsubscribeColumns();
			unsubscribeWidths();
			unsubscribeEvent();
		};
	};

	public subscribeToHeaders = (listener: Listener<TRowData>): (() => void) => {
		const unsubscribeColumns = this.subscribeToKey('columns', listener);
		const unsubscribeWidths = this.subscribeToKey('columnWidths', listener);
		const unsubscribeSort = this.subscribeToKey('sortModel', listener);
		return () => {
			unsubscribeColumns();
			unsubscribeWidths();
			unsubscribeSort();
		};
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

	public batch = (callback: () => void): void => this.engine.batch(callback);

	public flushCellUpdatesSync = (): void => this.engine.flushCellUpdatesSync();

	public registerPlugin = (plugin: GridPlugin<TRowData>): void => this.pluginRegistry.registerPlugin(plugin);

	public unregisterPlugin = (name: string): void => this.pluginRegistry.unregisterPlugin(name);

	public getPlugin = <T = unknown>(name: string): T | null => this.pluginRegistry.getPlugin<T>(name);

	public undo = (): void => this.engine.undo();

	public redo = (): void => this.engine.redo();

	public canUndo = (): boolean => {
		return this.engine.commandHistory.canUndo();
	};

	public canRedo = (): boolean => {
		return this.engine.commandHistory.canRedo();
	};

	public getRenderStats = (): RenderStats => {
		if (this.engine.getRenderStats) {
			return this.engine.getRenderStats();
		}
		const empty = createEmptyRenderStats();
		empty.compiledPlanVersion = this.engine.getCompiledPlanVersion();
		return empty;
	};

	public resetRenderStats = (): void => {
		this.engine.resetRenderStats?.();
	};

	public getRuntimeFaults = () => this.engine.runtimeFaults.snapshot();

	public clearRuntimeFaults = (): void => {
		this.engine.runtimeFaults.clear();
	};

	public reportRuntimeFault = (fault: import('./diagnostics/RuntimeFaultReporter.js').RuntimeFaultInput) => {
		return this.engine.runtimeFaults.report(fault);
	};

	public destroy = (): void => {
		this.pluginRegistry.destroy();
		this.engine.destroy();
	};
}

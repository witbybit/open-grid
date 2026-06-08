import { ApiBridge } from './apiBridge.js';
import { ClientRowModelController, type ClientRowModelOptions, type FilterModel, type SortModel } from './rowModel.js';
import { ServerRowModelController, type IGridDatasource, type ServerRowModelOptions } from './serverRowModel.js';
import {
	GridStore,
	type ColumnDef,
	type CsvExportOptions,
	type GridApi,
	type GridCellPointer,
	type GridEventListener,
	type GridSelectionSource,
	type GridState,
	type Listener,
	type RowDataTransaction,
	type RowNodeTransaction,
} from './store.js';
import { exportToCsv } from './export/csvExport.js';
import {
	type GridPersistenceAdapter,
	type PersistedGridState,
	type PersistenceController,
	type PersistenceStatus,
	createLocalStorageAdapter,
	applyPersistedState,
	applyPersistedStateViaApi,
	createPersistenceSubscription,
} from './persistence/statePersistence.js';

export type { GridPersistenceAdapter, PersistedGridState };
export { createLocalStorageAdapter };

export interface ClientGridOptions<TRowData> extends ClientRowModelOptions<TRowData> {
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
	/**
	 * Persistence adapter. Pass `createLocalStorageAdapter(key)` for the built-in
	 * localStorage implementation, or supply your own for remote/API-backed storage.
	 *
	 * @example localStorage
	 * persistence: createLocalStorageAdapter('my-grid')
	 *
	 * @example Remote API
	 * persistence: {
	 *   async load() { return fetch('/api/grid-prefs').then(r => r.json()); },
	 *   async save(state) { await fetch('/api/grid-prefs', { method: 'PUT', body: JSON.stringify(state) }); },
	 *   async clear() { await fetch('/api/grid-prefs', { method: 'DELETE' }); },
	 * }
	 */
	persistence?: GridPersistenceAdapter;
}

export interface ServerGridOptions<TRowData> extends ServerRowModelOptions<TRowData> {
	initialState?: Partial<GridState<TRowData>>;
	/**
	 * Persistence adapter — same interface as client grid.
	 * Column order, visibility, widths, sort model, filter model,
	 * showGroupFooter, and enableStickyGroupRows are persisted.
	 * Row data is not persisted (fetched from the server datasource on load).
	 */
	persistence?: GridPersistenceAdapter;
}

function buildColumnWidths<TRowData>(columns: Array<ColumnDef<TRowData>>): Record<string, number> {
	return columns.reduce<Record<string, number>>((acc, column) => {
		if (column.width !== undefined) acc[column.field] = column.width;
		return acc;
	}, {});
}

export function createApiFacade<TRowData>(
	store: GridStore<TRowData>,
	destroy: () => void,
	persistenceAdapter?: GridPersistenceAdapter,
	persistenceController?: PersistenceController
): GridApi<TRowData> & ApiBridge<TRowData> {
	const api = {
		getState: () => store.getState(),
		getRowId: (row: TRowData) => store.getRowId(row),
		isRowLoading: (rowId: string) => store.isRowLoading(rowId),
		getDataRowAtVisualIndex: (index: number) => store.getDataRowAtVisualIndex(index),
		getDataRowNodeAtVisualIndex: (index: number) => store.getDataRowNodeAtVisualIndex(index),
		setRows: (rows: TRowData[]) => store.setRows(rows),
		updateRows: (updater: (rows: TRowData[]) => TRowData[]) => store.updateRows(updater),
		applyTransaction: (transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData> | null => store.applyTransaction(transaction),
		refreshRows: () => store.refreshRows(),
		setRowHeights: (rowHeights: Record<string, number> | undefined) => store.setRowHeights(rowHeights),
		setDefaultRowHeight: (defaultRowHeight?: number | undefined) => store.setDefaultRowHeight(defaultRowHeight),
		purgeCache: () => store.purgeCache(),
		setServerDatasource: (datasource: IGridDatasource, blockSize?: number) => store.setServerDatasource(datasource, blockSize),
		getCellValue: (rowId: string, colField: string) => store.getCellValue(rowId, colField),
		getCachedDisplayValue: (rowId: string, colField: string) => store.getCachedDisplayValue(rowId, colField),
		getCheapDisplayValue: (rowId: string, colField: string) => store.getCheapDisplayValue(rowId, colField),
		getComputedCellValue: (rowId: string, colField: string) => store.getComputedCellValue(rowId, colField),
		setCellValue: (rowId: string, colField: string, value: unknown) => store.setCellValue(rowId, colField, value),
		getCellState: (rowId: string, colField: string) => store.getCellState(rowId, colField),
		selectCell: (pointer: GridCellPointer | null, source?: GridSelectionSource) => store.selectCell(pointer, source),
		selectRange: (start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource) =>
			store.selectRange(start, end, source),
		extendSelection: (end: GridCellPointer, source?: GridSelectionSource) => store.extendSelection(end, source),
		setColumns: (columns: ColumnDef<TRowData>[]) => store.setColumns(columns),
		setColumnWidth: (colField: string, width: number) => store.setColumnWidth(colField, width),
		setColumnVisible: (colField: string, visible: boolean) => store.setColumnVisible(colField, visible),
		setColumnsVisible: (colFields: string[], visible: boolean) => store.setColumnsVisible(colFields, visible),
		getColumns: () => store.getColumns(),
		getDisplayedColumns: () => store.getDisplayedColumns(),
		setPinnedColumns: (pins: { left?: number; right?: number }) => store.setPinnedColumns(pins),
		getPinnedColumns: () => store.getPinnedColumns(),
		moveColumn: (colField: string, toIndex: number) => store.moveColumn(colField, toIndex),
		setColumnOrder: (colFields: string[]) => store.setColumnOrder(colFields),
		setColumnReorderEnabled: (enabled: boolean) => store.setColumnReorderEnabled(enabled),
		setRowHeight: (rowId: string, height: number) => store.setRowHeight(rowId, height),
		setSortModel: (sortModel: SortModel | null) => store.setSortModel(sortModel),
		setFilterModel: (filterModel: FilterModel | null) => store.setFilterModel(filterModel),
		setGroupBy: (colIds: string[]) => store.setGroupBy(colIds),
		getGroupBy: () => store.getGroupBy(),
		setAggDefs: (defs: Parameters<typeof store.setAggDefs>[0]) => store.setAggDefs(defs),
		getAggDefs: () => store.getAggDefs(),
		expandAllGroups: () => store.expandAllGroups(),
		collapseAllGroups: () => store.collapseAllGroups(),
		setShowGroupFooter: (enabled: boolean) => store.setShowGroupFooter(enabled),
		setStickyGroupRows: (enabled: boolean) => store.setStickyGroupRows(enabled),
		exportCsv: (options?: CsvExportOptions) => exportToCsv(store, options),
		setStyleSlots: (styleSlots: GridState<TRowData>['styleSlots']) => store.setStyleSlots(styleSlots),
		addEventListener: <T = unknown>(type: string, callback: GridEventListener<T>) => store.addEventListener(type, callback),
		dispatchEvent: <T = unknown>(type: string, payload: T) => store.dispatchEvent(type, payload),
		startEditing: (rowId: string, colField: string) => store.startEditing(rowId, colField),
		stopEditing: (cancel?: boolean) => store.stopEditing(cancel),
		toggleGroupExpanded: (groupId: string) => store.toggleGroupExpanded(groupId),
		toggleDetailExpanded: (rowId: string) => store.toggleDetailExpanded(rowId),
		isGroupExpanded: (groupId: string) => store.isGroupExpanded(groupId),
		isDetailExpanded: (rowId: string) => store.isDetailExpanded(rowId),
		getVisualRow: (index: number) => store.getVisualRow(index),
		getVisualRowCount: () => store.getVisualRowCount(),
		getVisualRowIndexById: (id: string) => store.getVisualRowIndexById(id),
		getVisualIndexById: (visualRowId: string) => store.getVisualIndexById(visualRowId),
		getVisualIndexByRowId: (rowId: string) => store.getVisualIndexByRowId(rowId),
		getRowNodeById: (rowId: string) => store.getRowNodeById(rowId),
		getRawRowById: (rowId: string) => store.getRawRowById(rowId),
		rows: () => store.rows(),
		subscribe: (listener: Listener<TRowData>) => store.subscribe(listener),
		subscribeToKey: (key: string, listener: Listener<TRowData>) => store.subscribeToKey(key, listener),
		subscribeToViewport: (listener: Listener<TRowData>) => store.subscribeToViewport(listener),
		subscribeToSelection: (listener: Listener<TRowData>) => store.subscribeToSelection(listener),
		subscribeToFocusedCell: (listener: Listener<TRowData>) => store.subscribeToFocusedCell(listener),
		subscribeToEditingCell: (listener: Listener<TRowData>) => store.subscribeToEditingCell(listener),
		subscribeToCell: (rowId: string, colField: string, listener: () => void) => store.subscribeToCell(rowId, colField, listener),
		subscribeToRow: (rowId: string, listener: Listener<TRowData>) => store.subscribeToRow(rowId, listener),
		subscribeToColumn: (colField: string, listener: Listener<TRowData>) => store.subscribeToColumn(colField, listener),
		subscribeToHeaders: (listener: Listener<TRowData>) => store.subscribeToHeaders(listener),
		getColumnIndex: (colField: string) => store.getColumnIndex(colField),
		getColumnField: (colIndex: number) => store.getColumnField(colIndex),
		getColumnDef: (colField: string) => store.getColumnDef(colField),
		getCellAccess: (rowId: string, colField: string) => store.getCellAccess(rowId, colField),
		openPanel: (panelId: string) => store.openPanel(panelId),
		closePanel: () => store.closePanel(),
		togglePanel: (panelId: string) => store.togglePanel(panelId),
		getOpenPanel: () => store.getOpenPanel(),
		isChartOpen: () => store.isChartOpen(),
		openChart: () => store.openChart(),
		closeChart: () => store.closeChart(),
		toggleChart: () => store.toggleChart(),
		undo: () => store.undo(),
		redo: () => store.redo(),
		canUndo: () => store.canUndo(),
		canRedo: () => store.canRedo(),
		getRenderStats: () => store.getRenderStats(),
		resetRenderStats: () => store.resetRenderStats(),
		getRowOverscanPx: () => store.getRowOverscanPx(),
		setRowOverscanPx: (px: number) => store.setRowOverscanPx(px),
		hasPersistence: (): boolean => persistenceAdapter !== undefined,
		clearPersistedState: (): void | Promise<void> => persistenceAdapter?.clear?.(),
		setAutoSave: (enabled: boolean): void => persistenceController?.setAutoSave(enabled),
		isAutoSaveEnabled: (): boolean => persistenceController?.isAutoSaveEnabled() ?? true,
		getPersistenceStatus: (): PersistenceStatus => persistenceController?.getStatus() ?? { status: 'idle', autoSave: true },
		subscribeToPersistenceStatus: (listener: (status: PersistenceStatus) => void): (() => void) =>
			persistenceController?.onStatusChange(listener) ?? (() => {}),
		saveNow: (): void => persistenceController?.saveNow(),
		destroy,
	};

	Object.defineProperties(api, {
		__getEngine: { value: () => store.engine },
		__getInternalApi: { value: () => store },
	});

	return Object.freeze(api) as GridApi<TRowData> & ApiBridge<TRowData>;
}

function wireGridPersistence<TRowData>(
	options: { columns: ColumnDef<TRowData>[]; initialState?: Partial<GridState<TRowData>>; persistence?: GridPersistenceAdapter },
	store: GridStore<TRowData>
): PersistenceController | undefined {
	const { persistence: adapter } = options;
	if (!adapter) return undefined;
	return createPersistenceSubscription(
		adapter,
		// Wrap subscribeToKey — persistence listener only needs () => void, extra args are ignored at runtime
		(key, cb) => store.subscribeToKey(key, cb as Parameters<typeof store.subscribeToKey>[1]),
		() => store.getState(),
		adapter.debounceMs ?? 500
	);
}

export function createClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const { persistence: adapter } = options;

	let mergedInitial: Partial<GridState<TRowData>> = options.initialState ?? {};
	let asyncLoad: Promise<PersistedGridState | null> | undefined;

	if (adapter) {
		const loaded = adapter.load();
		if (loaded instanceof Promise) {
			asyncLoad = loaded;
		} else if (loaded) {
			mergedInitial = applyPersistedState(loaded, mergedInitial, options.columns as unknown as ColumnDef<unknown>[]) as Partial<
				GridState<TRowData>
			>;
		}
	}

	const store = new GridStore<TRowData>({
		columns: mergedInitial.columns ?? options.columns,
		getRowId: options.getRowId,
		columnWidths: buildColumnWidths(mergedInitial.columns ?? options.columns),
		...mergedInitial,
	});

	const controller = new ClientRowModelController<TRowData>(store, options);
	const persistenceController = wireGridPersistence(options, store);
	const api = createApiFacade(
		store,
		() => {
			persistenceController?.destroy();
			controller.dispose();
			store.destroy();
		},
		adapter,
		persistenceController
	);

	if (asyncLoad) {
		asyncLoad
			.then((saved) => {
				if (saved) applyPersistedStateViaApi(api as GridApi<TRowData>, saved, options.columns);
			})
			.catch(() => {
				/* load failure — grid stays in default state */
			});
	}

	return api;
}

export function createServerGrid<TRowData>(options: ServerGridOptions<TRowData>): GridApi<TRowData> {
	const { persistence: adapter } = options;

	let mergedInitial: Partial<GridState<TRowData>> = options.initialState ?? {};
	let asyncLoad: Promise<PersistedGridState | null> | undefined;

	if (adapter) {
		const loaded = adapter.load();
		if (loaded instanceof Promise) {
			asyncLoad = loaded;
		} else if (loaded) {
			mergedInitial = applyPersistedState(loaded, mergedInitial, options.columns as unknown as ColumnDef<unknown>[]) as Partial<
				GridState<TRowData>
			>;
		}
	}

	const store = new GridStore<TRowData>({
		columns: mergedInitial.columns ?? options.columns,
		getRowId: options.getRowId,
		columnWidths: buildColumnWidths(mergedInitial.columns ?? options.columns),
		...mergedInitial,
	});

	const controller = new ServerRowModelController<TRowData>(store, options);
	const persistenceController = wireGridPersistence(options, store);
	const api = createApiFacade(
		store,
		() => {
			persistenceController?.destroy();
			controller.dispose();
			store.destroy();
		},
		adapter,
		persistenceController
	);

	if (asyncLoad) {
		asyncLoad
			.then((saved) => {
				if (saved) applyPersistedStateViaApi(api as GridApi<TRowData>, saved, options.columns);
			})
			.catch(() => {
				/* load failure — grid stays in default state */
			});
	}

	return api;
}

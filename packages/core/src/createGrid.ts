import { ClientRowModelController, type ClientRowModelOptions, type FilterModel, type SortModel } from './rowModel.js';
import type { RowValidator } from './features/ValidationManager.js';
import { ServerRowModelController, type IGridDatasource, type ServerRowModelOptions } from './serverRowModel.js';
import {
	GridStore,
	type ColumnDef,
	type ColumnState,
	type CsvExportOptions,
	type GridApi,
	type GridCellPointer,
	type GridPluginController,
	type GridSelectionSource,
	type GridState,
	type Listener,
	type RowDataTransaction,
	type RowNodeTransaction,
	type RowSelectionMode,
	type RowSelectionOptions,
	type RowSelectionGesture,
	type SelectRowsOptions,
	type SelectAllRowsOptions,
} from './store.js';

// WeakMap reverse-lookup: maps a public GridApi to the internal GridStore that backs it.
// This is the canonical way for framework adapters to recover the store from a public API handle.
const apiStoreMap = new WeakMap<GridApi<unknown>, GridStore<unknown>>();

/**
 * Recover the internal GridStore from a public GridApi handle.
 * Only works for APIs created by Open Grid factory functions.
 * Framework adapters (e.g. @open-grid/react) use this to access renderer-level internals
 * without exposing GridStore on the public GridApi type.
 *
 * @throws if the api was not created by Open Grid.
 */
export function getStoreFromApi<TRowData>(api: GridApi<TRowData>): GridStore<TRowData> {
	const store = apiStoreMap.get(api as GridApi<unknown>);

	if (!store) {
		throw new Error('Invalid GridApi. This API was not created by Open Grid.');
	}

	return store as GridStore<TRowData>;
}

export function getPluginControllerFromApi<TRowData>(api: GridApi<TRowData>): GridPluginController<TRowData> {
	return getStoreFromApi(api).getPluginController();
}
import { exportToCsv } from './export/csvExport.js';
import {
	type GridPersistenceAdapter,
	type PersistedGridState,
	type PersistenceController,
	type PersistenceStatus,
	createLocalStorageAdapter,
	applyPersistedState,
	createPersistenceSubscription,
} from './persistence/statePersistence.js';
import type { ThemeTokens } from './renderer/themes.js';

export type { GridPersistenceAdapter, PersistedGridState };
export { createLocalStorageAdapter };

export interface ClientGridOptions<TRowData> extends ClientRowModelOptions<TRowData> {
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
	/**
	 * Enable first-class row selection. When set to `'multiple'`, a built-in checkbox
	 * column is automatically prepended and pinned to the left — no need to add a
	 * `checkboxSelection: true` column manually. Works like AG Grid's `rowSelection` prop.
	 *
	 * @example
	 * useClientGrid({ rows, columns, rowSelection: 'multiple' })
	 */
	rowSelection?: RowSelectionMode | RowSelectionOptions;
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
	persistence?: string | GridPersistenceAdapter;
	/** Grid-level cross-field validator — see RowValidator for details. */
	rowValidator?: RowValidator<TRowData>;
}

export interface ServerGridOptions<TRowData> extends ServerRowModelOptions<TRowData> {
	initialState?: Partial<GridState<TRowData>>;
	rowSelection?: RowSelectionMode | RowSelectionOptions;
	/**
	 * Persistence adapter — same interface as client grid.
	 * Column order, visibility, widths, sort model, filter model,
	 * showGroupFooter, and enableStickyGroupRows are persisted.
	 * Row data is not persisted (fetched from the server datasource on load).
	 */
	persistence?: string | GridPersistenceAdapter;
	/** Grid-level cross-field validator — see RowValidator for details. */
	rowValidator?: RowValidator<TRowData>;
}

function buildColumnWidths<TRowData>(columns: Array<ColumnDef<TRowData>>): Record<string, number> {
	return columns.reduce<Record<string, number>>((acc, column) => {
		if (column.width !== undefined) acc[column.field] = column.width;
		return acc;
	}, {});
}

function normalizeRowSelection(rowSelection?: RowSelectionMode | RowSelectionOptions): RowSelectionOptions | undefined {
	if (!rowSelection) return undefined;
	if (typeof rowSelection === 'string') return { mode: rowSelection, selectAllScope: 'page' };
	return { selectAllScope: 'page', ...rowSelection };
}

function withRowSelectionColumn<TRowData>(
	columns: Array<ColumnDef<TRowData>>,
	initialState: Partial<GridState<TRowData>>,
	rowSelection?: RowSelectionMode | RowSelectionOptions
): { columns: Array<ColumnDef<TRowData>>; initialState: Partial<GridState<TRowData>> } {
	const normalized = normalizeRowSelection(rowSelection);
	if (!normalized) return { columns, initialState };

	let nextColumns = columns;
	let nextInitial: Partial<GridState<TRowData>> = { ...initialState, rowSelection: normalized };
	if (normalized.mode === 'multiple' && !columns.some((column) => column.checkboxSelection)) {
		const checkboxCol = {
			field: '__rowSelect__',
			header: '',
			width: 40,
			checkboxSelection: true,
			sortable: false,
			movable: false,
		} as unknown as ColumnDef<TRowData>;
		nextColumns = [checkboxCol, ...columns];
		nextInitial = {
			...nextInitial,
			pinnedColumns: {
				left: (nextInitial.pinnedColumns?.left ?? 0) + 1,
				right: nextInitial.pinnedColumns?.right ?? 0,
			},
		};
	}
	if (normalized.mode === 'multiple') {
		nextInitial = { ...nextInitial, columns: nextColumns };
	}
	return { columns: nextColumns, initialState: nextInitial };
}

export function createApiFacade<TRowData>(
	store: GridStore<TRowData>,
	destroy: () => void,
	persistenceAdapter?: GridPersistenceAdapter,
	persistenceController?: PersistenceController
): GridApi<TRowData> {
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
		setServerDatasource: (datasource: IGridDatasource<TRowData>, blockSize?: number) => store.setServerDatasource(datasource, blockSize),
		goToPage: (page: number) => store.goToPage(page),
		getCellValue: (rowId: string, colField: string) => store.getCellValue(rowId, colField),
		setCellValue: (rowId: string, colField: string, value: unknown) => store.setCellValue(rowId, colField, value),
		batchCellValues: (updates: { rowId: string; colField: string; value: unknown }[], source?: 'paste' | 'api' | 'fill') =>
			store.batchCellValues(updates, source),
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
		addGroupBy: (colId: string, atIndex?: number) => store.addGroupBy(colId, atIndex),
		removeGroupBy: (colId: string) => store.removeGroupBy(colId),
		moveGroupBy: (colId: string, toIndex: number) => store.moveGroupBy(colId, toIndex),
		setAggDefs: (defs: Parameters<typeof store.setAggDefs>[0]) => store.setAggDefs(defs),
		getAggDefs: () => store.getAggDefs(),
		expandAllGroups: () => store.expandAllGroups(),
		collapseAllGroups: () => store.collapseAllGroups(),
		setShowGroupFooter: (enabled: boolean) => store.setShowGroupFooter(enabled),
		setStickyGroupRows: (enabled: boolean) => store.setStickyGroupRows(enabled),
		setShowGroupPanel: (enabled: boolean) => store.setShowGroupPanel(enabled),
		exportCsv: (options?: CsvExportOptions) => exportToCsv(store, options),
		setStyleRules: (styleRules: GridState<TRowData>['styleRules']) => store.setStyleRules(styleRules),
		addEventListener: store.addEventListener,
		dispatchEvent: store.dispatchEvent,
		startEditing: (rowId: string, colField: string) => store.startEditing(rowId, colField),
		stopEditing: (cancel?: boolean) => store.stopEditing(cancel),
		commitEdit: (rowId: string, colField: string, value: unknown) => store.commitEdit(rowId, colField, value),
		validateCell: (rowId: string, colField: string) => store.validateCell(rowId, colField),
		validateGrid: () => store.validateGrid(),
		clearCellValidationError: (rowId: string, colField: string) => store.clearCellValidationError(rowId, colField),
		clearValidationErrors: () => store.clearValidationErrors(),
		getCellValidationError: (rowId: string, colField: string) => store.getCellValidationError(rowId, colField),
		hasValidationErrors: () => store.hasValidationErrors(),
		getAllValidationErrors: () => store.getAllValidationErrors(),
		getColumnState: () => store.getColumnState(),
		applyColumnState: (states: ColumnState[], opts?: { applyOrder?: boolean }) => store.applyColumnState(states, opts),
		getGridState: () => store.getGridState(),
		applyGridState: (state: PersistedGridState) => store.applyGridState(state),
		toggleGroupExpanded: (groupId: string) => store.toggleGroupExpanded(groupId),
		toggleDetailExpanded: (rowId: string) => store.toggleDetailExpanded(rowId),
		isGroupExpanded: (groupId: string) => store.isGroupExpanded(groupId),
		isDetailExpanded: (rowId: string) => store.isDetailExpanded(rowId),
		getRowNodeById: (rowId: string) => store.getRowNodeById(rowId),
		getRawRowById: (rowId: string) => store.getRawRowById(rowId),
		applyRowSelectionGesture: (gesture: RowSelectionGesture) => store.applyRowSelectionGesture(gesture),
		selectRows: (rowIds: string[], options?: SelectRowsOptions) => store.selectRows(rowIds, options),
		deselectRows: (rowIds: string[]) => store.deselectRows(rowIds),
		toggleRowSelection: (rowId: string) => store.toggleRowSelection(rowId),
		selectAllRows: (options?: SelectAllRowsOptions) => store.selectAllRows(options),
		clearRowSelection: () => store.clearRowSelection(),
		getSelectedRowIds: () => store.getSelectedRowIds(),
		rows: () => store.rows(),
		subscribe: (listener: Listener<TRowData>) => store.subscribe(listener),
		subscribeToKey: (key: string, listener: Listener<TRowData>) => store.subscribeToKey(key, listener),
		getColumnIndex: (colField: string) => store.getColumnIndex(colField),
		getColumnField: (colIndex: number) => store.getColumnField(colIndex),
		getColumnDef: (colField: string) => store.getColumnDef(colField),
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
		hasPersistence: (): boolean => persistenceAdapter !== undefined,
		clearPersistedState: (): void | Promise<void> => persistenceAdapter?.clear?.(),
		setAutoSave: (enabled: boolean): void => persistenceController?.setAutoSave(enabled),
		isAutoSaveEnabled: (): boolean => persistenceController?.isAutoSaveEnabled() ?? true,
		getPersistenceStatus: (): PersistenceStatus => persistenceController?.getStatus() ?? { status: 'idle', autoSave: true },
		subscribeToPersistenceStatus: (listener: (status: PersistenceStatus) => void): (() => void) =>
			persistenceController?.onStatusChange(listener) ?? (() => {}),
		saveNow: (): void => persistenceController?.saveNow(),
		getRuntimeFaults: () => store.getRuntimeFaults(),
		clearRuntimeFaults: () => store.clearRuntimeFaults(),
		flushCellUpdatesSync: () => store.flushCellUpdatesSync(),
		getTheme: () => store.getTheme(),
		getThemeName: () => store.getThemeName(),
		getAvailableThemes: () => store.getAvailableThemes(),
		switchTheme: (themeName: string) => store.switchTheme(themeName),
		onThemeChange: (listener: (theme: ThemeTokens) => void) => store.onThemeChange(listener),
		getContainer: () => store.getContainerElement(),
		destroy,
	};

	const frozen = Object.freeze(api) as GridApi<TRowData>;
	apiStoreMap.set(frozen as unknown as GridApi<unknown>, store as unknown as GridStore<unknown>);
	return frozen;
}

function wireGridPersistence<TRowData>(
	options: { columns: ColumnDef<TRowData>[]; initialState?: Partial<GridState<TRowData>>; persistence?: string | GridPersistenceAdapter },
	store: GridStore<TRowData>
): PersistenceController | undefined {
	const { persistence: rawPersistence } = options;
	if (!rawPersistence) return undefined;
	const adapter = typeof rawPersistence === 'string' ? createLocalStorageAdapter(rawPersistence) : rawPersistence;
	return createPersistenceSubscription(
		adapter,
		// Wrap subscribeToKey — persistence listener only needs () => void, extra args are ignored at runtime
		(key, cb) => store.subscribeToKey(key, cb as Parameters<typeof store.subscribeToKey>[1]),
		() => store.getGridState(),
		adapter.debounceMs ?? 500
	);
}

export function createClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const { persistence: rawPersistence } = options;
	const adapter = typeof rawPersistence === 'string' ? createLocalStorageAdapter(rawPersistence) : rawPersistence;

	let columns = options.columns;
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
	// Apply row selection after persistence so restored column state cannot hide the built-in selector.
	const selected = withRowSelectionColumn(mergedInitial.columns ?? columns, mergedInitial, options.rowSelection);
	columns = selected.columns;
	mergedInitial = selected.initialState;

	let resolvedColumns = mergedInitial.columns ?? columns;
	// Derive pinnedColumns from column.pinned when not explicitly provided.
	if (!mergedInitial.pinnedColumns) {
		const leftCols = resolvedColumns.filter((c) => c.pinned === 'left');
		const rightCols = resolvedColumns.filter((c) => c.pinned === 'right');
		if (leftCols.length > 0 || rightCols.length > 0) {
			const centerCols = resolvedColumns.filter((c) => !c.pinned);
			resolvedColumns = [...leftCols, ...centerCols, ...rightCols];
			mergedInitial = { ...mergedInitial, pinnedColumns: { left: leftCols.length, right: rightCols.length } };
		}
	}
	const store = new GridStore<TRowData>(
		{
			columns: resolvedColumns,
			getRowId: options.getRowId,
			columnWidths: buildColumnWidths(resolvedColumns),
			...mergedInitial,
		},
		{ rowValidator: options.rowValidator }
	);

	const controller = new ClientRowModelController<TRowData>(store.getClientRowModelRuntime(), { ...options, columns: resolvedColumns });
	const persistenceController = wireGridPersistence({ ...options, persistence: adapter }, store);
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
				if (saved) api.applyGridState(saved);
			})
			.catch(() => {
				/* load failure — grid stays in default state */
			});
	}

	return api;
}

export function createServerGrid<TRowData>(options: ServerGridOptions<TRowData>): GridApi<TRowData> {
	const { persistence: rawPersistence } = options;
	const adapter = typeof rawPersistence === 'string' ? createLocalStorageAdapter(rawPersistence) : rawPersistence;

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
	const selected = withRowSelectionColumn(options.columns, mergedInitial, options.rowSelection);
	mergedInitial = selected.initialState;

	let serverResolvedColumns = mergedInitial.columns ?? selected.columns;
	// Derive pinnedColumns from column.pinned when not explicitly provided.
	if (!mergedInitial.pinnedColumns) {
		const leftCols = serverResolvedColumns.filter((c) => c.pinned === 'left');
		const rightCols = serverResolvedColumns.filter((c) => c.pinned === 'right');
		if (leftCols.length > 0 || rightCols.length > 0) {
			const centerCols = serverResolvedColumns.filter((c) => !c.pinned);
			serverResolvedColumns = [...leftCols, ...centerCols, ...rightCols];
			mergedInitial = { ...mergedInitial, pinnedColumns: { left: leftCols.length, right: rightCols.length } };
		}
	}
	const store = new GridStore<TRowData>(
		{
			columns: serverResolvedColumns,
			getRowId: options.getRowId,
			columnWidths: buildColumnWidths(serverResolvedColumns),
			...mergedInitial,
		},
		{ rowValidator: options.rowValidator }
	);

	const controller = new ServerRowModelController<TRowData>(store.getServerRowModelRuntime(), { ...options, columns: selected.columns });
	const persistenceController = wireGridPersistence({ ...options, persistence: adapter }, store);
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
				if (saved) api.applyGridState(saved);
			})
			.catch(() => {
				/* load failure — grid stays in default state */
			});
	}

	return api;
}

import type {
	GridApi,
	GridStore,
	GridStateUpdater,
	GridEventListener,
	Listener,
	GridCellPointer,
	GridCellRange,
	GridSelectionSource,
	SortModel,
	FilterModel,
} from '@open-grid/core';

const apiStoreMap = new WeakMap<GridApi<unknown>, GridStore<unknown>>();

export function createGridApiFacade<TRowData>(store: GridStore<TRowData>): GridApi<TRowData> {
	const api = Object.freeze({
		getState: () => store.getState(),
		setState: (updater: GridStateUpdater<TRowData>) => store.setState(updater),

		getRowId: (row: TRowData) => store.getRowId(row),
		isRowLoading: (rowId: string) => store.isRowLoading(rowId),
		getRowCount: () => store.getRowCount(),
		getRow: (index: number) => store.getRow(index),
		getRowNode: (index: number) => store.getRowNode(index),
		getRowIndexById: (rowId: string) => store.getRowIndexById(rowId),
		setRows: (rows: TRowData[]) => store.setRows(rows),
		updateRows: (updater: (rows: TRowData[]) => TRowData[]) => store.updateRows(updater),
		refreshRows: () => store.refreshRows(),
		purgeCache: () => store.purgeCache(),

		getCellValue: (rowId: string, colField: string) => store.getCellValue(rowId, colField),
		setCellValue: (rowId: string, colField: string, value: unknown) => store.setCellValue(rowId, colField, value),
		getCellState: (rowId: string, colField: string) => store.getCellState(rowId, colField),
		selectCell: (pointer: GridCellPointer | null, source?: GridSelectionSource) => store.selectCell(pointer, source),
		selectRange: (start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource) => store.selectRange(start, end, source),
		extendSelection: (end: GridCellPointer, source?: GridSelectionSource) => store.extendSelection(end, source),

		setColumnWidth: (colField: string, width: number) => store.setColumnWidth(colField, width),
		moveColumn: (colField: string, toIndex: number) => store.moveColumn(colField, toIndex),
		setColumnOrder: (colFields: string[]) => store.setColumnOrder(colFields),
		setColumnReorderEnabled: (enabled: boolean) => store.setColumnReorderEnabled(enabled),

		setRowHeight: (rowId: string, height: number) => store.setRowHeight(rowId, height),

		setSortModel: (sortModel: SortModel | null) => store.setSortModel(sortModel),
		setFilterModel: (filterModel: FilterModel | null) => store.setFilterModel(filterModel),

		addEventListener: <T = unknown>(type: string, callback: GridEventListener<T>) => store.addEventListener(type, callback),
		dispatchEvent: <T = unknown>(type: string, payload: T) => store.dispatchEvent(type, payload),

		stopEditing: (cancel?: boolean) => store.stopEditing(cancel),

		startTransaction: () => store.startTransaction(),
		endTransaction: () => store.endTransaction(),

		subscribe: (listener: Listener<TRowData>) => store.subscribe(listener),

		subscribeToKey: (key: string, listener: Listener<TRowData>) => store.subscribeToKey(key, listener),

		getColumnIndex: (colField: string) => store.getColumnIndex(colField),
		getColumnField: (colIndex: number) => store.getColumnField(colIndex),
		getColumnDef: (colField: string) => store.getColumnDef(colField),
		getCellAccess: (rowId: string, colField: string) => store.getCellAccess(rowId, colField),

		getPlugin: <T = unknown>(name: string) => store.getPlugin<T>(name),
		unregisterPlugin: (name: string) => store.unregisterPlugin(name),

		undo: () => store.undo(),
		redo: () => store.redo(),
		canUndo: () => store.canUndo(),
		canRedo: () => store.canRedo(),

		fillRange: (source: GridCellRange, target: GridCellRange) => store.fillRange(source, target),

		destroy: () => store.destroy(),
	});
	apiStoreMap.set(api as GridApi<unknown>, store as GridStore<unknown>);
	return api;
}

export function getStoreFromApi<TRowData>(api: GridApi<TRowData>): GridStore<TRowData> {
	const store = apiStoreMap.get(api as GridApi<unknown>);
	if (!store) {
		throw new Error('OpenGrid received a GridApi that was not created by useClientGrid/useServerGrid.');
	}
	return store as GridStore<TRowData>;
}

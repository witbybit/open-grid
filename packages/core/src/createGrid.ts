import { ClientRowModelController, type ClientRowModelOptions } from './rowModel.js';
import { ServerRowModelController, type ServerRowModelOptions } from './serverRowModel.js';
import { GridStore, type GridApi, type GridState, type GridStateUpdater, type GridEventListener, type Listener, type GridCellPointer, type GridSelectionSource } from './store.js';
import type { FilterModel, SortModel } from './rowModel.js';

export interface ClientGridOptions<TRowData> extends ClientRowModelOptions<TRowData> {
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
}

export interface ServerGridOptions<TRowData> extends ServerRowModelOptions<TRowData> {
	initialState?: Partial<GridState<TRowData>>;
}

function createApiFacade<TRowData>(store: GridStore<TRowData>, destroy: () => void): GridApi<TRowData> {
	return Object.freeze({
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
		subscribe: (listener: Listener<TRowData>) => store.subscribe(listener),
		subscribeToKey: (key: string, listener: Listener<TRowData>) => store.subscribeToKey(key, listener),
		getColumnIndex: (colField: string) => store.getColumnIndex(colField),
		getColumnField: (colIndex: number) => store.getColumnField(colIndex),
		getColumnDef: (colField: string) => store.getColumnDef(colField),
		getCellAccess: (rowId: string, colField: string) => store.getCellAccess(rowId, colField),
		undo: () => store.undo(),
		redo: () => store.redo(),
		canUndo: () => store.canUndo(),
		canRedo: () => store.canRedo(),
		destroy,
	});
}

export function createClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const store = new GridStore<TRowData>({
		columns: options.columns,
		getRowId: options.getRowId,
		columnWidths: options.columns.reduce<Record<string, number>>((acc, column) => {
			if (column.width !== undefined) acc[column.field] = column.width;
			return acc;
		}, {}),
		...options.initialState,
	});
	const controller = new ClientRowModelController<TRowData>(store, options);
	return createApiFacade(store, () => {
		controller.dispose();
		store.destroy();
	});
}

export function createServerGrid<TRowData>(options: ServerGridOptions<TRowData>): GridApi<TRowData> {
	const store = new GridStore<TRowData>({
		columns: options.columns,
		getRowId: options.getRowId,
		columnWidths: options.columns.reduce<Record<string, number>>((acc, column) => {
			if (column.width !== undefined) acc[column.field] = column.width;
			return acc;
		}, {}),
		...options.initialState,
	});
	const controller = new ServerRowModelController<TRowData>(store, options);
	return createApiFacade(store, () => {
		controller.dispose();
		store.destroy();
	});
}

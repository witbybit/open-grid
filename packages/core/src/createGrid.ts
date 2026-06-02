import { ApiBridge } from './apiBridge.js';
import { ClientRowModelController, type ClientRowModelOptions, type FilterModel, type SortModel } from './rowModel.js';
import { ServerRowModelController, type IGridDatasource, type ServerRowModelOptions } from './serverRowModel.js';
import {
	GridStore,
	type ColumnDef,
	type GridApi,
	type GridCellPointer,
	type GridEventListener,
	type GridSelectionSource,
	type GridState,
	type Listener,
} from './store.js';

export interface ClientGridOptions<TRowData> extends ClientRowModelOptions<TRowData> {
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
}

export interface ServerGridOptions<TRowData> extends ServerRowModelOptions<TRowData> {
	initialState?: Partial<GridState<TRowData>>;
}

function buildColumnWidths<TRowData>(columns: Array<ColumnDef<TRowData>>): Record<string, number> {
	return columns.reduce<Record<string, number>>((acc, column) => {
		if (column.width !== undefined) acc[column.field] = column.width;
		return acc;
	}, {});
}

export function createApiFacade<TRowData>(store: GridStore<TRowData>, destroy: () => void): GridApi<TRowData> & ApiBridge<TRowData> {
	const api = {
		getState: () => store.getState(),
		getRowId: (row: TRowData) => store.getRowId(row),
		isRowLoading: (rowId: string) => store.isRowLoading(rowId),
		getDataRowAtVisualIndex: (index: number) => store.getDataRowAtVisualIndex(index),
		getDataRowNodeAtVisualIndex: (index: number) => store.getDataRowNodeAtVisualIndex(index),
		setRows: (rows: TRowData[]) => store.setRows(rows),
		updateRows: (updater: (rows: TRowData[]) => TRowData[]) => store.updateRows(updater),
		refreshRows: () => store.refreshRows(),
		setRowHeights: (rowHeights: Record<string, number> | undefined) => store.setRowHeights(rowHeights),
		setDefaultRowHeight: (defaultRowHeight?: number | undefined) => store.setDefaultRowHeight(defaultRowHeight),
		purgeCache: () => store.purgeCache(),
		setServerDatasource: (datasource: IGridDatasource, blockSize?: number) => store.setServerDatasource(datasource, blockSize),
		getCellValue: (rowId: string, colField: string) => store.getCellValue(rowId, colField),
		setCellValue: (rowId: string, colField: string, value: unknown) => store.setCellValue(rowId, colField, value),
		getCellState: (rowId: string, colField: string) => store.getCellState(rowId, colField),
		selectCell: (pointer: GridCellPointer | null, source?: GridSelectionSource) => store.selectCell(pointer, source),
		selectRange: (start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource) =>
			store.selectRange(start, end, source),
		extendSelection: (end: GridCellPointer, source?: GridSelectionSource) => store.extendSelection(end, source),
		setColumns: (columns: ColumnDef<TRowData>[]) => store.setColumns(columns),
		setColumnWidth: (colField: string, width: number) => store.setColumnWidth(colField, width),
		moveColumn: (colField: string, toIndex: number) => store.moveColumn(colField, toIndex),
		setColumnOrder: (colFields: string[]) => store.setColumnOrder(colFields),
		setColumnReorderEnabled: (enabled: boolean) => store.setColumnReorderEnabled(enabled),
		setRowHeight: (rowId: string, height: number) => store.setRowHeight(rowId, height),
		setSortModel: (sortModel: SortModel | null) => store.setSortModel(sortModel),
		setFilterModel: (filterModel: FilterModel | null) => store.setFilterModel(filterModel),
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
		getColumnIndex: (colField: string) => store.getColumnIndex(colField),
		getColumnField: (colIndex: number) => store.getColumnField(colIndex),
		getColumnDef: (colField: string) => store.getColumnDef(colField),
		getCellAccess: (rowId: string, colField: string) => store.getCellAccess(rowId, colField),
		undo: () => store.undo(),
		redo: () => store.redo(),
		canUndo: () => store.canUndo(),
		canRedo: () => store.canRedo(),
		destroy,
	};

	Object.defineProperties(api, {
		__getEngine: {
			value: () => store.engine,
		},
		__getInternalApi: {
			value: () => store,
		},
	});

	return Object.freeze(api) as GridApi<TRowData> & ApiBridge<TRowData>;
}

export function createClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const store = new GridStore<TRowData>({
		columns: options.columns,
		getRowId: options.getRowId,
		columnWidths: buildColumnWidths(options.columns),
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
		columnWidths: buildColumnWidths(options.columns),
		...options.initialState,
	});

	const controller = new ServerRowModelController<TRowData>(store, options);

	return createApiFacade(store, () => {
		controller.dispose();
		store.destroy();
	});
}

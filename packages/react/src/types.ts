import type {
	ColumnDef,
	CellEditorProps,
	CellRendererProps,
	FilterModel,
	SortModel,
	IGridDatasource,
	GridApi,
	GridCellClickParams,
	GridState,
	FilterModelItem,
	VisualRow,
	HeaderMenuRendererProps,
} from '@open-grid/core';

export type {
	ColumnDef,
	CellEditorProps,
	CellRendererProps,
	FilterModel,
	FilterModelItem,
	SortModel,
	IGridDatasource as GridDatasource,
	GridApi,
	GridCellClickParams,
	GridState,
	VisualRow,
	HeaderMenuRendererProps,
};

export interface ClientGridOptions<TRowData> {
	rows: TRowData[];
	columns: ColumnDef<TRowData>[];
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
}

export interface ServerGridOptions<TRowData> {
	datasource: IGridDatasource;
	columns: ColumnDef<TRowData>[];
	blockSize?: number;
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
}

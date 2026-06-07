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
	DataVisualRow,
	GroupVisualRow,
	DetailVisualRow,
	FooterVisualRow,
	LoadingVisualRow,
	HeaderMenuRendererProps,
	CellRendererCapabilities,
	CellRendererPhase,
	DomCellRenderer,
	DomCellRendererHandle,
	DomCellRendererParams,
	ImperativeCellHandle,
} from '@open-grid/core';
export { isDomCellRenderer } from '@open-grid/core';

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
	DataVisualRow,
	GroupVisualRow,
	DetailVisualRow,
	FooterVisualRow,
	LoadingVisualRow,
	HeaderMenuRendererProps,
	CellRendererCapabilities,
	CellRendererPhase,
	DomCellRenderer,
	DomCellRendererHandle,
	DomCellRendererParams,
	ImperativeCellHandle,
};

export interface ClientGridOptions<TRowData> {
	rows: TRowData[];
	columns: ColumnDef<TRowData>[];
	getRowId?: (row: TRowData) => string;
	/** Number of extra rows to render beyond the visible area (default: 12). */
	rowBuffer?: number;
	/** Number of extra columns to render beyond the visible area (default: 2). */
	colBuffer?: number;
	/** Override the per-frame render budget caps. */
	runtimeLimits?: GridState<TRowData>['runtimeLimits'];
	initialState?: Partial<GridState<TRowData>>;
}

export interface ServerGridOptions<TRowData> {
	datasource: IGridDatasource;
	columns: ColumnDef<TRowData>[];
	blockSize?: number;
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
}

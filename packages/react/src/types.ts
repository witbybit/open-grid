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
export type { GroupDef } from '@open-grid/core';

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

/**
 * Fields from GridState that can be configured as top-level props on both
 * ClientGridOptions and ServerGridOptions. Sourced from the canonical GridState
 * type so these never drift out of sync with the core.
 */
type GridRenderOptions<TRowData> = Pick<GridState<TRowData>, 'rowOverscanPx' | 'colBuffer' | 'overscanAdaptive' | 'runtimeLimits'>;

export interface ClientGridOptions<TRowData> extends GridRenderOptions<TRowData> {
	rows: TRowData[];
	columns: ColumnDef<TRowData>[];
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
}

export interface ServerGridOptions<TRowData> extends GridRenderOptions<TRowData> {
	datasource: IGridDatasource;
	columns: ColumnDef<TRowData>[];
	blockSize?: number;
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
}

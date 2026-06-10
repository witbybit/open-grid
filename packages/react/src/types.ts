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
	GridPersistenceAdapter,
} from '@open-grid/core';
export { isDomCellRenderer, createLocalStorageAdapter } from '@open-grid/core';
export type {
	GroupDef,
	AggregationDef,
	CsvExportOptions,
	GridPersistenceAdapter,
	PersistedGridState,
	PersistenceStatus,
	PersistenceSaveStatus,
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
	/**
	 * Enable first-class row selection. When set to `'multiple'`, a built-in checkbox
	 * column is automatically prepended and pinned to the left — no manual column def needed.
	 */
	rowSelection?: 'single' | 'multiple';
	/**
	 * Persistence adapter. Pass `createLocalStorageAdapter(key)` for localStorage,
	 * or provide a custom adapter for remote/API-backed storage.
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

export interface ServerGridOptions<TRowData> extends GridRenderOptions<TRowData> {
	datasource: IGridDatasource;
	columns: ColumnDef<TRowData>[];
	blockSize?: number;
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
	/**
	 * Persistence adapter — same interface as client grid.
	 * Persists column order, visibility, widths, sort, filters, and group display
	 * settings. Row data is not persisted (always fetched from the server datasource).
	 */
	persistence?: GridPersistenceAdapter;
}

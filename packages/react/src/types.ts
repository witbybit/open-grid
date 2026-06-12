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
import type { ColumnTypeDefinition } from './renderers/CellTypes.js';
import type { StyleRule } from './styleRules.js';
export { isDomCellRenderer, createLocalStorageAdapter, GridEventName } from '@open-grid/core';
export type { ColumnTypeDefinition } from './renderers/CellTypes.js';
export type { StyleRule, RowStyleRule, CellStyleRule, HeaderCellStyleRule } from './styleRules.js';
export type {
	GroupDef,
	AggregationDef,
	CsvExportOptions,
	GridEventPayloadMap,
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
	/**
	 * Map of type name → ColumnTypeDefinition. Merged with built-in types (`checkbox`, `date`, `number`);
	 * user entries override built-ins with the same name.
	 *
	 * Use the `type` field on a `ColumnDef` to reference a registered type.
	 *
	 * @example
	 * columnTypes={{ currency: { renderer: { kind: 'react', component: CurrencyRenderer } } }}
	 */
	columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
	/**
	 * Declarative array of row/cell styling rules. Compiled into a single `setStyleSlots` call —
	 * same performance as the imperative API with less boilerplate for common patterns.
	 *
	 * Rules are evaluated in order; all matching rules contribute classes (space-joined).
	 * Memoize with `useMemo` to avoid unnecessary recompilation on each render.
	 *
	 * @example
	 * styleRules={[
	 *   { kind: 'row',  when: (row) => row.pnl < 0, rowClass: 'text-rose-400' },
	 *   { kind: 'cell', field: 'price', when: (row) => row.price > 100, cellClass: 'font-bold' },
	 * ]}
	 */
	styleRules?: StyleRule<TRowData>[];
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
	/** Named column types, same as ClientGridOptions.columnTypes. */
	columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
	/** Declarative style rules, same as ClientGridOptions.styleRules. */
	styleRules?: StyleRule<TRowData>[];
}

export interface ClientGridInitialOptions<TRowData> {
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
	rowSelection?: 'single' | 'multiple';
	persistence?: GridPersistenceAdapter;
	rowOverscanPx?: number;
	colBuffer?: number;
	overscanAdaptive?: boolean;
	runtimeLimits?: GridState<TRowData>['runtimeLimits'];
}

export interface ClientGridLiveOptions<TRowData> {
	rows: TRowData[];
	columns: ColumnDef<TRowData>[];
	columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
	styleRules?: StyleRule<TRowData>[];
}

export interface ClientGridLifecycleOptions<TRowData> {
	initial: ClientGridInitialOptions<TRowData>;
	live: ClientGridLiveOptions<TRowData>;
}

export interface ServerGridInitialOptions<TRowData> {
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
	persistence?: GridPersistenceAdapter;
	rowOverscanPx?: number;
	colBuffer?: number;
	overscanAdaptive?: boolean;
	runtimeLimits?: GridState<TRowData>['runtimeLimits'];
}

export interface ServerGridLiveOptions<TRowData> {
	datasource: IGridDatasource;
	columns: ColumnDef<TRowData>[];
	blockSize?: number;
	columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
	styleRules?: StyleRule<TRowData>[];
}

export interface ServerGridLifecycleOptions<TRowData> {
	initial: ServerGridInitialOptions<TRowData>;
	live: ServerGridLiveOptions<TRowData>;
}

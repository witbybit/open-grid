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
 * Fields from GridState that can be configured as top-level props on the public
 * Grid component. Sourced from the canonical GridState type so these never drift
 * out of sync with the core.
 */
type GridRenderOptions<TRowData> = Pick<GridState<TRowData>, 'rowOverscanPx' | 'colBuffer' | 'overscanAdaptive' | 'runtimeLimits'>;

export type GridMode = 'client' | 'server';

export interface GridReadyEvent<TRowData = unknown> {
	api: GridApi<TRowData>;
	mode: GridMode;
}

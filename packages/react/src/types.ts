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
	GridStateSnapshot,
	ColumnFilter,
	FilterCondition,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SetFilterCondition,
	CompoundFilterCondition,
	TextFilterOperator,
	NumberFilterOperator,
	DateFilterOperator,
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
	BuiltInThemeName,
	ThemeTokens,
	GridStyleRule,
	RowStyleRule,
	GroupRowStyleRule,
	DetailRowStyleRule,
	CellStyleRule,
	HeaderCellStyleRule,
	RowSelectionMode,
	RowSelectionOptions,
	RowSelectionScope,
	SelectRowsOptions,
	SelectAllRowsOptions,
} from '@open-grid/core';
import type { ColumnTypeDefinition } from './renderers/CellTypes.js';
export { isDomCellRenderer, createLocalStorageAdapter, GridEventName } from '@open-grid/core';
export type { ColumnTypeDefinition } from './renderers/CellTypes.js';
export type { RowStyleRule, GroupRowStyleRule, DetailRowStyleRule, CellStyleRule, HeaderCellStyleRule } from '@open-grid/core';
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
	ColumnFilter,
	FilterCondition,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SetFilterCondition,
	CompoundFilterCondition,
	TextFilterOperator,
	NumberFilterOperator,
	DateFilterOperator,
	SortModel,
	IGridDatasource as GridDatasource,
	GridApi,
	GridCellClickParams,
	GridState,
	GridStateSnapshot,
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
	BuiltInThemeName,
	ThemeTokens,
	RowSelectionMode,
	RowSelectionOptions,
	RowSelectionScope,
	SelectRowsOptions,
	SelectAllRowsOptions,
};

export type StyleRule<TRowData = unknown> = GridStyleRule<TRowData>;

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

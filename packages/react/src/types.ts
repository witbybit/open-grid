import type {
	ColumnDef,
	CellEditorProps,
	CellRendererProps,
	FilterModel,
	QuickFilterModel,
	SortModel,
	GridApi,
	GridCellClickParams,
	GridWriteBlockedEventPayload,
	GridInitialState,
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
	RowModelType,
	InfiniteDatasource,
	ServerDatasource,
	ServerPaginationOptions,
	ServerPageState,
} from '@eregister/open-grid-core';
import type { ColumnTypeDefinition } from './renderers/CellTypes.js';
export { isDomCellRenderer, createLocalStorageAdapter, GridEventName } from '@eregister/open-grid-core';
export type { ColumnTypeDefinition } from './renderers/CellTypes.js';
export type { RowStyleRule, GroupRowStyleRule, DetailRowStyleRule, CellStyleRule, HeaderCellStyleRule } from '@eregister/open-grid-core';
export type {
	GroupDef,
	AggregationDef,
	CsvExportOptions,
	GridEventPayloadMap,
	GridPersistenceAdapter,
	PersistedGridState,
	PersistenceStatus,
	PersistenceSaveStatus,
	GridWorkspaceAdapter,
	GridViewDefinition,
	GridWorkspaceState,
	SaveViewOptions,
} from '@eregister/open-grid-core';
export { createLocalStorageWorkspaceAdapter } from '@eregister/open-grid-core';

export type {
	ColumnDef,
	CellEditorProps,
	CellRendererProps,
	FilterModel,
	QuickFilterModel,
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
	GridApi,
	GridCellClickParams,
	GridWriteBlockedEventPayload,
	GridInitialState,
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

export type { RowModelType, InfiniteDatasource, ServerDatasource, ServerPaginationOptions, ServerPageState };

export type {
	GridQueryModel,
	GridQueryGroup,
	GridQueryCondition,
	GridQueryNode,
	QueryDiagnostics,
	QueryConditionDiagnostic,
	QueryEvaluationContext,
	QueryOperatorDefinition,
	GridDistinctValueSummary,
} from '@eregister/open-grid-core';
export { createEmptyQueryModel, isQueryModelActive, countQueryNodes, getQueryOperator, getQueryOperatorsForType } from '@eregister/open-grid-core';

export type {
	GridCapabilityAction,
	GridCapabilityParams,
	GridCapabilityResult,
	GridCapabilityCallback,
	GridCapabilitiesConfig,
	CapabilityDiagnostics,
} from '@eregister/open-grid-core';
export { normalizeCapabilityResult, CAPABILITY_ALLOWED } from '@eregister/open-grid-core';

/**
 * Fields from GridInitialState that can be configured as top-level props on the public
 * Grid component. Sourced from the canonical GridInitialState type so these never drift
 * out of sync with the core.
 */
type GridRenderOptions<TRowData> = Pick<GridInitialState<TRowData>, 'rowOverscanPx' | 'colBuffer' | 'overscanAdaptive' | 'runtimeLimits'>;

export interface GridReadyEvent<TRowData = unknown> {
	api: GridApi<TRowData>;
	rowModelType: RowModelType;
}

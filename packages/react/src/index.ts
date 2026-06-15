export { Grid } from './Grid.js';
export type { GridProps, GridClientProps, GridServerProps, GridPaginationConfig } from './Grid.js';
export type { ChartType, ChartTheme, ValueFormat } from './chart/GridChartOverlay.js';
export { PortalCell, PortalManager } from './GridPortal.js';
export { useGridApi, useGridSelector, useGridKeySelector } from './hooks.js';
export type { BuiltinSidebarPanelId, GridSidebarConfig, SidebarPanelDef } from './sidebar/GridSidebar.js';
export {
	BUILT_IN_THEMES,
	BUILT_IN_THEME_ORDER,
	BUILT_IN_THEME_METADATA,
	getBuiltInTheme,
	isBuiltInThemeName,
	createTheme,
	themeToCSSVariables,
} from '@open-grid/core';

// ─── Built-in cell renderers & editors ───────────────────────────────────────
export {
	// Checkbox
	CheckboxCellRenderer,
	// Multi-select
	MultiSelectCellRenderer,
	createMultiSelectCellRenderer,
	createMultiSelectCellEditor,
	// Date
	DateCellRenderer,
	DateCellEditor,
	// Dropdown / enum badge
	createDropdownCellRenderer,
	createDropdownCellEditor,
	// Number
	createNumberCellRenderer,
	createNumberCellEditor,
	// Utilities
	parseMultiValue,
	TagsCellRenderer,
	// Column type registry
	BUILTIN_COLUMN_TYPES,
	// Column type helpers
	numberColumnType,
	multiSelectColumnType,
	dropdownColumnType,
} from './renderers/CellTypes.js';
export type {
	DropdownOption,
	DropdownOptionColor,
	NumberCellRendererOptions,
	NumberCellEditorOptions,
	ColumnTypeDefinition,
} from './renderers/CellTypes.js';

export { isDomCellRenderer, createLocalStorageAdapter, GridEventName } from './types.js';
export type { GridEventPayloadMap, GridPersistenceAdapter, PersistedGridState, PersistenceStatus, PersistenceSaveStatus } from './types.js';
export type { StyleRule, RowStyleRule, GroupRowStyleRule, DetailRowStyleRule, CellStyleRule, HeaderCellStyleRule } from './types.js';
export type {
	ColumnDef,
	CellEditorProps,
	CellRendererProps,
	FilterModel,
	SortModel,
	GridDatasource,
	GridApi,
	GridCellClickParams,
	GridState,
	VisualRow,
	DataVisualRow,
	GroupVisualRow,
	DetailVisualRow,
	FooterVisualRow,
	LoadingVisualRow,
	GroupDef,
	AggregationDef,
	CsvExportOptions,
	CellRendererCapabilities,
	CellRendererPhase,
	DomCellRenderer,
	DomCellRendererHandle,
	DomCellRendererParams,
	ImperativeCellHandle,
	GridReadyEvent,
	BuiltInThemeName,
	ThemeTokens,
	RowSelectionMode,
	RowSelectionOptions,
	RowSelectionScope,
	SelectRowsOptions,
	SelectAllRowsOptions,
} from './types.js';

export type {
	GridContextMenuOptions,
	GridContextMenuItem,
	GridCellPointer,
	HeaderMenuRendererProps,
	CellValidationError,
	RowValidatorParams,
	RowValidator,
	ValueValidatorParams,
	EditableParams,
	TooltipParams,
	AutoSizeColumnOptions,
	AutoSizeAllColumnsOptions,
} from '@open-grid/core';

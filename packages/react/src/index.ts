export { OpenGrid, GridView } from './OpenGrid.js';
export type { OpenGridProps, GridViewProps } from './OpenGrid.js';
export { ClientGrid } from './ClientGrid.js';
export type { ClientGridProps } from './ClientGrid.js';
export { ServerGrid } from './ServerGrid.js';
export type { ServerGridProps } from './ServerGrid.js';
export { GridProvider } from './gridContext.js';
export { GridPagination, useClientGridPagination } from './pagination.js';
export type { GridPaginationProps, ClientGridPaginationResult } from './pagination.js';
export type { ChartType, ChartTheme, ValueFormat } from './chart/GridChartOverlay.js';
export { PortalCell, PortalManager } from './GridPortal.js';
export { useClientGrid, useServerGrid } from './useGrid.js';
export { useGridApi, useGridSelector, useGridKeySelector } from './hooks.js';
export type { BuiltinSidebarPanelId, GridSidebarConfig, SidebarPanelDef } from './sidebar/GridSidebar.js';

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
export { useStyleRules } from './styleRules.js';
export type { StyleRule, RowStyleRule, CellStyleRule, HeaderCellStyleRule } from './styleRules.js';
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
	ClientGridOptions,
	ServerGridOptions,
	FilterModelItem,
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
} from './types.js';

export type { GridContextMenuOptions, GridContextMenuItem, HeaderMenuRendererProps } from '@open-grid/core';

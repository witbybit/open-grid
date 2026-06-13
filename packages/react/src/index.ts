export { Grid } from './Grid.js';
export type { GridProps, GridClientProps, GridServerProps } from './Grid.js';
export { GridStatusBar } from './GridStatusBar.js';
export { GridPagination, useClientGridPagination } from './pagination.js';
export type { GridPaginationProps, ClientGridPaginationResult } from './pagination.js';
export type { ChartType, ChartTheme, ValueFormat } from './chart/GridChartOverlay.js';
export { PortalCell, PortalManager } from './GridPortal.js';
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
	GridReadyEvent,
	GridPaginationOptions,
} from './types.js';

export type { GridContextMenuOptions, GridContextMenuItem, GridCellPointer, HeaderMenuRendererProps } from '@open-grid/core';

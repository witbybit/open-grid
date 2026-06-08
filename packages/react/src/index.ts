export { OpenGrid, GridProvider } from './OpenGrid.js';
export type { OpenGridProps } from './OpenGrid.js';
export type { ChartType, ChartTheme, ValueFormat } from './chart/GridChartOverlay.js';
export { PortalCell, PortalManager } from './GridPortal.js';
export { useClientGrid, useServerGrid } from './useGrid.js';
export {
	useGridApi,
	useGridSelector,
	useGridSelectorWithEquality,
	useGridKeySelector,
	useGridKeySelectorWithEquality,
	useGridNavigationController,
} from './hooks.js';
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
} from './renderers/CellTypes.js';
export type { DropdownOption, DropdownOptionColor, NumberCellRendererOptions, NumberCellEditorOptions } from './renderers/CellTypes.js';

export { isDomCellRenderer } from './types.js';
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
	CellRendererCapabilities,
	CellRendererPhase,
	DomCellRenderer,
	DomCellRendererHandle,
	DomCellRendererParams,
	ImperativeCellHandle,
} from './types.js';

export type { GridContextMenuOptions, GridContextMenuItem, HeaderMenuRendererProps } from '@open-grid/core';

// ── Main grid components ───────────────────────────────────────────────────
export { Grid } from './Grid.js';
export type { GridProps, GridColumnDef } from './Grid.js';

export { GridNext } from './GridNext.js';
export type { GridNextProps, GridNextColumnDef } from './GridNext.js';

// ── React context + hooks ──────────────────────────────────────────────────
export { GridApiContext, GridApiProvider } from './gridContext.js';
export type { GridApiProviderProps } from './gridContext.js';
export { useGridApi, useGridSelector, useGridKeySelector } from './hooks.js';

// ── Portal system ─────────────────────────────────────────────────────────
export { GridPortalStore } from './gridPortalStore.js';
export type { PortalEntry } from './gridPortalStore.js';
export { GridPortal } from './GridPortal.js';
export type { CellRendererProps, GridPortalProps } from './GridPortal.js';

// ── Themes (re-exported from core for convenience) ─────────────────────────
export {
	BUILT_IN_THEMES,
	BUILT_IN_THEME_ORDER,
	BUILT_IN_THEME_METADATA,
	getBuiltInTheme,
	isBuiltInThemeName,
	createTheme,
	themeToCSSVariables,
	ThemeManager,
} from '@open-grid/core';
export type { ThemeTokens, BuiltInThemeName } from '@open-grid/core';

// ── Built-in cell renderers / editors / column types ──────────────────────
export {
	CheckboxCellRenderer,
	MultiSelectCellRenderer,
	createMultiSelectCellRenderer,
	createMultiSelectCellEditor,
	DateCellRenderer,
	DateCellEditor,
	createDropdownCellRenderer,
	createDropdownCellEditor,
	createNumberCellRenderer,
	createNumberCellEditor,
	parseMultiValue,
	TagsCellRenderer,
	BUILTIN_COLUMN_TYPES,
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

// ── Core types re-exported for consumer convenience ────────────────────────
export type {
	ColumnDef,
	ColumnPin,
	RowNode,
	RowId,
	RowModelType,
	FilterModel,
	SortModel,
	ColumnFilter,
	SortKey,
	VisualRow,
	GroupByColumn,
	GroupByModel,
	TreeDataOptions,
	GridApi,
	GridCommandResult,
	RendererEngineView,
} from '@open-grid/core';
export { createGrid, asRowId, asColumnId, DomGridRenderer } from '@open-grid/core';

// Validation rules and domCellRenderer are on the rebuild TODO — stubs will be
// added when the data integrity pipeline (§13) is implemented.

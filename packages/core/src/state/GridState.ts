import type { FilterModel, SortDirection, SortModel } from '../rowModel.js';
import type { AggregationDef } from '../rows/stages/aggregateStage.js';
import type { ColumnDef, GridStyleRule } from '../columnDef.js';
import type { BuiltInThemeName } from '../renderer/themes.js';
import type { ViewportRange } from '../viewportController.js';
import type { GridSelectionState, ActiveEditState, RowSelectionOptions } from '../api/GridApi.js';

/**
 * User-configured and persisted fields.
 * Serialize this slice to localStorage / server for state restoration.
 * All fields either come from the user at construction time or are mutated
 * by explicit user actions (sort, filter, column resize, etc.).
 */
export interface GridModelState<TRowData = unknown> {
	getRowId?: (row: TRowData) => string;
	columns: ColumnDef<TRowData>[];
	defaultRowHeight: number;
	defaultColWidth: number;
	enableColumnReorder: boolean;

	rowHeights: Record<string, number>; // rowId -> height in px
	columnWidths: Record<string, number>; // colField -> width in px

	sortModel: SortModel | null;
	filterModel: FilterModel | null;
	themeName: BuiltInThemeName;

	groupBy?: string[];
	aggDefs?: AggregationDef<TRowData>[];
	showGroupFooter?: boolean;
	enableStickyGroupRows?: boolean;
	showGroupPanel?: boolean;
	showFilterChipBar?: boolean;
	pinnedColumns?: { left: number; right: number };

	// Bottom chrome (Plan 039 Phase 5). Presence gates the bottom-chrome height in the
	// layout plan; full panel/page config is filled in when the feature lands.
	showStatusBar?: boolean;
	pagination?: { pageSize: number; page?: number };

	selectedRowIds: string[];
	rowSelection?: RowSelectionOptions;

	expansion: {
		groups: Record<string, true>;
		treeRows: Record<string, true>;
		details: Record<string, true>;
	};

	// Row model configuration — structural, not persisted for serialization
	getParentId?: (row: TRowData) => string | null | undefined;
	masterDetailEnabled?: boolean;
	groupRowHeight?: number;
	detailRowHeight?: number;
	detailRenderer?: unknown;
	rowModelConfig?: import('../rowModel.js').RowModelConfig<TRowData>;

	// Render tuning config
	styleRules?: GridStyleRule<TRowData>[];
	rowOverscanPx?: number;
	/**
	 * Number of off-screen columns to pre-render on each side of the visible range.
	 * Higher values smooth fast horizontal scrolls at the cost of extra DOM nodes.
	 * Lower values maximise DOM savings but risk blank columns during rapid swipes.
	 * Default: 2. Finance grids with narrow columns (80–120 px) benefit from at least 2.
	 */
	colBuffer?: number;
	runtimeLimits?: {
		maxRenderedRows?: number;
		maxRenderedCells?: number;
		suppressRenderedRangeLimit?: boolean;
	};
	overscanAdaptive?: boolean;
}

/**
 * Derived, ephemeral runtime state.
 * Never persist this slice — it is recomputed on every render cycle.
 */
export interface GridRuntimeState {
	// Incremented on any change that restructures the visual row set (sort, filter, group, row add/remove).
	globalVersion: number;
	// 2D recycled viewport range states
	visibleRowRange: ViewportRange;
	visibleColRange: ViewportRange;
	// Cell range selection (focus, anchor, range, bounds)
	selection: GridSelectionState;
}

/**
 * Transient UI state — session-only, not persisted by default.
 * Controls loading indicators, open panels, active editor, etc.
 */
export interface GridUIState {
	loading?: boolean;
	loadingSkeletonCount?: number;
	activeEdit: ActiveEditState | null;
	/**
	 * Sparse map of `rowId:colField` → error message for cells with active validation errors.
	 * Set by `api.validateCell()` / `api.validateGrid()`, cleared by `api.clearValidationErrors()`.
	 * Also populated when a cell edit fails validation and the editor is closed without fixing it.
	 */
	validationErrors?: Record<string, string>;
	sidebarOpenPanel?: string | null;
	chartOpen?: boolean;
	serverPagination?: {
		page: number;
		pageCount: number;
		totalRows: number;
		pageSize: number;
	};
}

/**
 * Full grid state: intersection of model, runtime, and UI slices.
 * Preserved as a single type for backward compat — all existing code that
 * reads or writes `GridState` fields continues to compile unchanged.
 * Future: callers will migrate to reading from the specific slice they need.
 */
export type GridState<TRowData = unknown> = GridModelState<TRowData> & GridRuntimeState & GridUIState;

/** Serializable snapshot of a single column's user-configurable state. */
export interface ColumnState {
	field: string;
	width?: number;
	hide?: boolean;
	/** Pin lane. Omitted for hidden columns. `false` means explicitly unpinned. */
	pinned?: 'left' | 'right' | false;
	/** Sort direction. `null` means explicitly no sort on this column. */
	sort?: SortDirection | null;
	/** Zero-based position in the multi-column sort order. */
	sortIndex?: number;
}

export interface GridCellRangeBounds {
	minRow: number;
	maxRow: number;
	minCol: number;
	maxCol: number;
}

export type GridStateUpdater<TRowData = unknown> = Partial<GridState<TRowData>> | ((state: GridState<TRowData>) => Partial<GridState<TRowData>>);

export type Listener<TRowData = unknown> = (state: GridState<TRowData>) => void;

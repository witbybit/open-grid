import type { ColumnDef, GridCellPointer, GridSelectionState, GridStyleSlots } from '../store.js';
import type { SortModel, FilterModel } from '../rowModel.js';

export interface GridEngineConfig<TRowData = unknown> {
	columns: ColumnDef<TRowData>[];
	getRowId?: (row: TRowData) => string;
	rowHeights?: Record<string, number>;
	columnWidths?: Record<string, number>;
	defaultRowHeight?: number;
	defaultColWidth?: number;
	enableColumnReorder?: boolean;
	selection?: GridSelectionState;
	selectedRowIds?: string[];
	sortModel?: SortModel | null;
	filterModel?: FilterModel | null;
	activeEdit?: GridCellPointer | null;
	loadingSkeletonCount?: number;
	styleSlots?: GridStyleSlots<TRowData>;
	loading?: boolean;

	// Tree / Grouping / Master-Detail State Configuration
	groupBy?: string[];
	getParentId?: (row: TRowData) => string | null | undefined;
	masterDetailEnabled?: boolean;
	groupRowHeight?: number;
	detailRowHeight?: number;
	detailRenderer?: unknown;
	rowModelConfig?: import('../rowModel.js').RowModelConfig<TRowData>;
	showGroupFooter?: boolean;
	enableStickyGroupRows?: boolean;
	expansion?: {
		groups: Record<string, true>;
		treeRows: Record<string, true>;
		details: Record<string, true>;
	};
	/**
	 * Pixel height of the pre-render buffer above and below the visible viewport.
	 * The grid renders all rows that overlap [visibleTop - rowOverscanPx, visibleBottom + rowOverscanPx],
	 * so the buffer is always a fixed pixel amount regardless of individual row heights.
	 * Default: 400px (roughly 10 rows at the default 40px row height).
	 */
	rowOverscanPx?: number;
	colBuffer?: number;
	runtimeLimits?: {
		maxRenderedRows?: number;
		maxRenderedCells?: number;
		suppressRenderedRangeLimit?: boolean;
	};
	/**
	 * When true, the overscan buffer automatically expands in the scroll direction proportional
	 * to scroll velocity, reducing blank-band flashes during fast scrolling.
	 * Default: false.
	 */
	overscanAdaptive?: boolean;
}

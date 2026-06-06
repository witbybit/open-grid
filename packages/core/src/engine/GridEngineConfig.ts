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
	expansion?: {
		groups: Record<string, true>;
		treeRows: Record<string, true>;
		details: Record<string, true>;
	};
	rowBuffer?: number;
	colBuffer?: number;
	rowRecyclingStrategy?: 'index-pool' | 'slot-pool';
	runtimeLimits?: {
		maxRenderedRows?: number;
		maxRenderedCells?: number;
		suppressRenderedRangeLimit?: boolean;
	};
	overscan?: {
		mode?: 'adaptive' | 'none';
	};
}

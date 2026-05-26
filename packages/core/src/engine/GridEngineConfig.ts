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
}

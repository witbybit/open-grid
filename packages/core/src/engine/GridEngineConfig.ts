import type { ColumnDef, GridCellPointer, GridCellRange, GridStyleSlots } from '../store.js';
import type { SortModel, FilterModel } from '../rowModel.js';

export interface GridEngineConfig<TRowData = unknown> {
	columns: ColumnDef<TRowData>[];
	getRowId?: (row: TRowData) => string;
	rowHeights?: Record<string, number>;
	columnWidths?: Record<string, number>;
	defaultRowHeight?: number;
	defaultColWidth?: number;
	focusedCell?: GridCellPointer | null;
	selectedRange?: GridCellRange | null;
	sortModel?: SortModel | null;
	filterModel?: FilterModel | null;
	activeEdit?: GridCellPointer | null;
	plugins?: any[];
	loadingSkeletonCount?: number;
	styleSlots?: GridStyleSlots<TRowData>;
}

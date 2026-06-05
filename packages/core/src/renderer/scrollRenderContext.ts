import type { ColumnDef, GridCellPointer, GridCellRangeBounds } from '../store.js';

export interface ScrollRenderContext<TRowData = unknown> {
	isScrolling: boolean;

	stateVersion: number;
	dataVersion: number;
	styleVersion: number;
	loadingVersion: number;

	activeEdit: GridCellPointer | null;

	hasStyleHooks: boolean;
	hasCustomRenderers: boolean;

	displayedColumns: ColumnDef<TRowData>[];
	visibleColRange: { startIdx: number; endIdx: number };

	focusedCell: GridCellPointer | null;
	selectionBounds?: GridCellRangeBounds;

	canUseCachedDisplayValues: boolean;
}

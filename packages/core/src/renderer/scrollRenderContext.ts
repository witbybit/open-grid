import type { CompiledGridPlan, GridCellPointer, GridCellRangeBounds, GridState } from '../store.js';

export interface ScrollRenderContext<TRowData = unknown> {
	isScrolling: boolean;

	state?: GridState<TRowData>;
	stateVersion: number;
	dataVersion: number;
	styleVersion: number;
	loadingVersion: number;

	activeEdit: GridCellPointer | null;

	hasStyleHooks: boolean;
	hasCustomRenderers: boolean;

	plan: CompiledGridPlan<TRowData>;
	visibleColRange: { startIdx: number; endIdx: number };

	focusedCell: GridCellPointer | null;
	selectionBounds?: GridCellRangeBounds;

	canUseCachedDisplayValues: boolean;
}

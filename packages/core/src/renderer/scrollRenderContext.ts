import type { CompiledGridPlan, GridCellPointer, GridCellRangeBounds, GridState } from '../store.js';

export interface ScrollRenderContext<TRowData = unknown> {
	isScrolling: boolean;

	state?: GridState<TRowData>;
	stateVersion: number;
	// Per-row version map: rowId → version bumped on each row data mutation.
	// Used by the freeze check to thaw only cells whose row actually changed.
	rowVersions: ReadonlyMap<string, number>;
	// Bumped on any structural change (sort, filter, group, row add/remove).
	// When this changes all frozen portals must thaw.
	globalVersion: number;
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

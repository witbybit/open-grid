import type { RowId } from '../rows/RowId.js';

/**
 * Row selection state (ARCHITECTURE.md §3 R11). Runtime state — what is selected and the range
 * anchor. Cell-range selection (`RangeSelectionModel`) is a separate concern added later.
 */
export interface SelectionState {
	readonly selectedRowIds: ReadonlySet<RowId>;
	/** The row a range extends from (last single-selected row). */
	readonly anchorRowId: RowId | null;
}

export const EMPTY_SELECTION: SelectionState = {
	selectedRowIds: new Set(),
	anchorRowId: null,
};

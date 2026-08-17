import type { RenderWindow } from './renderWindow.js';

export interface RowWindowRetentionInput {
	renderWindow: RenderWindow;
	/** Visual row index of the currently focused cell, if any (resolved by the caller). */
	focusedRowIndex: number | undefined;
	/** Visual row index of the currently active-edit cell, if any (resolved by the caller). */
	editingRowIndex: number | undefined;
}

export interface RowWindowRetentionResult {
	/** Row indices that must be treated as "in the render window" even though they fall outside
	 *  renderWindow.rowStart..rowEnd. The caller is responsible for actually widening the row-slot
	 *  assignment to include them (see rowRenderer.ts) — this function only decides WHICH indices. */
	retainedRowIndices: ReadonlySet<number>;
}

/**
 * Vertical-scroll analogue of the existing horizontal focused-column guard in
 * rowCellBindingLanes.ts's reconcileCellTopologyForScroll (`if (focusedColumnField)
 * visibleFields.add(focusedColumnField)`) — without this, a focused or actively-editing row can be
 * virtualized completely out of the row-slot pool, destroying its RowCtrl's physical attachment (the
 * RowCtrl itself survives via RowCtrlStore, but its edit/focus UI would visibly disappear).
 *
 * Pinned rows are excluded: they are already always rendered regardless of the window, so they
 * never need retention.
 */
export function computeRowWindowRetention(input: RowWindowRetentionInput): RowWindowRetentionResult {
	const { renderWindow, focusedRowIndex, editingRowIndex } = input;
	const retained = new Set<number>();
	const pinTop = renderWindow.pinTopRows;
	const pinBottomStart = renderWindow.rowCount - renderWindow.pinBottomRows;

	for (const idx of [focusedRowIndex, editingRowIndex]) {
		if (idx === undefined || idx < 0) continue;
		if (idx < pinTop || idx >= pinBottomStart) continue; // already always rendered (pinned)
		if (idx < renderWindow.rowStart || idx > renderWindow.rowEnd) retained.add(idx);
	}

	return { retainedRowIndices: retained };
}

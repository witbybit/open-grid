import type { RowHeightModel } from '../layout/RowHeightModel.js';

/** The inclusive range of row indices the viewport (plus overscan) covers. */
export interface VisibleWindow {
	readonly firstIndex: number;
	readonly lastIndex: number;
}

export const EMPTY_WINDOW: VisibleWindow = { firstIndex: 0, lastIndex: -1 };

/**
 * Compute the visible row index range for a scroll position (ARCHITECTURE.md §3 R12). `overscanPx`
 * extends the window above and below by a fixed pixel buffer so scrolling does not flash blank
 * bands. Returns an empty window when there are no rows.
 */
export function computeVisibleWindow(
	rows: RowHeightModel,
	scrollTop: number,
	viewportHeight: number,
	overscanPx = 0,
): VisibleWindow {
	const rowCount = rows.getRowCount();
	if (rowCount === 0 || viewportHeight <= 0) return EMPTY_WINDOW;

	const top = Math.max(0, scrollTop - overscanPx);
	const bottom = scrollTop + viewportHeight + overscanPx;

	const firstIndex = rows.rowIndexAtY(top);
	const lastIndex = rows.rowIndexAtY(Math.min(bottom, rows.getTotalHeight() - 1));
	return { firstIndex, lastIndex };
}

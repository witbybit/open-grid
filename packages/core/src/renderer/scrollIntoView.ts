export interface ScrollTarget {
	top: number;
	left: number;
}

export interface ScrollIntoViewParams {
	rowIndex: number;
	colIndex: number;
	rowCount: number;
	colCount: number;
	pinLeftColumns: number;
	pinRightColumns: number;
	pinTopRows: number;
	pinBottomRows: number;
	scrollTop: number;
	scrollLeft: number;
	viewportHeight: number;
	viewportWidth: number;
	rowTops: ArrayLike<number>;
	rowHeights: ArrayLike<number>;
	colLefts: ArrayLike<number>;
	colWidths: ArrayLike<number>;
	scrollViewportScrollHeight: number;
	scrollViewportScrollWidth: number;
	scrollViewportClientHeight: number;
	scrollViewportClientWidth: number;
}

/**
 * Computes the scroll position required to bring a cell into the visible area,
 * accounting for pinned rows/columns and viewport clamping.
 *
 * Returns null when the cell is already fully visible (no scroll needed).
 * Pure function — reads geometry arrays, produces a scroll target.
 */
export function computeScrollTarget(p: ScrollIntoViewParams): ScrollTarget | null {
	let pinnedLeftWidth = 0;
	for (let i = 0; i < p.pinLeftColumns && i < p.colCount; i++) {
		pinnedLeftWidth += p.colWidths[i] || 0;
	}
	let pinnedRightWidth = 0;
	for (let i = 0; i < p.pinRightColumns && i < p.colCount; i++) {
		pinnedRightWidth += p.colWidths[p.colCount - 1 - i] || 0;
	}
	let pinnedTopHeight = 0;
	for (let i = 0; i < p.pinTopRows && i < p.rowCount; i++) {
		pinnedTopHeight += p.rowHeights[i] || 0;
	}
	let pinnedBottomHeight = 0;
	for (let i = 0; i < p.pinBottomRows && i < p.rowCount; i++) {
		pinnedBottomHeight += p.rowHeights[p.rowCount - 1 - i] || 0;
	}

	let targetScrollTop = p.scrollTop;
	let targetScrollLeft = p.scrollLeft;

	// Vertical: only scroll unpinned rows into view
	if (p.rowIndex >= p.pinTopRows && p.rowIndex < p.rowCount - p.pinBottomRows) {
		const rowTop = p.rowTops[p.rowIndex] || 0;
		const rowHeight = p.rowHeights[p.rowIndex] || 0;
		const visibleTopLimit = p.scrollTop + pinnedTopHeight;
		const visibleBottomLimit = p.scrollTop + (p.viewportHeight - 40) - pinnedBottomHeight;

		if (rowTop < visibleTopLimit) {
			targetScrollTop = rowTop - pinnedTopHeight;
		} else if (rowTop + rowHeight > visibleBottomLimit) {
			targetScrollTop = rowTop + rowHeight - (p.viewportHeight - 40) + pinnedBottomHeight;
		}
	}

	// Horizontal: only scroll unpinned columns into view
	if (p.colIndex >= p.pinLeftColumns && p.colIndex < p.colCount - p.pinRightColumns) {
		const colLeft = p.colLefts[p.colIndex] || 0;
		const colWidth = p.colWidths[p.colIndex] || 0;
		const visibleLeftLimit = p.scrollLeft + pinnedLeftWidth;
		const visibleRightLimit = p.scrollLeft + p.viewportWidth - pinnedRightWidth;

		if (colLeft < visibleLeftLimit) {
			targetScrollLeft = colLeft - pinnedLeftWidth;
		} else if (colLeft + colWidth > visibleRightLimit) {
			targetScrollLeft = colLeft + colWidth - p.viewportWidth + pinnedRightWidth;
		}
	}

	// Clamp to scrollable bounds (skipped in headless envs where scrollHeight/Width are 0)
	if (p.scrollViewportScrollHeight > 0) {
		const maxScrollTop = Math.max(0, p.scrollViewportScrollHeight - p.scrollViewportClientHeight);
		targetScrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));
	} else {
		targetScrollTop = Math.max(0, targetScrollTop);
	}
	if (p.scrollViewportScrollWidth > 0) {
		const maxScrollLeft = Math.max(0, p.scrollViewportScrollWidth - p.scrollViewportClientWidth);
		targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));
	} else {
		targetScrollLeft = Math.max(0, targetScrollLeft);
	}

	if (targetScrollTop === p.scrollTop && targetScrollLeft === p.scrollLeft) return null;
	return { top: targetScrollTop, left: targetScrollLeft };
}

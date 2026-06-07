import type { GridEngine } from '../engine/GridEngine.js';

export interface RenderWindow {
	rowStart: number;
	rowEnd: number;
	colStart: number;
	colEnd: number;
	pinLeftCols: number;
	pinRightCols: number;
	pinTopRows: number;
	pinBottomRows: number;
	rowCount: number;
	colCount: number;
	scrollTop: number;
	scrollLeft: number;
	viewportWidth: number;
	viewportHeight: number;
	geometryVersion?: number;
	rowModelVersion?: number;
	columnVersion?: number;
	// Phase 9: pixel-first windowing fields
	/** Top pixel of the visible (non-pinned) area, accounting for pinned top rows. */
	visibleTop?: number;
	/** Bottom pixel of the visible area, accounting for pinned bottom rows. */
	visibleBottom?: number;
	/** Top pixel of the fully-buffered render region (includes overscan above visible). */
	bufferTopPx?: number;
	/** Bottom pixel of the fully-buffered render region (includes overscan below visible). */
	bufferBottomPx?: number;
}

export interface ViewportDelta {
	rowsEntered: number[];
	rowsExited: number[];
	rowsStayed: number[];
	colsEntered: number[];
	colsExited: number[];
	colsStayed: number[];
	hasChanges: boolean;
}

export function sameRenderedWindow(a: RenderWindow | null, b: RenderWindow | null): boolean {
	if (!a || !b) return false;
	return (
		a.rowStart === b.rowStart &&
		a.rowEnd === b.rowEnd &&
		a.colStart === b.colStart &&
		a.colEnd === b.colEnd &&
		a.pinLeftCols === b.pinLeftCols &&
		a.pinRightCols === b.pinRightCols &&
		a.pinTopRows === b.pinTopRows &&
		a.pinBottomRows === b.pinBottomRows &&
		a.rowCount === b.rowCount &&
		a.colCount === b.colCount &&
		(a.geometryVersion ?? 0) === (b.geometryVersion ?? 0) &&
		(a.rowModelVersion ?? 0) === (b.rowModelVersion ?? 0) &&
		(a.columnVersion ?? 0) === (b.columnVersion ?? 0)
	);
}

export interface RenderWindowRuntimeLimits {
	maxRenderedRows?: number;
	maxRenderedCells?: number;
	suppressRenderedRangeLimit?: boolean;
}

function countPinnedLeading(count: number, total: number): number {
	return Math.max(0, Math.min(count, total));
}

function countPinnedTrailing(count: number, total: number, leading: number): number {
	return Math.max(0, Math.min(count, Math.max(0, total - leading)));
}

export function getRowIndices(w: RenderWindow): number[] {
	const pinTop = Math.min(w.pinTopRows, w.rowCount);
	const pinBottomStart = Math.max(pinTop, w.rowCount - w.pinBottomRows);
	const indices: number[] = [];
	// Pinned top
	for (let r = 0; r < pinTop; r++) indices.push(r);
	// Center scrollable (never overlaps with pinned ranges due to bounds)
	for (let r = w.rowStart; r <= w.rowEnd; r++) {
		if (r >= pinTop && r < pinBottomStart) indices.push(r);
	}
	// Pinned bottom
	for (let r = pinBottomStart; r < w.rowCount; r++) indices.push(r);
	return indices;
}

export function getColIndices(w: RenderWindow): number[] {
	const pinLeft = Math.min(w.pinLeftCols, w.colCount);
	const pinRightStart = Math.max(pinLeft, w.colCount - w.pinRightCols);
	const indices: number[] = [];
	// Pinned left
	for (let c = 0; c < pinLeft; c++) indices.push(c);
	// Center scrollable
	for (let c = w.colStart; c <= w.colEnd; c++) {
		if (c >= pinLeft && c < pinRightStart) indices.push(c);
	}
	// Pinned right
	for (let c = pinRightStart; c < w.colCount; c++) indices.push(c);
	return indices;
}

export function applyRenderWindowRuntimeLimits(window: RenderWindow, limits?: RenderWindowRuntimeLimits, onClamp?: () => void): RenderWindow {
	if (limits?.suppressRenderedRangeLimit) return window;

	const maxRenderedRows = limits?.maxRenderedRows ?? 500;
	const maxRenderedCells = limits?.maxRenderedCells ?? 20000;

	// Quick-exit: approximate bounds check before any object allocation.
	// This is the common path — most frames are within limits.
	const approxCenterRows = Math.max(0, window.rowEnd - window.rowStart + 1);
	const approxCenterCols = Math.max(0, window.colEnd - window.colStart + 1);
	const approxTotalRows = window.pinTopRows + approxCenterRows + window.pinBottomRows;
	const approxTotalCols = window.pinLeftCols + approxCenterCols + window.pinRightCols;
	if (approxTotalRows <= maxRenderedRows && approxTotalRows * approxTotalCols <= maxRenderedCells) {
		return window;
	}

	const next = { ...window };
	let clamped = false;

	const pinTopRows = countPinnedLeading(next.pinTopRows, next.rowCount);
	const pinBottomRows = countPinnedTrailing(next.pinBottomRows, next.rowCount, pinTopRows);
	const centerRowMin = pinTopRows;
	const centerRowMax = next.rowCount - pinBottomRows - 1;

	if (centerRowMax >= centerRowMin) {
		next.rowStart = Math.max(centerRowMin, Math.min(next.rowStart, centerRowMax));
		next.rowEnd = Math.max(next.rowStart, Math.min(next.rowEnd, centerRowMax));

		if (maxRenderedRows > 0) {
			const pinnedRows = pinTopRows + pinBottomRows;
			const centerBudget = Math.max(1, maxRenderedRows - pinnedRows);
			const expectedRowEnd = Math.max(next.rowStart, Math.min(next.rowEnd, next.rowStart + centerBudget - 1));
			if (expectedRowEnd < next.rowEnd) {
				next.rowEnd = expectedRowEnd;
				clamped = true;
			}
		}
	} else {
		next.rowStart = 0;
		next.rowEnd = 0;
	}

	const pinLeftCols = countPinnedLeading(next.pinLeftCols, next.colCount);
	const pinRightCols = countPinnedTrailing(next.pinRightCols, next.colCount, pinLeftCols);
	const centerColMin = pinLeftCols;
	const centerColMax = next.colCount - pinRightCols - 1;

	if (centerColMax >= centerColMin) {
		next.colStart = Math.max(centerColMin, Math.min(next.colStart, centerColMax));
		next.colEnd = Math.max(next.colStart, Math.min(next.colEnd, centerColMax));

		if (maxRenderedCells > 0) {
			const renderedRows = Math.max(1, getRowIndices(next).length);
			const pinnedCols = pinLeftCols + pinRightCols;
			const totalColsBudget = Math.max(1, Math.floor(maxRenderedCells / renderedRows));
			const centerBudget = Math.max(1, totalColsBudget - pinnedCols);
			const expectedColEnd = Math.max(next.colStart, Math.min(next.colEnd, next.colStart + centerBudget - 1));
			if (expectedColEnd < next.colEnd) {
				next.colEnd = expectedColEnd;
				clamped = true;
			}
		}
	} else {
		next.colStart = 0;
		next.colEnd = 0;
	}

	if (clamped) {
		if (typeof (globalThis as any).process === 'undefined' || (globalThis as any).process?.env?.NODE_ENV !== 'production') {
			console.warn(
				`[OpenGrid] Render limits exceeded. Clamped rendering window: rows=${getRowIndices(next).length}/${getRowIndices(window).length}, cells=${getRowIndices(next).length * getColIndices(next).length}/${getRowIndices(window).length * getColIndices(window).length}.`
			);
		}
		if (onClamp) {
			onClamp();
		}
	}

	return next;
}

export function computeRenderWindow<TRowData>(engine: GridEngine<TRowData>): RenderWindow {
	const rowModel = engine.getRowModel();
	let rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
	const state = engine.stateManager.getState();
	if (state.loading && rowCount === 0) {
		rowCount = state.loadingSkeletonCount ?? 15;
	}
	const colCount = engine.columns.getDisplayedColumnCount();

	const pinLeftCols = engine.viewport.pinLeftColumns;
	const pinRightCols = engine.viewport.pinRightColumns;
	const pinTopRows = engine.viewport.pinTopRows;
	const pinBottomRows = engine.viewport.pinBottomRows;

	const newRowRange = engine.viewport.getVisibleRowRange(rowCount);
	const newColRange = engine.viewport.getVisibleColumnRange(colCount);

	// Phase 9: compute pixel bounds for pixel-first windowing
	let pinnedTopHeight = 0;
	for (let i = 0; i < pinTopRows && i < rowCount; i++) {
		pinnedTopHeight += engine.geometry.getRowHeight(i, 40);
	}
	let pinnedBottomHeight = 0;
	for (let i = 0; i < pinBottomRows && i < rowCount; i++) {
		pinnedBottomHeight += engine.geometry.getRowHeight(rowCount - 1 - i, 40);
	}
	const scrollTop = engine.viewport.scrollTop;
	const viewportHeight = engine.viewport.viewportHeight;
	const visibleTop = scrollTop + pinnedTopHeight;
	const visibleBottom = scrollTop + viewportHeight - pinnedBottomHeight;

	// Buffer pixel bounds: pixel extent of the first/last rendered rows
	const bufferTopPx = newRowRange.startIdx >= 0 ? engine.geometry.getRowTop(newRowRange.startIdx, 40) : visibleTop;
	const lastRenderedBottom =
		newRowRange.endIdx >= 0
			? engine.geometry.getRowTop(newRowRange.endIdx, 40) + engine.geometry.getRowHeight(newRowRange.endIdx, 40)
			: visibleBottom;

	return {
		rowStart: newRowRange.startIdx,
		rowEnd: newRowRange.endIdx,
		colStart: newColRange.startIdx,
		colEnd: newColRange.endIdx,
		pinLeftCols,
		pinRightCols,
		pinTopRows,
		pinBottomRows,
		rowCount,
		colCount,
		scrollTop,
		scrollLeft: engine.viewport.scrollLeft,
		viewportWidth: engine.viewport.viewportWidth,
		viewportHeight,
		geometryVersion: (engine as any).geometryVersion ?? 0,
		rowModelVersion: (engine as any).rowModelVersion ?? 0,
		columnVersion: (engine as any).columnVersion ?? 0,
		visibleTop,
		visibleBottom,
		bufferTopPx,
		bufferBottomPx: lastRenderedBottom,
	};
}

export function diffRenderWindow(prev: RenderWindow | null, next: RenderWindow): ViewportDelta {
	if (!prev) {
		const nextRows = getRowIndices(next);
		const nextCols = getColIndices(next);
		return {
			rowsEntered: nextRows,
			rowsExited: [],
			rowsStayed: nextRows,
			colsEntered: nextCols,
			colsExited: [],
			colsStayed: nextCols,
			hasChanges: true,
		};
	}

	// Fast path: contiguous center ranges when geometry and pinned lanes are unchanged
	if (
		prev.pinTopRows === next.pinTopRows &&
		prev.pinBottomRows === next.pinBottomRows &&
		prev.rowCount === next.rowCount &&
		prev.pinLeftCols === next.pinLeftCols &&
		prev.pinRightCols === next.pinRightCols &&
		prev.colCount === next.colCount
	) {
		const rowsEntered: number[] = [];
		const rowsExited: number[] = [];
		const rowsStayed: number[] = [];

		const pinTop = next.pinTopRows;
		const pinBottom = next.pinBottomRows;
		const rowCount = next.rowCount;

		// Pinned top
		for (let r = 0; r < pinTop && r < rowCount; r++) {
			rowsStayed.push(r);
		}

		// Center scrollable rows bounds
		const prevStart = Math.max(pinTop, prev.rowStart);
		const prevEnd = Math.min(rowCount - 1 - pinBottom, prev.rowEnd);
		const nextStart = Math.max(pinTop, next.rowStart);
		const nextEnd = Math.min(rowCount - 1 - pinBottom, next.rowEnd);

		if (prevStart <= prevEnd && nextStart <= nextEnd) {
			const stayedStart = Math.max(prevStart, nextStart);
			const stayedEnd = Math.min(prevEnd, nextEnd);

			if (stayedStart <= stayedEnd) {
				for (let r = stayedStart; r <= stayedEnd; r++) {
					rowsStayed.push(r);
				}
				if (nextStart < prevStart) {
					for (let r = nextStart; r < prevStart; r++) {
						rowsEntered.push(r);
					}
				}
				if (nextEnd > prevEnd) {
					for (let r = prevEnd + 1; r <= nextEnd; r++) {
						rowsEntered.push(r);
					}
				}
				if (nextStart > prevStart) {
					for (let r = prevStart; r < nextStart; r++) {
						rowsExited.push(r);
					}
				}
				if (nextEnd < prevEnd) {
					for (let r = nextEnd + 1; r <= prevEnd; r++) {
						rowsExited.push(r);
					}
				}
			} else {
				for (let r = nextStart; r <= nextEnd; r++) {
					rowsEntered.push(r);
				}
				for (let r = prevStart; r <= prevEnd; r++) {
					rowsExited.push(r);
				}
			}
		} else if (nextStart <= nextEnd) {
			for (let r = nextStart; r <= nextEnd; r++) {
				rowsEntered.push(r);
			}
		} else if (prevStart <= prevEnd) {
			for (let r = prevStart; r <= prevEnd; r++) {
				rowsExited.push(r);
			}
		}

		// Pinned bottom
		const pinBottomStart = Math.max(0, rowCount - pinBottom);
		for (let r = pinBottomStart; r < rowCount; r++) {
			if (r >= pinTop) {
				rowsStayed.push(r);
			}
		}

		// Columns
		const colsEntered: number[] = [];
		const colsExited: number[] = [];
		const colsStayed: number[] = [];

		const pinLeft = next.pinLeftCols;
		const pinRight = next.pinRightCols;
		const colCount = next.colCount;

		// Pinned left
		for (let c = 0; c < pinLeft && c < colCount; c++) {
			colsStayed.push(c);
		}

		const prevColStart = Math.max(pinLeft, prev.colStart);
		const prevColEnd = Math.min(colCount - 1 - pinRight, prev.colEnd);
		const nextColStart = Math.max(pinLeft, next.colStart);
		const nextColEnd = Math.min(colCount - 1 - pinRight, next.colEnd);

		if (prevColStart <= prevColEnd && nextColStart <= nextColEnd) {
			const stayedStart = Math.max(prevColStart, nextColStart);
			const stayedEnd = Math.min(prevColEnd, nextColEnd);

			if (stayedStart <= stayedEnd) {
				for (let c = stayedStart; c <= stayedEnd; c++) {
					colsStayed.push(c);
				}
				if (nextColStart < prevColStart) {
					for (let c = nextColStart; c < prevColStart; c++) {
						colsEntered.push(c);
					}
				}
				if (nextColEnd > prevColEnd) {
					for (let c = prevColEnd + 1; c <= nextColEnd; c++) {
						colsEntered.push(c);
					}
				}
				if (nextColStart > prevColStart) {
					for (let c = prevColStart; c < nextColStart; c++) {
						colsExited.push(c);
					}
				}
				if (nextColEnd < prevColEnd) {
					for (let c = nextColEnd + 1; c <= prevColEnd; c++) {
						colsExited.push(c);
					}
				}
			} else {
				for (let c = nextColStart; c <= nextColEnd; c++) {
					colsEntered.push(c);
				}
				for (let c = prevColStart; c <= prevColEnd; c++) {
					colsExited.push(c);
				}
			}
		} else if (nextColStart <= nextColEnd) {
			for (let c = nextColStart; c <= nextColEnd; c++) {
				colsEntered.push(c);
			}
		} else if (prevColStart <= prevColEnd) {
			for (let c = prevColStart; c <= prevColEnd; c++) {
				colsExited.push(c);
			}
		}

		// Pinned right
		const pinRightStart = Math.max(0, colCount - pinRight);
		for (let c = pinRightStart; c < colCount; c++) {
			if (c >= pinLeft) {
				colsStayed.push(c);
			}
		}

		const hasChanges =
			rowsEntered.length > 0 ||
			rowsExited.length > 0 ||
			colsEntered.length > 0 ||
			colsExited.length > 0 ||
			((next.pinTopRows > 0 || next.pinBottomRows > 0) && prev.scrollTop !== next.scrollTop);

		return {
			rowsEntered,
			rowsExited,
			rowsStayed,
			colsEntered,
			colsExited,
			colsStayed,
			hasChanges,
		};
	}

	const prevRows = getRowIndices(prev);
	const nextRows = getRowIndices(next);
	const prevCols = getColIndices(prev);
	const nextCols = getColIndices(next);

	// One reusable Set for membership tests — cleared between row and col phases
	const scratch = new Set<number>();

	for (const r of prevRows) scratch.add(r);
	const rowsEntered: number[] = [];
	const rowsExited: number[] = [];
	const rowsStayed: number[] = [];
	for (const r of nextRows) (scratch.has(r) ? rowsStayed : rowsEntered).push(r);
	scratch.clear();
	for (const r of nextRows) scratch.add(r);
	for (const r of prevRows) if (!scratch.has(r)) rowsExited.push(r);

	scratch.clear();
	for (const c of prevCols) scratch.add(c);
	const colsEntered: number[] = [];
	const colsExited: number[] = [];
	const colsStayed: number[] = [];
	for (const c of nextCols) (scratch.has(c) ? colsStayed : colsEntered).push(c);
	scratch.clear();
	for (const c of nextCols) scratch.add(c);
	for (const c of prevCols) if (!scratch.has(c)) colsExited.push(c);

	const hasChanges =
		rowsEntered.length > 0 ||
		rowsExited.length > 0 ||
		colsEntered.length > 0 ||
		colsExited.length > 0 ||
		prev.pinLeftCols !== next.pinLeftCols ||
		prev.pinRightCols !== next.pinRightCols ||
		prev.pinTopRows !== next.pinTopRows ||
		prev.pinBottomRows !== next.pinBottomRows ||
		((next.pinTopRows > 0 || next.pinBottomRows > 0) && prev.scrollTop !== next.scrollTop);

	return {
		rowsEntered,
		rowsExited,
		rowsStayed,
		colsEntered,
		colsExited,
		colsStayed,
		hasChanges,
	};
}

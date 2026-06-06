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
	const indices: number[] = [];
	// Pinned top
	for (let r = 0; r < w.pinTopRows && r < w.rowCount; r++) {
		indices.push(r);
	}
	// Center scrollable
	for (let r = w.rowStart; r <= w.rowEnd; r++) {
		if (r >= w.pinTopRows && r < w.rowCount - w.pinBottomRows) {
			indices.push(r);
		}
	}
	// Pinned bottom
	for (let r = w.rowCount - w.pinBottomRows; r < w.rowCount; r++) {
		if (r >= 0 && r >= w.pinTopRows) {
			indices.push(r);
		}
	}
	return Array.from(new Set(indices)); // Deduplicate just in case of overlaps
}

export function getColIndices(w: RenderWindow): number[] {
	const indices: number[] = [];
	// Pinned left
	for (let c = 0; c < w.pinLeftCols && c < w.colCount; c++) {
		indices.push(c);
	}
	// Center scrollable
	for (let c = w.colStart; c <= w.colEnd; c++) {
		if (c >= w.pinLeftCols && c < w.colCount - w.pinRightCols) {
			indices.push(c);
		}
	}
	// Pinned right
	for (let c = w.colCount - w.pinRightCols; c < w.colCount; c++) {
		if (c >= 0 && c >= w.pinLeftCols) {
			indices.push(c);
		}
	}
	return Array.from(new Set(indices)); // Deduplicate
}

export function applyRenderWindowRuntimeLimits(window: RenderWindow, limits?: RenderWindowRuntimeLimits): RenderWindow {
	if (!limits || limits.suppressRenderedRangeLimit) return window;

	const next = { ...window };

	const pinTopRows = countPinnedLeading(next.pinTopRows, next.rowCount);
	const pinBottomRows = countPinnedTrailing(next.pinBottomRows, next.rowCount, pinTopRows);
	const centerRowMin = pinTopRows;
	const centerRowMax = next.rowCount - pinBottomRows - 1;

	if (centerRowMax >= centerRowMin) {
		next.rowStart = Math.max(centerRowMin, Math.min(next.rowStart, centerRowMax));
		next.rowEnd = Math.max(next.rowStart, Math.min(next.rowEnd, centerRowMax));

		if (limits.maxRenderedRows && limits.maxRenderedRows > 0) {
			const pinnedRows = pinTopRows + pinBottomRows;
			const centerBudget = Math.max(1, limits.maxRenderedRows - pinnedRows);
			next.rowEnd = Math.max(next.rowStart, Math.min(next.rowEnd, next.rowStart + centerBudget - 1));
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

		if (limits.maxRenderedCells && limits.maxRenderedCells > 0) {
			const renderedRows = Math.max(1, getRowIndices(next).length);
			const pinnedCols = pinLeftCols + pinRightCols;
			const totalColsBudget = Math.max(1, Math.floor(limits.maxRenderedCells / renderedRows));
			const centerBudget = Math.max(1, totalColsBudget - pinnedCols);
			next.colEnd = Math.max(next.colStart, Math.min(next.colEnd, next.colStart + centerBudget - 1));
		}
	} else {
		next.colStart = 0;
		next.colEnd = 0;
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
		scrollTop: engine.viewport.scrollTop,
		scrollLeft: engine.viewport.scrollLeft,
		viewportWidth: engine.viewport.viewportWidth,
		viewportHeight: engine.viewport.viewportHeight,
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

	const prevRows = getRowIndices(prev);
	const nextRows = getRowIndices(next);
	const prevCols = getColIndices(prev);
	const nextCols = getColIndices(next);

	const prevRowSet = new Set(prevRows);
	const nextRowSet = new Set(nextRows);
	const prevColSet = new Set(prevCols);
	const nextColSet = new Set(nextCols);

	const rowsEntered = nextRows.filter((r) => !prevRowSet.has(r));
	const rowsExited = prevRows.filter((r) => !nextRowSet.has(r));
	const rowsStayed = nextRows.filter((r) => prevRowSet.has(r));

	const colsEntered = nextCols.filter((c) => !prevColSet.has(c));
	const colsExited = prevCols.filter((c) => !nextColSet.has(c));
	const colsStayed = nextCols.filter((c) => prevColSet.has(c));

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

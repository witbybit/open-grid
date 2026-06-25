/**
 * RenderScrollCoordinator
 *
 * Maintains a double-buffered pair of RenderWindows and computes whether a
 * repaint is needed after a scroll or geometry change. Zero allocations on the
 * hot path — both buffer slots are pre-allocated at construction time and
 * swapped in-place each update.
 */

import { type RenderWindow, createEmptyRenderWindow, copyRenderWindow, sameRenderedWindow } from './RenderWindow.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RenderScrollCoordinatorOptions {
	/** Extra pixels to render above and below the visible viewport. Default 200. */
	rowOverscanPx?: number;
	/** Extra columns to render beyond each side of the visible center region. Default 2. */
	colBuffer?: number;
}

export interface RenderScrollCoordinatorUpdateParams {
	scrollTop: number;
	scrollLeft: number;
	viewportWidth: number;
	viewportHeight: number;
	/** Total number of rows in the row model. */
	rowCount: number;
	/** Uniform row height in pixels (used when a row-tops array is not available). */
	defaultRowHeight: number;
	/** Pixels of row overscan to apply (overrides constructor default for this call). */
	rowOverscanPx: number;
	/** Number of columns pinned to the left edge (always visible). */
	pinLeftCount: number;
	/** Number of columns pinned to the right edge (always visible). */
	pinRightCount: number;
	/** Number of center (scrollable) columns. */
	centerColCount: number;
	/**
	 * Placement of every column in the center region.
	 * Index 0 corresponds to the first center column (after left pins).
	 * `absoluteLeft` is the column's left edge measured from the start of the
	 * scrollable canvas (i.e. does NOT include pinned-left width).
	 */
	colPlacements: Array<{ absoluteLeft: number; width: number }>;
	/** Bump this whenever the row model changes structurally. */
	rowVersion: number;
	/** Bump this whenever the column layout changes. */
	colVersion: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class RenderScrollCoordinator {
	private readonly _opts: Required<RenderScrollCoordinatorOptions>;

	/**
	 * Double-buffer: bufs[activeIdx] is the most recently computed window;
	 * bufs[1 - activeIdx] is the previously rendered window (or the zeroed
	 * initial state before the first update).
	 */
	private readonly _bufs: [RenderWindow, RenderWindow];
	private _activeIdx: 0 | 1 = 0;

	constructor(options?: RenderScrollCoordinatorOptions) {
		this._opts = {
			rowOverscanPx: options?.rowOverscanPx ?? 200,
			colBuffer: options?.colBuffer ?? 2,
		};
		this._bufs = [createEmptyRenderWindow(), createEmptyRenderWindow()];
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/**
	 * Recompute the render window from the supplied scroll/geometry parameters.
	 *
	 * Returns `true` when the new window differs from the previous one in a way
	 * that requires a repaint (row/col indices, version stamps, or viewport
	 * dimensions changed).  Returns `false` when the scroll merely moved within
	 * the same buffered region.
	 */
	public update(params: RenderScrollCoordinatorUpdateParams): boolean {
		const candidateIdx = (1 - this._activeIdx) as 0 | 1;
		const candidate = this._bufs[candidateIdx];
		const current = this._bufs[this._activeIdx];

		this._computeInto(candidate, params);

		if (sameRenderedWindow(current, candidate)) {
			// Still within the same rendered window — update scroll position on the
			// active buffer in-place so getCurrent() always reflects the live scroll,
			// but report no repaint needed.
			current.scrollTop = params.scrollTop;
			current.scrollLeft = params.scrollLeft;
			return false;
		}

		// Swap buffers: candidate becomes the new active window.
		this._activeIdx = candidateIdx;
		return true;
	}

	/** The most recently computed (current) RenderWindow. */
	public getCurrent(): Readonly<RenderWindow> {
		return this._bufs[this._activeIdx];
	}

	/**
	 * The previously rendered RenderWindow (the state before the last update
	 * that returned `true`).  On first call this is the zeroed initial window.
	 */
	public getPrevious(): Readonly<RenderWindow> {
		return this._bufs[(1 - this._activeIdx) as 0 | 1];
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private _computeInto(dst: RenderWindow, p: RenderScrollCoordinatorUpdateParams): void {
		const overscan = p.rowOverscanPx ?? this._opts.rowOverscanPx;
		const colBuffer = this._opts.colBuffer;

		// --- Scroll / viewport ---------------------------------------------------
		dst.scrollTop = p.scrollTop;
		dst.scrollLeft = p.scrollLeft;
		dst.viewportWidth = p.viewportWidth;
		dst.viewportHeight = p.viewportHeight;
		dst.pinLeftCount = p.pinLeftCount;
		dst.pinRightCount = p.pinRightCount;

		// --- Row window ----------------------------------------------------------
		const rowH = p.defaultRowHeight > 0 ? p.defaultRowHeight : 40;
		const rowCount = p.rowCount;

		// Buffered pixel range (absolute canvas coords).
		const bufTop = Math.max(0, p.scrollTop - overscan);
		const bufBottom = p.scrollTop + p.viewportHeight + overscan;

		// Row indices: simple uniform-height derivation.
		const rowStart = rowCount > 0 ? Math.max(0, Math.floor(bufTop / rowH)) : 0;
		const rowEnd = rowCount > 0 ? Math.min(rowCount - 1, Math.ceil(bufBottom / rowH) - 1) : 0;

		dst.rowStart = rowStart;
		dst.rowEnd = rowEnd;

		// Pixel bounds of the visible (non-buffered) area.
		dst.visibleTop = p.scrollTop;
		dst.visibleBottom = p.scrollTop + p.viewportHeight;
		dst.bufferTopPx = bufTop;
		dst.bufferBottomPx = bufBottom;

		// --- Column window -------------------------------------------------------
		const centerCount = p.centerColCount;
		const placements = p.colPlacements;

		if (centerCount === 0 || placements.length === 0) {
			dst.colStart = 0;
			dst.colEnd = 0;
		} else {
			// Find the first center column whose right edge is past scrollLeft.
			const visLeft = p.scrollLeft;
			const visRight = p.scrollLeft + p.viewportWidth;

			let colStart = 0;
			let colEnd = centerCount - 1;

			// Binary-search for the first column that overlaps the left edge.
			let lo = 0;
			let hi = Math.min(centerCount - 1, placements.length - 1);
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				const col = placements[mid];
				if (col.absoluteLeft + col.width <= visLeft) {
					lo = mid + 1;
				} else {
					hi = mid;
				}
			}
			colStart = Math.max(0, lo - colBuffer);

			// Linear scan from colStart to find the last visible column.
			colEnd = colStart;
			for (let c = colStart; c < Math.min(centerCount, placements.length); c++) {
				if (placements[c].absoluteLeft >= visRight) break;
				colEnd = c;
			}
			colEnd = Math.min(centerCount - 1, colEnd + colBuffer);

			dst.colStart = colStart;
			dst.colEnd = colEnd;
		}

		// --- Version stamps ------------------------------------------------------
		dst.rowVersion = p.rowVersion;
		dst.colVersion = p.colVersion;
	}
}

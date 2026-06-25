/**
 * RenderWindow — a complete snapshot of what rows/columns are visible in the current
 * scroll frame. Consumed by the renderer to determine which cells to paint; used by
 * change-detection to skip redundant renders.
 *
 * Design notes:
 * - Pure data: no methods, no class, no external dependencies.
 * - Version stamps (rowVersion, colVersion) let callers short-circuit equality checks
 *   without comparing every field.
 * - Pixel fields (visibleTop/Bottom, bufferTopPx/BottomPx) carry absolute canvas
 *   coordinates so overlay/sticky systems need not re-derive them.
 */

export interface RenderWindow {
	// ---------------------------------------------------------------------------
	// Row window (indices into the visual row model)
	// ---------------------------------------------------------------------------

	/** First visible row index (inclusive). */
	rowStart: number;
	/** Last visible row index (inclusive). */
	rowEnd: number;

	// ---------------------------------------------------------------------------
	// Column window (indices into the displayed column list)
	// ---------------------------------------------------------------------------

	/** First visible center-scrollable column index (inclusive). */
	colStart: number;
	/** Last visible center-scrollable column index (inclusive). */
	colEnd: number;

	/** Number of always-visible pinned columns on the left edge. */
	pinLeftCount: number;
	/** Number of always-visible pinned columns on the right edge. */
	pinRightCount: number;

	// ---------------------------------------------------------------------------
	// Scroll position (pixels)
	// ---------------------------------------------------------------------------

	scrollTop: number;
	scrollLeft: number;

	// ---------------------------------------------------------------------------
	// Viewport dimensions (pixels)
	// ---------------------------------------------------------------------------

	viewportWidth: number;
	viewportHeight: number;

	// ---------------------------------------------------------------------------
	// Visible content bounds (pixels, absolute within the scroll canvas)
	// ---------------------------------------------------------------------------

	/** Top of the visible row area in canvas pixels (accounts for pinned top rows). */
	visibleTop: number;
	/** Bottom of the visible row area in canvas pixels (accounts for pinned bottom rows). */
	visibleBottom: number;

	/** Top of the fully-buffered render region — includes overscan rows above the visible area. */
	bufferTopPx: number;
	/** Bottom of the fully-buffered render region — includes overscan rows below the visible area. */
	bufferBottomPx: number;

	// ---------------------------------------------------------------------------
	// Version stamps for cheap change detection
	// ---------------------------------------------------------------------------

	/** Monotonically increasing version for the row model. Bump on any structural row change. */
	rowVersion: number;
	/** Monotonically increasing version for the column layout. Bump on any column change. */
	colVersion: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a zeroed RenderWindow suitable for use as a pre-allocated double-buffer slot. */
export function createEmptyRenderWindow(): RenderWindow {
	return {
		rowStart: 0,
		rowEnd: 0,
		colStart: 0,
		colEnd: 0,
		pinLeftCount: 0,
		pinRightCount: 0,
		scrollTop: 0,
		scrollLeft: 0,
		viewportWidth: 0,
		viewportHeight: 0,
		visibleTop: 0,
		visibleBottom: 0,
		bufferTopPx: 0,
		bufferBottomPx: 0,
		rowVersion: 0,
		colVersion: 0,
	};
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

/**
 * Return true when two RenderWindows describe the same rendered state.
 *
 * Scroll position (scrollTop/scrollLeft) is intentionally excluded from the
 * comparison: moving within the same row/column window should not trigger a
 * re-render unless the windowed indices or versions change. Callers that care
 * about pixel-exact scroll position (e.g. sticky row positioning) must check
 * those fields independently.
 */
export function sameRenderedWindow(a: RenderWindow, b: RenderWindow): boolean {
	return (
		a.rowStart === b.rowStart &&
		a.rowEnd === b.rowEnd &&
		a.colStart === b.colStart &&
		a.colEnd === b.colEnd &&
		a.pinLeftCount === b.pinLeftCount &&
		a.pinRightCount === b.pinRightCount &&
		a.viewportWidth === b.viewportWidth &&
		a.viewportHeight === b.viewportHeight &&
		a.visibleTop === b.visibleTop &&
		a.visibleBottom === b.visibleBottom &&
		a.bufferTopPx === b.bufferTopPx &&
		a.bufferBottomPx === b.bufferBottomPx &&
		a.rowVersion === b.rowVersion &&
		a.colVersion === b.colVersion
	);
}

// ---------------------------------------------------------------------------
// Copy (in-place, zero allocation on the hot path)
// ---------------------------------------------------------------------------

/**
 * Copy all fields from `src` into `dst` in-place.
 *
 * Used by the double-buffer hot path so the renderer can keep a stable
 * reference to the "last rendered" window without allocating a new object
 * every frame.
 */
export function copyRenderWindow(src: RenderWindow, dst: RenderWindow): void {
	dst.rowStart = src.rowStart;
	dst.rowEnd = src.rowEnd;
	dst.colStart = src.colStart;
	dst.colEnd = src.colEnd;
	dst.pinLeftCount = src.pinLeftCount;
	dst.pinRightCount = src.pinRightCount;
	dst.scrollTop = src.scrollTop;
	dst.scrollLeft = src.scrollLeft;
	dst.viewportWidth = src.viewportWidth;
	dst.viewportHeight = src.viewportHeight;
	dst.visibleTop = src.visibleTop;
	dst.visibleBottom = src.visibleBottom;
	dst.bufferTopPx = src.bufferTopPx;
	dst.bufferBottomPx = src.bufferBottomPx;
	dst.rowVersion = src.rowVersion;
	dst.colVersion = src.colVersion;
}

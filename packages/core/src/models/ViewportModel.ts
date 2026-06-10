import type { GridEngine } from '../engine/GridEngine.js';
import type { ViewportRange } from '../viewportController.js';

export class ViewportModel<TRowData = unknown> {
	private engine!: GridEngine<TRowData>;

	public scrollTop = 0;
	public scrollLeft = 0;
	public viewportWidth = 0;
	public viewportHeight = 0;

	// Pinned configuration (Columns and Rows)
	public pinLeftColumns = 0;
	public pinRightColumns = 0;
	public pinTopRows = 0;
	public pinBottomRows = 0;

	// Scroll velocity tracking
	private lastTimestamp = 0;
	private velocityY = 0; // px/ms
	private velocityX = 0; // px/ms

	// Centralized velocity threshold for high-performance optimizations (px/ms)
	private readonly FAST_SCROLL_THRESHOLD = 5;

	// Adaptive overscan state. Raw velocity fluctuates on every scroll event; feeding it
	// straight into the buffer bounds shifts the render window almost every frame, which
	// defeats the sameRenderedWindow() bailout exactly when scrolling fastest. We quantize
	// the adaptive expansion to coarse buckets and only let it SHRINK after a run of calm
	// frames (hysteresis), so the window stays stable across many frames.
	private static readonly ADAPTIVE_ROW_QUANTUM_PX = 200;
	private static readonly ADAPTIVE_COL_QUANTUM = 5;
	private static readonly ADAPTIVE_SHRINK_FRAMES = 12;
	private adaptiveTopPx = 0;
	private adaptiveBottomPx = 0;
	private adaptiveLeftCols = 0;
	private adaptiveRightCols = 0;
	private calmTop = 0;
	private calmBottom = 0;
	private calmLeft = 0;
	private calmRight = 0;

	// Scratch out-param for the hold helper (avoids per-frame closures/objects).
	private heldCalm = 0;

	/**
	 * Quantize-and-hold: grow immediately to the bucketed target, shrink only after
	 * ADAPTIVE_SHRINK_FRAMES consecutive calls wanting a smaller value.
	 * Returns the held value; the updated calm counter is left in this.heldCalm.
	 */
	private holdAdaptive(current: number, target: number, calm: number): number {
		if (target >= current || calm + 1 >= ViewportModel.ADAPTIVE_SHRINK_FRAMES) {
			this.heldCalm = 0;
			return target;
		}
		this.heldCalm = calm + 1;
		return current;
	}

	/**
	 * Evaluates if the grid is currently scrolling faster than the fluid performance threshold.
	 */
	public get isScrollingFast(): boolean {
		return Math.abs(this.velocityY) > this.FAST_SCROLL_THRESHOLD || Math.abs(this.velocityX) > this.FAST_SCROLL_THRESHOLD;
	}

	/**
	 * Resets scroll velocity tracking back to rest (0).
	 */
	public resetVelocity(): void {
		this.velocityY = 0;
		this.velocityX = 0;
	}

	public init(engine: GridEngine<TRowData>): void {
		this.engine = engine;
	}

	public setViewportSize(width: number, height: number): boolean {
		if (this.viewportWidth === width && this.viewportHeight === height) {
			return false;
		}
		this.viewportWidth = width;
		this.viewportHeight = height;
		return true;
	}

	public setScrollPosition(scrollTop: number, scrollLeft: number, timestamp: number = performance.now()): boolean {
		if (this.scrollTop === scrollTop && this.scrollLeft === scrollLeft) {
			return false;
		}

		const timeDelta = timestamp - this.lastTimestamp;
		if (timeDelta > 0 && this.lastTimestamp > 0) {
			this.velocityY = (scrollTop - this.scrollTop) / timeDelta;
			this.velocityX = (scrollLeft - this.scrollLeft) / timeDelta;
		} else {
			this.velocityY = 0;
			this.velocityX = 0;
		}

		this.scrollTop = scrollTop;
		this.scrollLeft = scrollLeft;
		this.lastTimestamp = timestamp;

		return true;
	}

	public getVelocity(): { vx: number; vy: number } {
		return { vx: this.velocityX, vy: this.velocityY };
	}

	public getVisibleRowRange(rowCount: number): ViewportRange {
		if (rowCount === 0 || this.viewportHeight === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const tops = this.engine.geometry.rowTops;
		if (tops.length === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const state = this.engine.stateManager.getState();
		const defaultRowHeight = state.defaultRowHeight ?? 40;

		// Pixel heights consumed by pinned top and bottom bands.
		// Pinned rows are always rendered and excluded from the scrollable range.
		let pinnedTopHeight = 0;
		if (this.pinTopRows > 0) {
			for (let i = 0; i < this.pinTopRows && i < rowCount; i++) {
				pinnedTopHeight += this.engine.geometry.getRowHeight(i, defaultRowHeight);
			}
		}
		let pinnedBottomHeight = 0;
		if (this.pinBottomRows > 0) {
			for (let i = 0; i < this.pinBottomRows && i < rowCount; i++) {
				pinnedBottomHeight += this.engine.geometry.getRowHeight(rowCount - 1 - i, defaultRowHeight);
			}
		}

		// Pixel boundaries of the scrollable visible area (excludes pinned bands).
		const visibleTop = this.scrollTop + pinnedTopHeight;
		const visibleBottom = this.scrollTop + this.viewportHeight - pinnedBottomHeight;

		// Pixel-first overscan: fixed px budget that scales correctly with variable row heights.
		// A tall row costs proportionally more of the budget than a short one, so the number of
		// buffered rows self-adjusts — no more under/over-shoot with variable-height grids.
		const baseOverscanPx = state.rowOverscanPx ?? 400;

		let overscanTopPx = baseOverscanPx;
		let overscanBottomPx = baseOverscanPx;

		// Adaptive mode: expand the leading edge buffer proportional to scroll velocity.
		// Cap at 2× the base so very high velocity doesn't mount an unbounded number of rows.
		// Quantized to ADAPTIVE_ROW_QUANTUM_PX buckets + shrink hysteresis so the resulting
		// render window stays identical across frames (keeps the same-window bailout alive).
		if (state.overscanAdaptive) {
			const quantum = ViewportModel.ADAPTIVE_ROW_QUANTUM_PX;
			const wantBottom = this.velocityY > 0.2 ? Math.ceil(Math.min(baseOverscanPx * 2, this.velocityY * 600) / quantum) * quantum : 0;
			const wantTop = this.velocityY < -0.2 ? Math.ceil(Math.min(baseOverscanPx * 2, -this.velocityY * 600) / quantum) * quantum : 0;
			this.adaptiveBottomPx = this.holdAdaptive(this.adaptiveBottomPx, wantBottom, this.calmBottom);
			this.calmBottom = this.heldCalm;
			overscanBottomPx += this.adaptiveBottomPx;
			this.adaptiveTopPx = this.holdAdaptive(this.adaptiveTopPx, wantTop, this.calmTop);
			this.calmTop = this.heldCalm;
			overscanTopPx += this.adaptiveTopPx;
		}

		// Pixel boundaries of the full buffered render region.
		const bufferTopPx = Math.max(0, visibleTop - overscanTopPx);
		const bufferBottomPx = visibleBottom + overscanBottomPx;

		// O(log R) binary searches to map pixel bounds → row indices.
		const startIdx = Math.max(this.pinTopRows, this.engine.geometry.getRowIndexAtOffset(bufferTopPx));
		const endIdx = Math.min(rowCount - 1 - this.pinBottomRows, this.engine.geometry.getRowIndexAtOffset(bufferBottomPx));

		return { startIdx, endIdx };
	}

	public getVisibleColumnRange(colCount: number): ViewportRange {
		if (colCount === 0 || this.viewportWidth === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const lefts = this.engine.geometry.colLefts;
		if (lefts.length === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		// Calculate width occupied by pinned left and right lanes
		let pinnedLeftWidth = 0;
		for (let i = 0; i < this.pinLeftColumns && i < colCount; i++) {
			pinnedLeftWidth += this.engine.geometry.getColWidth(i, 100);
		}

		let pinnedRightWidth = 0;
		for (let i = 0; i < this.pinRightColumns && i < colCount; i++) {
			pinnedRightWidth += this.engine.geometry.getColWidth(colCount - 1 - i, 100);
		}

		const visibleLeft = this.scrollLeft + pinnedLeftWidth;
		const visibleRight = this.scrollLeft + this.viewportWidth - pinnedRightWidth;

		// Perform O(log C) binary searches on GeometryModel
		const activeStartIdx = this.engine.geometry.getColIndexAtOffset(visibleLeft);
		const activeEndIdx = this.engine.geometry.getColIndexAtOffset(visibleRight);

		// Predictive overscan
		const state = this.engine.stateManager.getState();
		const colBuffer = state.colBuffer ?? 1;
		let overscanLeft = colBuffer;
		let overscanRight = colBuffer;

		if (state.overscanAdaptive) {
			// Same quantize-and-hold as the row path: keep the column window stable across frames.
			const quantum = ViewportModel.ADAPTIVE_COL_QUANTUM;
			const wantRight = this.velocityX > 0.2 ? Math.ceil(Math.min(15, Math.floor(this.velocityX * 10)) / quantum) * quantum : 0;
			const wantLeft = this.velocityX < -0.2 ? Math.ceil(Math.min(15, Math.floor(-this.velocityX * 10)) / quantum) * quantum : 0;
			this.adaptiveRightCols = this.holdAdaptive(this.adaptiveRightCols, wantRight, this.calmRight);
			this.calmRight = this.heldCalm;
			overscanRight += this.adaptiveRightCols;
			this.adaptiveLeftCols = this.holdAdaptive(this.adaptiveLeftCols, wantLeft, this.calmLeft);
			this.calmLeft = this.heldCalm;
			overscanLeft += this.adaptiveLeftCols;
		}

		const startIdx = Math.max(this.pinLeftColumns, activeStartIdx - overscanLeft);
		const endIdx = Math.min(colCount - 1 - this.pinRightColumns, activeEndIdx + overscanRight);

		return { startIdx, endIdx };
	}
}

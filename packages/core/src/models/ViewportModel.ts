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

	// Centralized velocity threshold for high-performance optimizations (1.5 px/ms)
	private readonly FAST_SCROLL_THRESHOLD = 5;

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

	// Base overscan buffer counts
	private baseOverscanRows = 12;
	private baseOverscanCols = 8;

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

		// Calculate height occupied by pinned top and bottom lanes
		let pinnedTopHeight = 0;
		for (let i = 0; i < this.pinTopRows && i < rowCount; i++) {
			pinnedTopHeight += this.engine.geometry.getRowHeight(i, 40);
		}

		let pinnedBottomHeight = 0;
		for (let i = 0; i < this.pinBottomRows && i < rowCount; i++) {
			pinnedBottomHeight += this.engine.geometry.getRowHeight(rowCount - 1 - i, 40);
		}

		const visibleTop = this.scrollTop + pinnedTopHeight;
		const visibleBottom = this.scrollTop + this.viewportHeight - pinnedBottomHeight;

		// Perform O(log R) binary searches on GeometryModel
		const activeStartIdx = this.engine.geometry.getRowIndexAtOffset(visibleTop);
		const activeEndIdx = this.engine.geometry.getRowIndexAtOffset(visibleBottom);

		// Predictive overscan
		const state = this.engine.stateManager.getState();
		const rowBuffer = state.rowBuffer ?? 10;
		let overscanTop = rowBuffer;
		let overscanBottom = rowBuffer;

		if (state.overscan?.mode === 'adaptive') {
			if (this.velocityY > 0.2) {
				overscanBottom += Math.min(25, Math.floor(this.velocityY * 15));
			} else if (this.velocityY < -0.2) {
				overscanTop += Math.min(25, Math.floor(Math.abs(this.velocityY) * 15));
			}
		}

		const runtimeMaxRows = state.runtimeLimits?.suppressRenderedRangeLimit ? undefined : state.runtimeLimits?.maxRenderedRows;
		if (runtimeMaxRows && runtimeMaxRows > 0) {
			const pinnedRows = this.pinTopRows + this.pinBottomRows;
			const centerBudget = Math.max(1, runtimeMaxRows - pinnedRows);
			const visibleCount = Math.max(1, activeEndIdx - activeStartIdx + 1);
			const overscanBudget = Math.max(0, centerBudget - visibleCount);
			const preferTop = this.velocityY < -0.2;
			const preferredTop = preferTop ? Math.min(overscanTop, overscanBudget) : Math.min(overscanTop, Math.floor(overscanBudget / 2));
			const preferredBottom = Math.min(overscanBottom, overscanBudget - preferredTop);
			overscanTop = preferredTop;
			overscanBottom = preferredBottom;
		}

		const startIdx = Math.max(this.pinTopRows, activeStartIdx - overscanTop);
		const endIdx = Math.min(rowCount - 1 - this.pinBottomRows, activeEndIdx + overscanBottom);

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

		if (state.overscan?.mode === 'adaptive') {
			if (this.velocityX > 0.2) {
				overscanRight += Math.min(15, Math.floor(this.velocityX * 10));
			} else if (this.velocityX < -0.2) {
				overscanLeft += Math.min(15, Math.floor(Math.abs(this.velocityX) * 10));
			}
		}

		const startIdx = Math.max(this.pinLeftColumns, activeStartIdx - overscanLeft);
		const endIdx = Math.min(colCount - 1 - this.pinRightColumns, activeEndIdx + overscanRight);

		return { startIdx, endIdx };
	}
}

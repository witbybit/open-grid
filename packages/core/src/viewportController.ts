import { ColumnController } from './columnController.js';
import { RowController } from './rowController.js';

export interface ViewportRange {
	startIdx: number;
	endIdx: number;
}

export class ViewportController {
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
	private lastScrollTop = 0;
	private lastScrollLeft = 0;
	private lastTimestamp = 0;
	private velocityY = 0; // px/ms
	private velocityX = 0; // px/ms

	// Base overscan buffer counts (stable fallbacks)
	private baseOverscanRows = 12;
	private baseOverscanCols = 8;

	/**
	 * Update viewport dimensions.
	 * Returns true if the dimensions actually changed.
	 */
	public setViewportSize(width: number, height: number): boolean {
		if (this.viewportWidth === width && this.viewportHeight === height) {
			return false;
		}
		this.viewportWidth = width;
		this.viewportHeight = height;
		return true;
	}

	/**
	 * Update scroll positions and calculate velocity vector components.
	 * Returns true if the scroll positions actually changed.
	 */
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

		this.lastScrollTop = this.scrollTop;
		this.lastScrollLeft = this.scrollLeft;
		this.scrollTop = scrollTop;
		this.scrollLeft = scrollLeft;
		this.lastTimestamp = timestamp;

		return true;
	}

	/**
	 * Retrieve scroll velocity metrics.
	 */
	public getVelocity(): { vx: number; vy: number } {
		return { vx: this.velocityX, vy: this.velocityY };
	}

	/**
	 * Returns the range of active scrollable row indices within the viewport,
	 * incorporating top/bottom pinned offsets and predictive overscan.
	 */
	public getVisibleRowRange(rowController: RowController<any>): ViewportRange {
		const rowCount = rowController.getRowModel()?.getRowCount() ?? 0;
		if (rowCount === 0 || this.viewportHeight === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const tops = rowController.geometry.rowTops;
		if (tops.length === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		// Calculate height occupied by pinned top and bottom lanes
		let pinnedTopHeight = 0;
		for (let i = 0; i < this.pinTopRows && i < rowCount; i++) {
			pinnedTopHeight += rowController.getRowHeight(i);
		}

		let pinnedBottomHeight = 0;
		for (let i = 0; i < this.pinBottomRows && i < rowCount; i++) {
			pinnedBottomHeight += rowController.getRowHeight(rowCount - 1 - i);
		}

		// Adjust scroll boundary search space for scrollable viewport
		const visibleTop = this.scrollTop + pinnedTopHeight;
		const visibleBottom = this.scrollTop + this.viewportHeight - pinnedBottomHeight;

		// Perform O(log R) binary searches
		const activeStartIdx = rowController.geometry.getIndexAtOffset(visibleTop, tops);
		const activeEndIdx = rowController.geometry.getIndexAtOffset(visibleBottom, tops);

		// Calculate velocity-driven predictive overscan
		let overscanTop = this.baseOverscanRows;
		let overscanBottom = this.baseOverscanRows;

		if (this.velocityY > 0.2) {
			// Scrolling down: extend bottom buffer
			overscanBottom += Math.min(25, Math.floor(this.velocityY * 15));
		} else if (this.velocityY < -0.2) {
			// Scrolling up: extend top buffer
			overscanTop += Math.min(25, Math.floor(Math.abs(this.velocityY) * 15));
		}

		const startIdx = Math.max(this.pinTopRows, activeStartIdx - overscanTop);
		const endIdx = Math.min(rowCount - 1 - this.pinBottomRows, activeEndIdx + overscanBottom);

		return { startIdx, endIdx };
	}

	/**
	 * Returns the range of active scrollable column indices within the viewport,
	 * incorporating left/right pinned offsets and predictive overscan.
	 */
	public getVisibleColumnRange(colController: ColumnController<any>): ViewportRange {
		const colCount = colController.columns.length;
		if (colCount === 0 || this.viewportWidth === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const lefts = colController.geometry.colLefts;
		if (lefts.length === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		// Calculate width occupied by pinned left and right lanes
		let pinnedLeftWidth = 0;
		for (let i = 0; i < this.pinLeftColumns && i < colCount; i++) {
			pinnedLeftWidth += colController.getColWidth(i);
		}

		let pinnedRightWidth = 0;
		for (let i = 0; i < this.pinRightColumns && i < colCount; i++) {
			pinnedRightWidth += colController.getColWidth(colCount - 1 - i);
		}

		// Adjust scroll boundary search space for scrollable viewport
		const visibleLeft = this.scrollLeft + pinnedLeftWidth;
		const visibleRight = this.scrollLeft + this.viewportWidth - pinnedRightWidth;

		// Perform O(log C) binary searches
		const activeStartIdx = colController.geometry.getIndexAtOffset(visibleLeft, lefts);
		const activeEndIdx = colController.geometry.getIndexAtOffset(visibleRight, lefts);

		// Calculate velocity-driven predictive overscan
		let overscanLeft = this.baseOverscanCols;
		let overscanRight = this.baseOverscanCols;

		if (this.velocityX > 0.2) {
			// Scrolling right: extend right buffer
			overscanRight += Math.min(15, Math.floor(this.velocityX * 10));
		} else if (this.velocityX < -0.2) {
			// Scrolling left: extend left buffer
			overscanLeft += Math.min(15, Math.floor(Math.abs(this.velocityX) * 10));
		}

		const startIdx = Math.max(this.pinLeftColumns, activeStartIdx - overscanLeft);
		const endIdx = Math.min(colCount - 1 - this.pinRightColumns, activeEndIdx + overscanRight);

		return { startIdx, endIdx };
	}

	/**
	 * Recalculate visible ranges and update store state if they have changed.
	 * Returns true if the visible ranges actually changed.
	 */
	public updateVisibleRanges(store: any): boolean {
		const rowRange = this.getVisibleRowRange(store.rowController);
		const colRange = this.getVisibleColumnRange(store.columnController);

		const currState = store.getState();
		const rowChanged =
			!currState.visibleRowRange ||
			currState.visibleRowRange.startIdx !== rowRange.startIdx ||
			currState.visibleRowRange.endIdx !== rowRange.endIdx;
		const colChanged =
			!currState.visibleColRange ||
			currState.visibleColRange.startIdx !== colRange.startIdx ||
			currState.visibleColRange.endIdx !== colRange.endIdx;

		if (rowChanged || colChanged) {
			store.setState({
				visibleRowRange: rowRange,
				visibleColRange: colRange,
			});
			return true;
		}
		return false;
	}
}

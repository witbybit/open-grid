import type { GridEngine } from '../engine/GridEngine.js';
import type { ViewportRange } from '../viewportController.js';

export class ViewportModel {
	private engine!: GridEngine<any>;

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

	// Base overscan buffer counts
	private baseOverscanRows = 12;
	private baseOverscanCols = 8;

	public init(engine: GridEngine<any>): void {
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
		let overscanTop = this.baseOverscanRows;
		let overscanBottom = this.baseOverscanRows;

		if (this.velocityY > 0.2) {
			overscanBottom += Math.min(25, Math.floor(this.velocityY * 15));
		} else if (this.velocityY < -0.2) {
			overscanTop += Math.min(25, Math.floor(Math.abs(this.velocityY) * 15));
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
		let overscanLeft = this.baseOverscanCols;
		let overscanRight = this.baseOverscanCols;

		if (this.velocityX > 0.2) {
			overscanRight += Math.min(15, Math.floor(this.velocityX * 10));
		} else if (this.velocityX < -0.2) {
			overscanLeft += Math.min(15, Math.floor(Math.abs(this.velocityX) * 10));
		}

		const startIdx = Math.max(this.pinLeftColumns, activeStartIdx - overscanLeft);
		const endIdx = Math.min(colCount - 1 - this.pinRightColumns, activeEndIdx + overscanRight);

		return { startIdx, endIdx };
	}
}

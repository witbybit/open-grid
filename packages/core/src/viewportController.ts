import { ColumnController } from './columnController.js';
import { RowController } from './rowController.js';
import type { GridEngine } from './engine/GridEngine.js';

export interface ViewportRange {
	startIdx: number;
	endIdx: number;
}

export class ViewportController {
	private engine?: GridEngine<any>;
	
	private fallbackScrollTop = 0;
	private fallbackScrollLeft = 0;
	private fallbackViewportWidth = 0;
	private fallbackViewportHeight = 0;

	// Pinned configuration (Columns and Rows)
	private fallbackPinLeftColumns = 0;
	private fallbackPinRightColumns = 0;
	private fallbackPinTopRows = 0;
	private fallbackPinBottomRows = 0;

	// Scroll velocity tracking
	private lastScrollTop = 0;
	private lastScrollLeft = 0;
	private lastTimestamp = 0;
	private velocityY = 0; // px/ms
	private velocityX = 0; // px/ms

	// Base overscan buffer counts (stable fallbacks)
	private baseOverscanRows = 12;
	private baseOverscanCols = 8;

	constructor(engine?: GridEngine<any>) {
		this.engine = engine;
	}

	public get scrollTop(): number {
		return this.engine ? this.engine.viewport.scrollTop : this.fallbackScrollTop;
	}
	public set scrollTop(val: number) {
		if (this.engine) this.engine.viewport.scrollTop = val;
		else this.fallbackScrollTop = val;
	}

	public get scrollLeft(): number {
		return this.engine ? this.engine.viewport.scrollLeft : this.fallbackScrollLeft;
	}
	public set scrollLeft(val: number) {
		if (this.engine) this.engine.viewport.scrollLeft = val;
		else this.fallbackScrollLeft = val;
	}

	public get viewportWidth(): number {
		return this.engine ? this.engine.viewport.viewportWidth : this.fallbackViewportWidth;
	}
	public set viewportWidth(val: number) {
		if (this.engine) this.engine.viewport.viewportWidth = val;
		else this.fallbackViewportWidth = val;
	}

	public get viewportHeight(): number {
		return this.engine ? this.engine.viewport.viewportHeight : this.fallbackViewportHeight;
	}
	public set viewportHeight(val: number) {
		if (this.engine) this.engine.viewport.viewportHeight = val;
		else this.fallbackViewportHeight = val;
	}

	public get pinLeftColumns(): number {
		return this.engine ? this.engine.viewport.pinLeftColumns : this.fallbackPinLeftColumns;
	}
	public set pinLeftColumns(val: number) {
		if (this.engine) this.engine.viewport.pinLeftColumns = val;
		else this.fallbackPinLeftColumns = val;
	}

	public get pinRightColumns(): number {
		return this.engine ? this.engine.viewport.pinRightColumns : this.fallbackPinRightColumns;
	}
	public set pinRightColumns(val: number) {
		if (this.engine) this.engine.viewport.pinRightColumns = val;
		else this.fallbackPinRightColumns = val;
	}

	public get pinTopRows(): number {
		return this.engine ? this.engine.viewport.pinTopRows : this.fallbackPinTopRows;
	}
	public set pinTopRows(val: number) {
		if (this.engine) this.engine.viewport.pinTopRows = val;
		else this.fallbackPinTopRows = val;
	}

	public get pinBottomRows(): number {
		return this.engine ? this.engine.viewport.pinBottomRows : this.fallbackPinBottomRows;
	}
	public set pinBottomRows(val: number) {
		if (this.engine) this.engine.viewport.pinBottomRows = val;
		else this.fallbackPinBottomRows = val;
	}

	/**
	 * Update viewport dimensions.
	 * Returns true if the dimensions actually changed.
	 */
	public setViewportSize(width: number, height: number): boolean {
		if (this.engine) {
			return this.engine.viewport.setViewportSize(width, height);
		}
		if (this.fallbackViewportWidth === width && this.fallbackViewportHeight === height) {
			return false;
		}
		this.fallbackViewportWidth = width;
		this.fallbackViewportHeight = height;
		return true;
	}

	/**
	 * Update scroll positions and calculate velocity vector components.
	 * Returns true if the scroll positions actually changed.
	 */
	public setScrollPosition(scrollTop: number, scrollLeft: number, timestamp: number = performance.now()): boolean {
		if (this.engine) {
			return this.engine.viewport.setScrollPosition(scrollTop, scrollLeft, timestamp);
		}
		if (this.fallbackScrollTop === scrollTop && this.fallbackScrollLeft === scrollLeft) {
			return false;
		}

		const timeDelta = timestamp - this.lastTimestamp;
		if (timeDelta > 0 && this.lastTimestamp > 0) {
			this.velocityY = (scrollTop - this.fallbackScrollTop) / timeDelta;
			this.velocityX = (scrollLeft - this.fallbackScrollLeft) / timeDelta;
		} else {
			this.velocityY = 0;
			this.velocityX = 0;
		}

		this.lastScrollTop = this.fallbackScrollTop;
		this.lastScrollLeft = this.fallbackScrollLeft;
		this.fallbackScrollTop = scrollTop;
		this.fallbackScrollLeft = scrollLeft;
		this.lastTimestamp = timestamp;

		return true;
	}

	/**
	 * Retrieve scroll velocity metrics.
	 */
	public getVelocity(): { vx: number; vy: number } {
		if (this.engine) {
			return this.engine.viewport.getVelocity();
		}
		return { vx: this.velocityX, vy: this.velocityY };
	}

	/**
	 * Returns the range of active scrollable row indices within the viewport,
	 * incorporating top/bottom pinned offsets and predictive overscan.
	 */
	public getVisibleRowRange(rowController: RowController<any>): ViewportRange {
		if (this.engine) {
			return this.engine.viewport.getVisibleRowRange(this.engine.getRowModel()?.getRowCount() ?? 0);
		}
		const rowCount = rowController.getRowModel()?.getRowCount() ?? 0;
		if (rowCount === 0 || this.fallbackViewportHeight === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const tops = rowController.geometry.rowTops;
		if (tops.length === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		// Calculate height occupied by pinned top and bottom lanes
		let pinnedTopHeight = 0;
		for (let i = 0; i < this.fallbackPinTopRows && i < rowCount; i++) {
			pinnedTopHeight += rowController.getRowHeight(i);
		}

		let pinnedBottomHeight = 0;
		for (let i = 0; i < this.fallbackPinBottomRows && i < rowCount; i++) {
			pinnedBottomHeight += rowController.getRowHeight(rowCount - 1 - i);
		}

		// Adjust scroll boundary search space for scrollable viewport
		const visibleTop = this.fallbackScrollTop + pinnedTopHeight;
		const visibleBottom = this.fallbackScrollTop + this.fallbackViewportHeight - pinnedBottomHeight;

		// Perform O(log R) binary searches
		const activeStartIdx = rowController.geometry.getIndexAtOffset(visibleTop, tops);
		const activeEndIdx = rowController.geometry.getIndexAtOffset(visibleBottom, tops);

		// Calculate velocity-driven predictive overscan
		let overscanTop = this.baseOverscanRows;
		let overscanBottom = this.baseOverscanRows;

		if (this.velocityY > 0.2) {
			overscanBottom += Math.min(25, Math.floor(this.velocityY * 15));
		} else if (this.velocityY < -0.2) {
			overscanTop += Math.min(25, Math.floor(Math.abs(this.velocityY) * 15));
		}

		const startIdx = Math.max(this.fallbackPinTopRows, activeStartIdx - overscanTop);
		const endIdx = Math.min(rowCount - 1 - this.fallbackPinBottomRows, activeEndIdx + overscanBottom);

		return { startIdx, endIdx };
	}

	/**
	 * Returns the range of active scrollable column indices within the viewport,
	 * incorporating left/right pinned offsets and predictive overscan.
	 */
	public getVisibleColumnRange(colController: ColumnController<any>): ViewportRange {
		if (this.engine) {
			return this.engine.viewport.getVisibleColumnRange(this.engine.stateManager.getState().columns.length);
		}
		const colCount = colController.columns.length;
		if (colCount === 0 || this.fallbackViewportWidth === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const lefts = colController.geometry.colLefts;
		if (lefts.length === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		// Calculate width occupied by pinned left and right lanes
		let pinnedLeftWidth = 0;
		for (let i = 0; i < this.fallbackPinLeftColumns && i < colCount; i++) {
			pinnedLeftWidth += colController.getColWidth(i);
		}

		let pinnedRightWidth = 0;
		for (let i = 0; i < this.fallbackPinRightColumns && i < colCount; i++) {
			pinnedRightWidth += colController.getColWidth(colCount - 1 - i);
		}

		// Adjust scroll boundary search space for scrollable viewport
		const visibleLeft = this.fallbackScrollLeft + pinnedLeftWidth;
		const visibleRight = this.fallbackScrollLeft + this.fallbackViewportWidth - pinnedRightWidth;

		// Perform O(log C) binary searches
		const activeStartIdx = colController.geometry.getIndexAtOffset(visibleLeft, lefts);
		const activeEndIdx = colController.geometry.getIndexAtOffset(visibleRight, lefts);

		// Calculate velocity-driven predictive overscan
		let overscanLeft = this.baseOverscanCols;
		let overscanRight = this.baseOverscanCols;

		if (this.velocityX > 0.2) {
			overscanRight += Math.min(15, Math.floor(this.velocityX * 10));
		} else if (this.velocityX < -0.2) {
			overscanLeft += Math.min(15, Math.floor(Math.abs(this.velocityX) * 10));
		}

		const startIdx = Math.max(this.fallbackPinLeftColumns, activeStartIdx - overscanLeft);
		const endIdx = Math.min(colCount - 1 - this.fallbackPinRightColumns, activeEndIdx + overscanRight);

		return { startIdx, endIdx };
	}

	/**
	 * Recalculate visible ranges and update store state if they have changed.
	 * Returns true if the visible ranges actually changed.
	 */
	public updateVisibleRanges(store: any): boolean {
		if (this.engine) {
			const rowRange = this.engine.viewport.getVisibleRowRange(this.engine.getRowModel()?.getRowCount() ?? 0);
			const colRange = this.engine.viewport.getVisibleColumnRange(this.engine.stateManager.getState().columns.length);

			const currState = this.engine.stateManager.getState();
			const rowChanged =
				!currState.visibleRowRange ||
				currState.visibleRowRange.startIdx !== rowRange.startIdx ||
				currState.visibleRowRange.endIdx !== rowRange.endIdx;
			const colChanged =
				!currState.visibleColRange ||
				currState.visibleColRange.startIdx !== colRange.startIdx ||
				currState.visibleColRange.endIdx !== colRange.endIdx;

			if (rowChanged || colChanged) {
				this.engine.stateManager.setState({
					visibleRowRange: rowRange,
					visibleColRange: colRange,
				});
				return true;
			}
			return false;
		}
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

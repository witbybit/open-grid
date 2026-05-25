import type { GridEngine } from './engine/GridEngine.js';

export interface ViewportRange {
	startIdx: number;
	endIdx: number;
}

export class ViewportController {
	constructor(private readonly engine: GridEngine<any>) {}

	public get scrollTop(): number {
		return this.engine.viewport.scrollTop;
	}
	public set scrollTop(val: number) {
		this.engine.viewport.scrollTop = val;
	}

	public get scrollLeft(): number {
		return this.engine.viewport.scrollLeft;
	}
	public set scrollLeft(val: number) {
		this.engine.viewport.scrollLeft = val;
	}

	public get viewportWidth(): number {
		return this.engine.viewport.viewportWidth;
	}
	public set viewportWidth(val: number) {
		this.engine.viewport.viewportWidth = val;
	}

	public get viewportHeight(): number {
		return this.engine.viewport.viewportHeight;
	}
	public set viewportHeight(val: number) {
		this.engine.viewport.viewportHeight = val;
	}

	public get pinLeftColumns(): number {
		return this.engine.viewport.pinLeftColumns;
	}
	public set pinLeftColumns(val: number) {
		this.engine.viewport.pinLeftColumns = val;
	}

	public get pinRightColumns(): number {
		return this.engine.viewport.pinRightColumns;
	}
	public set pinRightColumns(val: number) {
		this.engine.viewport.pinRightColumns = val;
	}

	public get pinTopRows(): number {
		return this.engine.viewport.pinTopRows;
	}
	public set pinTopRows(val: number) {
		this.engine.viewport.pinTopRows = val;
	}

	public get pinBottomRows(): number {
		return this.engine.viewport.pinBottomRows;
	}
	public set pinBottomRows(val: number) {
		this.engine.viewport.pinBottomRows = val;
	}

	/**
	 * Update viewport dimensions.
	 * Returns true if the dimensions actually changed.
	 */
	public setViewportSize(width: number, height: number): boolean {
		return this.engine.viewport.setViewportSize(width, height);
	}

	/**
	 * Update scroll positions and calculate velocity vector components.
	 * Returns true if the scroll positions actually changed.
	 */
	public setScrollPosition(scrollTop: number, scrollLeft: number, timestamp: number = performance.now()): boolean {
		return this.engine.viewport.setScrollPosition(scrollTop, scrollLeft, timestamp);
	}

	/**
	 * Retrieve scroll velocity metrics.
	 */
	public getVelocity(): { vx: number; vy: number } {
		return this.engine.viewport.getVelocity();
	}

	/**
	 * Returns the range of active scrollable row indices within the viewport,
	 * incorporating top/bottom pinned offsets and predictive overscan.
	 */
	public getVisibleRowRange(): ViewportRange {
		return this.engine.viewport.getVisibleRowRange(this.engine.getRowModel()?.getRowCount() ?? 0);
	}

	/**
	 * Returns the range of active scrollable column indices within the viewport,
	 * incorporating left/right pinned offsets and predictive overscan.
	 */
	public getVisibleColumnRange(): ViewportRange {
		return this.engine.viewport.getVisibleColumnRange(this.engine.stateManager.getState().columns.length);
	}

	/**
	 * Recalculate visible ranges and update store state if they have changed.
	 * Returns true if the visible ranges actually changed.
	 */
	public updateVisibleRanges(): boolean {
		const rowRange = this.getVisibleRowRange();
		const colRange = this.getVisibleColumnRange();
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
}

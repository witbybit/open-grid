import { describe, it, expect } from 'vitest';
import { computeScrollTarget, type ScrollIntoViewParams } from './scrollIntoView.js';
import { GROUP_PANEL_HEIGHT, LEAF_HEADER_HEIGHT } from './layoutPlan.js';

function makeParams(overrides: Partial<ScrollIntoViewParams> = {}): ScrollIntoViewParams {
	// 10 rows × 5 cols, each row 30px, each col 100px, viewport 300×400
	const rowCount = 10;
	const colCount = 5;
	const rowHeight = 30;
	const colWidth = 100;
	return {
		rowIndex: 5,
		colIndex: 2,
		rowCount,
		colCount,
		pinLeftColumns: 0,
		pinRightColumns: 0,
		pinTopRows: 0,
		pinBottomRows: 0,
		scrollTop: 0,
		scrollLeft: 0,
		viewportHeight: 300,
		viewportWidth: 400,
		topChromeHeight: LEAF_HEADER_HEIGHT,
		rowTops: Array.from({ length: rowCount }, (_, i) => i * rowHeight),
		rowHeights: Array.from({ length: rowCount }, () => rowHeight),
		colLefts: Array.from({ length: colCount }, (_, i) => i * colWidth),
		colWidths: Array.from({ length: colCount }, () => colWidth),
		scrollViewportScrollHeight: 0,
		scrollViewportScrollWidth: 0,
		scrollViewportClientHeight: 0,
		scrollViewportClientWidth: 0,
		...overrides,
	};
}

describe('computeScrollTarget', () => {
	it('returns null when the cell is already fully visible', () => {
		// rowIndex=2 → rowTop=60, rowHeight=30; visible when scrollTop=0 and viewportHeight=300
		// colIndex=1 → colLeft=100, colWidth=100; visible when scrollLeft=0 and viewportWidth=400
		const result = computeScrollTarget(makeParams({ rowIndex: 2, colIndex: 1 }));
		expect(result).toBeNull();
	});

	it('scrolls down when the target row is below the visible area', () => {
		// viewportHeight=300, so effective bottom = 300-header=260px visible from scrollTop=0
		// rowIndex=9 → rowTop=270, rowHeight=30; bottom=300 > 260 → need to scroll
		const result = computeScrollTarget(makeParams({ rowIndex: 9 }));
		expect(result).not.toBeNull();
		expect(result!.top).toBeGreaterThan(0);
	});

	it('uses top chrome height when scrolling a row into view', () => {
		const result = computeScrollTarget(makeParams({ rowIndex: 8, topChromeHeight: LEAF_HEADER_HEIGHT + GROUP_PANEL_HEIGHT }));

		expect(result).toEqual({ top: 52, left: 0 });
	});

	it('scrolls up when the target row is above the visible area', () => {
		// Scroll down to 120, then target rowIndex=2 (rowTop=60) which is above scrollTop=120
		const result = computeScrollTarget(makeParams({ rowIndex: 2, scrollTop: 120 }));
		expect(result).not.toBeNull();
		expect(result!.top).toBeLessThan(120);
	});

	it('scrolls right when the target column is beyond the visible area', () => {
		// viewportWidth=400, colIndex=4 → colLeft=400, colWidth=100; right edge=500 > 400 → scroll
		const result = computeScrollTarget(makeParams({ colIndex: 4 }));
		expect(result).not.toBeNull();
		expect(result!.left).toBeGreaterThan(0);
	});

	it('scrolls left when the target column is before the visible area', () => {
		// scrollLeft=300, colIndex=1 → colLeft=100 < 300 → scroll left
		const result = computeScrollTarget(makeParams({ colIndex: 1, scrollLeft: 300 }));
		expect(result).not.toBeNull();
		expect(result!.left).toBeLessThan(300);
	});

	it('does not scroll a pinned-top row into view', () => {
		// rowIndex=0 is pinned, so vertical scroll is skipped; col already visible
		const result = computeScrollTarget(makeParams({ rowIndex: 0, pinTopRows: 2, scrollTop: 60 }));
		// Only the pinned check applies — rowIndex 0 < pinTopRows=2, so no vertical scroll
		// colIndex=2 is visible, so no horizontal scroll either
		expect(result).toBeNull();
	});

	it('does not scroll a pinned-left column into view', () => {
		// colIndex=0 is pinned, so horizontal scroll is skipped; row already visible
		const result = computeScrollTarget(makeParams({ colIndex: 0, pinLeftColumns: 2, scrollLeft: 200 }));
		expect(result).toBeNull();
	});

	it('accounts for pinned-left width when checking visibility', () => {
		// 1 pinned-left col of 100px; scrollLeft=0; colIndex=1 → colLeft=100
		// visibleLeftLimit = 0 + 100 = 100; colLeft=100 is exactly at the limit → not scrolled
		const result = computeScrollTarget(makeParams({ colIndex: 1, pinLeftColumns: 1 }));
		expect(result).toBeNull();
	});

	it('clamps to max scroll when scrollViewport dimensions are set', () => {
		// Would scroll to rowTop=270 area but maxScrollTop = 300 - 300 = 0 → clamped to 0
		const result = computeScrollTarget(
			makeParams({
				rowIndex: 9,
				scrollViewportScrollHeight: 300,
				scrollViewportClientHeight: 300,
			})
		);
		// Scroll is needed but clamped — if both targets equal current (0), returns null
		// scrollTop=0 and clamped target is max(0, min(0, computed)) = 0 → no movement
		expect(result).toBeNull();
	});

	it('returns correct top and left when both axes need scrolling', () => {
		// scrollTop=0, scrollLeft=0, rowIndex=9, colIndex=4 — both out of view
		const result = computeScrollTarget(makeParams({ rowIndex: 9, colIndex: 4 }));
		expect(result).not.toBeNull();
		expect(result!.top).toBeGreaterThan(0);
		expect(result!.left).toBeGreaterThan(0);
	});

	it('returns null when target matches current scroll after clamping', () => {
		// Already scrolled to bottom-right as far as possible; target is already clamped to same
		const result = computeScrollTarget(
			makeParams({
				rowIndex: 9,
				colIndex: 4,
				scrollTop: 200,
				scrollLeft: 100,
				scrollViewportScrollHeight: 500,
				scrollViewportClientHeight: 300,
				scrollViewportScrollWidth: 500,
				scrollViewportClientWidth: 400,
			})
		);
		// Computed targets may equal current scroll — if so, null is returned
		if (result) {
			expect(result.top !== 200 || result.left !== 100).toBe(true);
		}
	});
});

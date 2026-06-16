// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { RenderViewportCoordinator } from './renderViewportCoordinator.js';

describe('RenderViewportCoordinator', () => {
	it('schedules a scroll frame for exact programmatic jumps without pre-writing the viewport model', () => {
		const requestScrollFrame = vi.fn();
		const scrollTo = vi.fn();
		const scrollViewport = document.createElement('div');
		Object.defineProperty(scrollViewport, 'scrollHeight', { value: 4000, configurable: true });
		Object.defineProperty(scrollViewport, 'scrollWidth', { value: 2000, configurable: true });
		Object.defineProperty(scrollViewport, 'clientHeight', { value: 300, configurable: true });
		Object.defineProperty(scrollViewport, 'clientWidth', { value: 500, configurable: true });

		const viewport = {
			scrollTop: 2000,
			scrollLeft: 0,
			viewportHeight: 300,
			viewportWidth: 500,
			scrollViewportClientWidth: 500,
			pinLeftColumns: 0,
			pinRightColumns: 0,
			pinTopRows: 0,
			pinBottomRows: 0,
			setScrollPosition: vi.fn(),
		};
		const coordinator = new RenderViewportCoordinator({
			engine: {
				viewport,
				getRowModel: () => ({
					getVisualIndexByRowId: () => 0,
					getVisualRowCount: () => 100,
				}),
				columns: {
					getColumnIndex: () => 0,
					getDisplayedColumnCount: () => 1,
				},
				geometry: {
					rowTops: Array.from({ length: 100 }, (_, i) => i * 40),
					rowHeights: Array.from({ length: 100 }, () => 40),
					colLefts: [0],
					colWidths: [100],
				},
			} as any,
			viewportRenderer: {
				scrollViewport,
				getLayoutPlan: () => ({
					chrome: { topChromeHeight: 40 },
				}),
				syncLayoutPlan: vi.fn(),
			} as any,
			rowRenderer: { programmaticScrollCell: null, recycleViewport: vi.fn() } as any,
			scrollEngine: { scrollTo } as any,
			renderStats: { viewportRecycles: 0 } as any,
			requestScrollFrame,
		});

		coordinator.scrollCellIntoView('row-0', 'a');

		expect(scrollTo).toHaveBeenCalledWith(0, 0);
		expect(viewport.setScrollPosition).not.toHaveBeenCalled();
		expect(requestScrollFrame).toHaveBeenCalledTimes(1);
	});
});

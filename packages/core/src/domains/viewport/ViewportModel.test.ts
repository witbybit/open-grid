import { describe, expect, it } from 'vitest';
import { RowHeightModel } from '../layout/RowHeightModel.js';
import { computeVisibleWindow } from './VisibleWindow.js';
import { ViewportModel } from './ViewportModel.js';

describe('computeVisibleWindow (ARCHITECTURE.md §3 R12)', () => {
	it('returns the rows overlapping the viewport', () => {
		const rows = new RowHeightModel(100, 40); // total 4000
		const win = computeVisibleWindow(rows, 400, 200, 0); // y in [400,600)
		expect(win.firstIndex).toBe(10); // 400/40
		expect(win.lastIndex).toBe(15); // 600/40 -> row at 600 is index 15
	});

	it('extends the window by overscan on both sides', () => {
		const rows = new RowHeightModel(100, 40);
		const win = computeVisibleWindow(rows, 400, 200, 80); // y in [320,680)
		expect(win.firstIndex).toBe(8); // 320/40
		expect(win.lastIndex).toBe(17); // 680/40
	});

	it('is empty when there are no rows', () => {
		expect(computeVisibleWindow(new RowHeightModel(0), 0, 200).lastIndex).toBe(-1);
	});
});

describe('ViewportModel — runtime scroll/size (R11)', () => {
	it('reports change only when scroll/size actually change', () => {
		const vp = new ViewportModel();
		expect(vp.setScroll(100, 0)).toBe(true);
		expect(vp.setScroll(100, 0)).toBe(false);
		expect(vp.setSize(800, 600)).toBe(true);
		expect(vp.setSize(800, 600)).toBe(false);
		expect(vp.getSnapshot()).toEqual({ scrollTop: 100, scrollLeft: 0, width: 800, height: 600 });
	});

	it('derives the visible window from its own scroll/size + overscan', () => {
		const vp = new ViewportModel(40);
		vp.setSize(800, 200);
		vp.setScroll(400, 0);
		const win = vp.getVisibleWindow(new RowHeightModel(100, 40));
		expect(win.firstIndex).toBe(9); // (400-40)/40
		expect(win.lastIndex).toBe(16); // (400+200+40)/40
	});
});

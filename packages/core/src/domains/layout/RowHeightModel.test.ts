import { describe, expect, it } from 'vitest';
import { RowHeightModel } from './RowHeightModel.js';

describe('RowHeightModel — geometry (ARCHITECTURE.md §3 R12)', () => {
	it('computes cumulative tops and total height with a uniform default', () => {
		const m = new RowHeightModel(5, 40);
		expect(m.getRowTop(0)).toBe(0);
		expect(m.getRowTop(3)).toBe(120);
		expect(m.getTotalHeight()).toBe(200);
	});

	it('honours per-row overrides in offsets', () => {
		const m = new RowHeightModel(4, 40);
		m.setRowHeight(1, 100);
		expect(m.getRowHeight(1)).toBe(100);
		expect(m.getRowTop(2)).toBe(140); // 40 + 100
		expect(m.getTotalHeight()).toBe(220); // 40 + 100 + 40 + 40
	});

	it('rowIndexAtY binary-searches the correct row across mixed heights', () => {
		const m = new RowHeightModel(4, 40);
		m.setRowHeight(1, 100); // rows: [0,40) [40,140) [140,180) [180,220)
		expect(m.rowIndexAtY(0)).toBe(0);
		expect(m.rowIndexAtY(39)).toBe(0);
		expect(m.rowIndexAtY(40)).toBe(1);
		expect(m.rowIndexAtY(139)).toBe(1);
		expect(m.rowIndexAtY(140)).toBe(2);
		expect(m.rowIndexAtY(1000)).toBe(3); // clamps to last
	});

	it('returns -1 for rowIndexAtY when empty', () => {
		expect(new RowHeightModel(0).rowIndexAtY(10)).toBe(-1);
	});
});

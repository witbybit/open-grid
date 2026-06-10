// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { RowSlot } from './rowSlot.js';
import { CellSlot } from './cellSlot.js';

describe('RowSlot & CellSlot Controllers', () => {
	it('should prevent redundant DOM writes on CellSlot if values match', () => {
		const div = document.createElement('div');
		const cell = new CellSlot(div);

		// First update should write to DOM (left=0, right=-1, width=100)
		const updated1 = cell.update(0, 'col1', 5, 'row-5', 0, -1, 100, 'og-cell my-class', 'text', 'hello', 'hello');
		expect(updated1).toBe(true);
		expect(div.style.left).toBe('0px');
		expect(div.style.width).toBe('100px');
		expect(div.className).toBe('og-cell my-class');
		expect(div.querySelector('.og-cell-content')?.textContent).toBe('hello');

		// Second update with identical values should NOT write to DOM
		const updated2 = cell.update(0, 'col1', 5, 'row-5', 0, -1, 100, 'og-cell my-class', 'text', 'hello', 'hello');
		expect(updated2).toBe(false);
	});

	it('should prevent redundant DOM writes on RowSlot if layout values match', () => {
		const div = document.createElement('div');
		const row = new RowSlot('row-1', div);

		const updated1 = row.update(2, 'row-2', 'data', 80, 40, 'og-row selected');
		expect(updated1).toBe(true);
		expect(div.style.transform).toBe('translateY(80px)');
		expect(div.style.height).toBe('40px');

		const updated2 = row.update(2, 'row-2', 'data', 80, 40, 'og-row selected');
		expect(updated2).toBe(false);
	});
});

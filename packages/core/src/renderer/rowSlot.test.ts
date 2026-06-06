// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { RowSlot } from './rowSlot.js';
import { CellSlot } from './cellSlot.js';

describe('RowSlot & CellSlot Controllers', () => {
	it('should prevent redundant DOM writes on CellSlot if values match', () => {
		const div = document.createElement('div');
		const cell = new CellSlot(div);

		// First update should write to DOM
		const updated1 = cell.update(0, 'col1', 5, 'row-5', 'translate3d(0px, 0, 0)', '100px', 'og-cell my-class', 'text', 'hello', 'hello');
		expect(updated1).toBe(true);
		expect(div.style.transform).toBe('translate3d(0px, 0, 0)');
		expect(div.style.width).toBe('100px');
		expect(div.className).toBe('og-cell my-class');
		expect(div.querySelector('.og-cell-content')?.textContent).toBe('hello');

		// Second update with identical values should NOT write to DOM
		const updated2 = cell.update(0, 'col1', 5, 'row-5', 'translate3d(0px, 0, 0)', '100px', 'og-cell my-class', 'text', 'hello', 'hello');
		expect(updated2).toBe(false);
	});

	it('should prevent redundant DOM writes on RowSlot if layout values match', () => {
		const center = document.createElement('div');
		const left = document.createElement('div');
		const right = document.createElement('div');
		const row = new RowSlot('row-1', center, left, right);

		const updated1 = row.update(2, 'row-2', 'data', 80, 40, 'og-row selected');
		expect(updated1).toBe(true);
		expect(center.style.transform).toBe('translate3d(0, 80px, 0)');
		expect(center.style.height).toBe('40px');
		expect(left.style.transform).toBe('translate3d(0, 80px, 0)');
		expect(left.style.height).toBe('40px');
		expect(right.style.transform).toBe('translate3d(0, 80px, 0)');
		expect(right.style.height).toBe('40px');

		const updated2 = row.update(2, 'row-2', 'data', 80, 40, 'og-row selected');
		expect(updated2).toBe(false);
	});
});

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

	it('setBinding() records all identity fields and unbindHot() clears them', () => {
		const div = document.createElement('div');
		const cell = new CellSlot(div);

		expect(cell.binding).toBeNull();

		cell.setBinding('slot-1', 'row-42', 42, 'price', 3, 'slot-1::price', 'portal');
		expect(cell.binding).toEqual({
			rowSlotId: 'slot-1',
			rowId: 'row-42',
			rowIndex: 42,
			colId: 'price',
			colIndex: 3,
			cellKey: 'slot-1::price',
			contentMode: 'portal',
		});

		cell.unbindHot();
		expect(cell.binding).toBeNull();
	});

	it('setBinding() can rebind the same slot to a different cell', () => {
		const div = document.createElement('div');
		const cell = new CellSlot(div);

		cell.setBinding('slot-1', 'row-1', 0, 'name', 0, 'slot-1::name', 'text');
		cell.setBinding('slot-1', 'row-2', 1, 'name', 0, 'slot-1::name', 'portal');

		expect(cell.binding?.rowId).toBe('row-2');
		expect(cell.binding?.contentMode).toBe('portal');
	});

	it('unbindCold() clears binding and resets cached DOM state', () => {
		const div = document.createElement('div');
		const cell = new CellSlot(div);
		cell.setBinding('slot-1', 'row-1', 0, 'name', 0, 'slot-1::name', 'text');
		cell.lastMountedDataVersion = 5;

		cell.unbindCold();

		expect(cell.binding).toBeNull();
		expect(cell.lastMountedDataVersion).toBe(-1);
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

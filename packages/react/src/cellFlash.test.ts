// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flashCopiedCells, buildCellSelector } from './cellFlash.js';

function makeCell(rowId: string, colField: string): HTMLDivElement {
	const el = document.createElement('div');
	el.className = 'og-cell';
	el.dataset.rowId = rowId;
	el.dataset.colField = colField;
	return el;
}

// ─── buildCellSelector ────────────────────────────────────────────────────────

describe('buildCellSelector', () => {
	it('builds the correct selector for plain values', () => {
		expect(buildCellSelector('row1', 'name')).toBe('.og-cell[data-row-id="row1"][data-col-field="name"]');
	});

	it('escapes backslashes so the selector stays valid', () => {
		expect(buildCellSelector('row\\1', 'name')).toBe('.og-cell[data-row-id="row\\\\1"][data-col-field="name"]');
	});

	it('escapes double-quotes in both rowId and colField', () => {
		expect(buildCellSelector('ro"w', 'fi"eld')).toBe('.og-cell[data-row-id="ro\\"w"][data-col-field="fi\\"eld"]');
	});

	it('does not escape colons or dots (safe inside attribute string values)', () => {
		const sel = buildCellSelector('row:trade:123', 'price.usd');
		expect(sel).toBe('.og-cell[data-row-id="row:trade:123"][data-col-field="price.usd"]');
	});
});

// ─── flashCopiedCells ─────────────────────────────────────────────────────────

describe('flashCopiedCells', () => {
	afterEach(() => vi.useRealTimers());

	it('adds flash class to matching cells', () => {
		const container = document.createElement('div');
		const cell = makeCell('row1', 'name');
		container.appendChild(cell);

		flashCopiedCells(container, [{ rowId: 'row1', colField: 'name' }]);

		expect(cell.classList.contains('og-cell-flash')).toBe(true);
	});

	it('does not touch non-matching cells', () => {
		const container = document.createElement('div');
		const cell1 = makeCell('row1', 'name');
		const cell2 = makeCell('row2', 'price');
		container.appendChild(cell1);
		container.appendChild(cell2);

		flashCopiedCells(container, [{ rowId: 'row1', colField: 'name' }]);

		expect(cell1.classList.contains('og-cell-flash')).toBe(true);
		expect(cell2.classList.contains('og-cell-flash')).toBe(false);
	});

	it('flashes all cells in a multi-cell range', () => {
		const container = document.createElement('div');
		const cells = [makeCell('r1', 'c1'), makeCell('r1', 'c2'), makeCell('r2', 'c1')];
		cells.forEach((c) => container.appendChild(c));

		flashCopiedCells(container, [
			{ rowId: 'r1', colField: 'c1' },
			{ rowId: 'r1', colField: 'c2' },
			{ rowId: 'r2', colField: 'c1' },
		]);

		cells.forEach((c) => expect(c.classList.contains('og-cell-flash')).toBe(true));
	});

	it('removes flash class after durationMs', () => {
		vi.useFakeTimers();
		const container = document.createElement('div');
		const cell = makeCell('r1', 'c1');
		container.appendChild(cell);

		flashCopiedCells(container, [{ rowId: 'r1', colField: 'c1' }], 'og-cell-flash', 100);
		expect(cell.classList.contains('og-cell-flash')).toBe(true);

		vi.advanceTimersByTime(100);
		expect(cell.classList.contains('og-cell-flash')).toBe(false);
	});

	it('cleanup cancels the timer and immediately removes the class', () => {
		vi.useFakeTimers();
		const container = document.createElement('div');
		const cell = makeCell('r1', 'c1');
		container.appendChild(cell);

		const cancel = flashCopiedCells(container, [{ rowId: 'r1', colField: 'c1' }], 'og-cell-flash', 300);
		expect(cell.classList.contains('og-cell-flash')).toBe(true);

		cancel();
		expect(cell.classList.contains('og-cell-flash')).toBe(false);

		// Advancing past duration must be a no-op — timer was cleared
		vi.advanceTimersByTime(300);
		expect(cell.classList.contains('og-cell-flash')).toBe(false);
	});

	it('restarts animation when called twice rapidly (class still present after second call)', () => {
		const container = document.createElement('div');
		const cell = makeCell('r1', 'c1');
		container.appendChild(cell);

		flashCopiedCells(container, [{ rowId: 'r1', colField: 'c1' }]);
		flashCopiedCells(container, [{ rowId: 'r1', colField: 'c1' }]);

		expect(cell.classList.contains('og-cell-flash')).toBe(true);
	});

	it('handles rowId with special CSS characters without throwing', () => {
		const container = document.createElement('div');
		const cell = makeCell('row"special\\id', 'col"name');
		container.appendChild(cell);

		expect(() => flashCopiedCells(container, [{ rowId: 'row"special\\id', colField: 'col"name' }])).not.toThrow();
		expect(cell.classList.contains('og-cell-flash')).toBe(true);
	});

	it('returns a noop cleanup when no cells in container match', () => {
		const container = document.createElement('div');
		const cancel = flashCopiedCells(container, [{ rowId: 'missing', colField: 'x' }]);
		expect(() => cancel()).not.toThrow();
	});

	it('returns a noop cleanup for an empty cells array', () => {
		const container = document.createElement('div');
		const cancel = flashCopiedCells(container, []);
		expect(() => cancel()).not.toThrow();
	});
});

import { describe, expect, it } from 'vitest';
import { computeRowWindowRetention } from './rowWindowRetention.js';
import { createEmptyRenderWindow, type RenderWindow } from './renderWindow.js';

function makeWindow(overrides: Partial<RenderWindow> = {}): RenderWindow {
	return { ...createEmptyRenderWindow(), rowStart: 10, rowEnd: 19, rowCount: 100, pinTopRows: 0, pinBottomRows: 0, ...overrides };
}

describe('computeRowWindowRetention', () => {
	it('focused row inside the window — no retention needed', () => {
		const result = computeRowWindowRetention({ renderWindow: makeWindow(), focusedRowIndex: 15, editingRowIndex: undefined });
		expect(result.retainedRowIndices.size).toBe(0);
	});

	it('focused row outside the window — retained', () => {
		const result = computeRowWindowRetention({ renderWindow: makeWindow(), focusedRowIndex: 50, editingRowIndex: undefined });
		expect(result.retainedRowIndices.has(50)).toBe(true);
	});

	it('editing row outside the window — retained', () => {
		const result = computeRowWindowRetention({ renderWindow: makeWindow(), focusedRowIndex: undefined, editingRowIndex: 3 });
		expect(result.retainedRowIndices.has(3)).toBe(true);
	});

	it('both focused and editing rows outside the window (different rows) — both retained', () => {
		const result = computeRowWindowRetention({ renderWindow: makeWindow(), focusedRowIndex: 3, editingRowIndex: 90 });
		expect(result.retainedRowIndices.has(3)).toBe(true);
		expect(result.retainedRowIndices.has(90)).toBe(true);
		expect(result.retainedRowIndices.size).toBe(2);
	});

	it('pinned-top row — never retained, already always rendered', () => {
		const result = computeRowWindowRetention({
			renderWindow: makeWindow({ pinTopRows: 2 }),
			focusedRowIndex: 1,
			editingRowIndex: undefined,
		});
		expect(result.retainedRowIndices.size).toBe(0);
	});

	it('pinned-bottom row — never retained, already always rendered', () => {
		const result = computeRowWindowRetention({
			renderWindow: makeWindow({ pinBottomRows: 2 }), // rows 98,99 pinned given rowCount 100
			focusedRowIndex: 99,
			editingRowIndex: undefined,
		});
		expect(result.retainedRowIndices.size).toBe(0);
	});

	it('no focus/edit — nothing retained', () => {
		const result = computeRowWindowRetention({ renderWindow: makeWindow(), focusedRowIndex: undefined, editingRowIndex: undefined });
		expect(result.retainedRowIndices.size).toBe(0);
	});

	it('negative index (no row resolved) is ignored', () => {
		const result = computeRowWindowRetention({ renderWindow: makeWindow(), focusedRowIndex: -1, editingRowIndex: undefined });
		expect(result.retainedRowIndices.size).toBe(0);
	});
});

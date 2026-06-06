import { describe, it, expect } from 'vitest';
import { GridStore } from './store.js';
import { ClientRowModelController } from './rowModel.js';

function createStore(rowCount: number, colCount: number): GridStore<{ id: string }> {
	const store = new GridStore<{ id: string }>({
		columns: Array.from({ length: colCount }, (_, i) => ({ field: `C${i}`, header: `Col ${i}` })),
	});
	new ClientRowModelController<{ id: string }>(store, {
		rows: Array.from({ length: rowCount }, (_, i) => ({ id: `row-${i}` })),
		columns: store.getState().columns,
	});
	return store;
}

describe('ViewportController scrolling range computations', () => {
	it('calculates visible indices from the engine geometry at a static scroll position', () => {
		const store = createStore(10, 6);
		store.setViewportSize(300, 200);
		store.setScrollPosition(100, 150);

		const visibleRows = store.getVisibleRowRange();
		expect(visibleRows.startIdx).toBe(0);
		expect(visibleRows.endIdx).toBe(9);

		const visibleCols = store.getVisibleColumnRange();
		expect(visibleCols.startIdx).toBe(0);
		expect(visibleCols.endIdx).toBe(5);

		store.destroy();
	});

	it('calculates velocity and expands row boundaries predictively during high-speed scrolling', () => {
		const store = new GridStore<{ id: string }>({
			columns: Array.from({ length: 3 }, (_, i) => ({ field: `C${i}`, header: `Col ${i}` })),
			overscan: { mode: 'adaptive' },
			rowBuffer: 12,
		});
		new ClientRowModelController<{ id: string }>(store, {
			rows: Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}` })),
			columns: store.getState().columns,
		});
		store.setViewportSize(300, 200);

		store.setScrollPosition(100, 0, 1000);
		store.setScrollPosition(250, 0, 1100);

		expect(store.getScrollVelocity().vy).toBe(1.5);
		expect(store.getVisibleRowRange()).toEqual({ startIdx: 0, endIdx: 45 });

		store.destroy();
	});

	it('respects pinned columns when calculating scrollable visible space', () => {
		const store = new GridStore<{ id: string }>({
			columns: Array.from({ length: 10 }, (_, i) => ({ field: `C${i}`, header: `Col ${i}` })),
			colBuffer: 8,
		});
		new ClientRowModelController<{ id: string }>(store, {
			rows: Array.from({ length: 5 }, (_, i) => ({ id: `row-${i}` })),
			columns: store.getState().columns,
		});
		store.setViewportSize(400, 200);
		store.setViewportPins({ left: 2, right: 1 });
		store.setScrollPosition(0, 300);

		expect(store.getVisibleColumnRange()).toEqual({ startIdx: 2, endIdx: 8 });

		store.destroy();
	});
});

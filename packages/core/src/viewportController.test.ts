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
		const viewport = store.viewportController;
		viewport.setViewportSize(300, 200);
		viewport.setScrollPosition(100, 150);

		const visibleRows = viewport.getVisibleRowRange();
		expect(visibleRows.startIdx).toBe(0);
		expect(visibleRows.endIdx).toBe(9);

		const visibleCols = viewport.getVisibleColumnRange();
		expect(visibleCols.startIdx).toBe(0);
		expect(visibleCols.endIdx).toBe(5);

		store.destroy();
	});

	it('calculates velocity and expands row boundaries predictively during high-speed scrolling', () => {
		const store = createStore(100, 3);
		const viewport = store.viewportController;
		viewport.setViewportSize(300, 200);

		viewport.setScrollPosition(100, 0, 1000);
		viewport.setScrollPosition(250, 0, 1100);

		expect(viewport.getVelocity().vy).toBe(1.5);
		expect(viewport.getVisibleRowRange()).toEqual({ startIdx: 0, endIdx: 45 });

		store.destroy();
	});

	it('respects pinned columns when calculating scrollable visible space', () => {
		const store = createStore(5, 10);
		const viewport = store.viewportController;
		viewport.setViewportSize(400, 200);
		viewport.pinLeftColumns = 2;
		viewport.pinRightColumns = 1;
		viewport.setScrollPosition(0, 300);

		expect(viewport.getVisibleColumnRange()).toEqual({ startIdx: 2, endIdx: 8 });

		store.destroy();
	});
});

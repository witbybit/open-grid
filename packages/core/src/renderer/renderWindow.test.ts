// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	applyRenderWindowRuntimeLimits,
	getRowIndices,
	getColIndices,
	diffRenderWindow,
	computeRenderWindow,
	type RenderWindow,
} from './renderWindow.js';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

describe('RenderWindow & ViewportDelta calculations', () => {
	const baseWindow: RenderWindow = {
		rowStart: 2,
		rowEnd: 8,
		colStart: 1,
		colEnd: 4,
		pinLeftCols: 1,
		pinRightCols: 1,
		pinTopRows: 1,
		pinBottomRows: 1,
		rowCount: 20,
		colCount: 10,
		scrollTop: 100,
		scrollLeft: 50,
		viewportWidth: 500,
		viewportHeight: 400,
	};

	it('should return correct row indices representing pinned and scrollable rows', () => {
		const rows = getRowIndices(baseWindow);
		// pinTopRows = 1: index 0
		// rowStart=2 to rowEnd=8: indices 2,3,4,5,6,7,8 (excluding index 19 since pinBottomRows=1, rowCount=20 -> bottom row is 19)
		// pinBottomRows = 1: index 19 (since rowCount=20)
		expect(rows).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 19]);
	});

	it('should return correct col indices representing pinned and scrollable columns', () => {
		const cols = getColIndices(baseWindow);
		// pinLeftCols = 1: index 0
		// colStart=1 to colEnd=4: indices 1,2,3,4 (excluding 9 since pinRightCols=1, colCount=10 -> right col is 9)
		// pinRightCols = 1: index 9 (since colCount=10)
		expect(cols).toEqual([0, 1, 2, 3, 4, 9]);
	});

	it('should diff RenderWindows and return entered/exited/stayed rows and columns', () => {
		const nextWindow: RenderWindow = {
			...baseWindow,
			rowStart: 3,
			rowEnd: 9,
			colStart: 2,
			colEnd: 5,
		};

		const delta = diffRenderWindow(baseWindow, nextWindow);

		// baseWindow rows: [0, 2, 3, 4, 5, 6, 7, 8, 19]
		// nextWindow rows: [0, 3, 4, 5, 6, 7, 8, 9, 19] (since rowStart=3, rowEnd=9, pinTopRows=1, pinBottomRows=1, rowCount=20)
		// Entered: 9
		// Exited: 2
		// Stayed: 0, 3, 4, 5, 6, 7, 8, 19
		expect(delta.rowsEntered).toEqual([9]);
		expect(delta.rowsExited).toEqual([2]);
		expect(delta.rowsStayed).toEqual([0, 3, 4, 5, 6, 7, 8, 19]);

		// baseWindow cols: [0, 1, 2, 3, 4, 9]
		// nextWindow cols: [0, 2, 3, 4, 5, 9] (since colStart=2, colEnd=5, pinLeft=1, pinRight=1, colCount=10)
		// Entered: 5
		// Exited: 1
		// Stayed: 0, 2, 3, 4, 9
		expect(delta.colsEntered).toEqual([5]);
		expect(delta.colsExited).toEqual([1]);
		expect(delta.colsStayed).toEqual([0, 2, 3, 4, 9]);

		expect(delta.hasChanges).toBe(true);
	});

	it('should ignore data updates when the geometry render window is unchanged', () => {
		const delta = diffRenderWindow(baseWindow, { ...baseWindow });

		expect(delta.rowsEntered).toEqual([]);
		expect(delta.rowsExited).toEqual([]);
		expect(delta.colsEntered).toEqual([]);
		expect(delta.colsExited).toEqual([]);
		expect(delta.hasChanges).toBe(false);
	});

	it('treats pinned row scroll offset changes as geometry changes', () => {
		const delta = diffRenderWindow(baseWindow, { ...baseWindow, scrollTop: baseWindow.scrollTop + 20 });

		expect(delta.rowsEntered).toEqual([]);
		expect(delta.rowsExited).toEqual([]);
		expect(delta.hasChanges).toBe(true);
	});

	it('preserves pinned rows when max rendered rows clamps the center range', () => {
		const limited = applyRenderWindowRuntimeLimits(
			{
				...baseWindow,
				rowStart: 2,
				rowEnd: 12,
				pinTopRows: 2,
				pinBottomRows: 2,
			},
			{ maxRenderedRows: 6 }
		);

		expect(limited.rowStart).toBe(2);
		expect(limited.rowEnd).toBe(3);
		expect(getRowIndices(limited)).toEqual([0, 1, 2, 3, 18, 19]);
	});

	it('clamps max rendered cells by reducing center columns only', () => {
		const limited = applyRenderWindowRuntimeLimits(
			{
				...baseWindow,
				rowStart: 2,
				rowEnd: 3,
				colStart: 1,
				colEnd: 7,
				pinLeftCols: 1,
				pinRightCols: 1,
			},
			{ maxRenderedCells: 12 }
		);

		expect(limited.colStart).toBe(1);
		expect(limited.colEnd).toBe(1);
		expect(getColIndices(limited)).toEqual([0, 1, 9]);
	});

	it('keeps clamped ranges valid when limits are smaller than pinned rows and columns', () => {
		const limited = applyRenderWindowRuntimeLimits(
			{
				...baseWindow,
				rowStart: 2,
				rowEnd: 8,
				colStart: 2,
				colEnd: 8,
				pinTopRows: 3,
				pinBottomRows: 3,
				pinLeftCols: 2,
				pinRightCols: 2,
			},
			{ maxRenderedRows: 2, maxRenderedCells: 2 }
		);

		expect(limited.rowEnd).toBeGreaterThanOrEqual(limited.rowStart);
		expect(limited.colEnd).toBeGreaterThanOrEqual(limited.colStart);
		expect(getRowIndices(limited)).toEqual([0, 1, 2, 3, 17, 18, 19]);
		expect(getColIndices(limited)).toEqual([0, 1, 2, 8, 9]);
	});

	it('anchors sticky group rows below pinned top rows', () => {
		const store = new GridStore<{ id: string; category: string; product: string }>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'product', header: 'Product' },
			],
			defaultRowHeight: 40,
			groupRowHeight: 40,
			enableStickyGroupRows: true,
			rowModelConfig: {
				type: 'client',
				grouping: {
					model: [{ colId: 'category' }, { colId: 'product' }],
					defaultExpanded: true,
				},
			},
		});
		const controller = new ClientRowModelController(store, {
			rows: [
				{ id: '1', category: 'Hardware', product: 'Workstation' },
				{ id: '2', category: 'Hardware', product: 'Workstation' },
				{ id: '3', category: 'Hardware', product: 'Laptop' },
			],
			columns: store.getState().columns,
		});

		store.setViewportPins({ top: 1 });
		store.setViewportSize(500, 160);
		store.setScrollPosition(80, 0);

		const window = computeRenderWindow(store.engine);
		expect(window.stickyGroupIndices).toContain(1);
		const stickyPos = window.stickyGroupIndices?.indexOf(1) ?? -1;
		expect(window.stickyGroupTops?.[stickyPos]).toBe(120);

		controller.dispose();
		store.destroy();
	});
});

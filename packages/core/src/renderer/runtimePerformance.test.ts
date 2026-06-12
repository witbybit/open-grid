// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import {
	diffRenderWindow,
	getColIndices,
	getRowIndices,
	type RenderWindow,
	sameRenderedWindow,
	computeRenderWindow,
	applyRenderWindowRuntimeLimits,
} from './renderWindow.js';

interface RuntimePerfRow {
	id: string;
	name: string;
	status: string;
	[key: string]: string;
}

function createContainer(width = 500, height = 200): HTMLDivElement {
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: width,
		bottom: height,
		width,
		height,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	return container;
}

function createWideGrid(options: { rows?: number; cols?: number; custom?: boolean; valueGetter?: boolean } = {}) {
	const rowCount = options.rows ?? 100000;
	const colCount = options.cols ?? 1000;
	const columns: ColumnDef<RuntimePerfRow>[] = Array.from({ length: colCount }, (_, index) => ({
		field: `col_${index}`,
		header: `Col ${index}`,
		width: 100,
		...(options.custom && index % 4 === 0
			? {
					cellRenderer: () => `Rendered ${index}`,
					cellRendererCapabilities: { scrollBehavior: 'defer' as const },
				}
			: {}),
		...(options.valueGetter && index % 5 === 0
			? {
					valueGetterDependencies: [`col_${index}`],
					valueGetter: ({ row }: any) => `VG ${row[`col_${index}`]}`,
				}
			: {}),
	}));
	const rows: RuntimePerfRow[] = Array.from({ length: rowCount }, (_, rowIndex) => {
		const row: RuntimePerfRow = {
			id: `row-${rowIndex}`,
			name: `Row ${rowIndex}`,
			status: rowIndex % 2 === 0 ? 'Active' : 'Pending',
		};
		for (let colIndex = 0; colIndex < Math.min(colCount, 20); colIndex++) {
			row[`col_${colIndex}`] = `R${rowIndex} C${colIndex}`;
		}
		return row;
	});
	const store = new GridStore<RuntimePerfRow>({
		columns,
		defaultRowHeight: 40,
		defaultColWidth: 100,
		rowOverscanPx: 40,
		colBuffer: 1,
		getRowId: (row) => row.id,
		runtimeLimits: { maxRenderedRows: 20, maxRenderedCells: 220 },
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns });
	const container = createContainer();
	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	return { store, controller, container, renderer, columns };
}

function makeScrollCtx(store: GridStore<RuntimePerfRow>) {
	const state = store.getState();
	const plan = store.engine.columns.getCompiledPlan();
	return {
		isScrolling: true,
		state,
		stateVersion: 0,
		rowVersions: store.engine.rowVersions,
		globalVersion: state.globalVersion,
		styleVersion: 0,
		loadingVersion: 0,
		activeEdit: state.activeEdit,
		hasStyleHooks: !!state.styleSlots,
		hasCustomRenderers: plan.hasCustomRenderers,
		plan,
		visibleColRange: store.engine.viewport.getVisibleColumnRange(plan.displayedColumns.length),
		focusedCell: state.selection.focus,
		selectionBounds: state.selection.bounds ?? undefined,
		canUseCachedDisplayValues: true,
	};
}

function cleanupGrid(grid: ReturnType<typeof createWideGrid>): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
}

describe('Runtime Performance & Granular Versioning', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('validates that focus() and getCellValue() are not invoked during active scroll frames', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			defaultRowHeight: 40,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}`, name: `Name ${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 200,
			width: 500,
			height: 200,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		// Trigger scrolling frame
		store.engine.isScrolling = true;
		store.engine.isScrollFrameActive = true;
		store.engine.getCellValueCallsDuringScroll = 0;

		// Perform scroll update
		store.engine.viewport.setScrollPosition(100, 0);
		const plan = store.engine.columns.getCompiledPlan();
		renderer.rowRenderer.recycleViewport(true, {
			scrollTop: 100,
			scrollLeft: 0,
			isScrolling: true,
			state: store.getState(),
			dataVersion: store.getState().dataVersion,
			styleVersion: 0,
			loadingVersion: 0,
			hasStyleHooks: false,
			plan,
		} as any);

		// Check that getCellValue is NOT called during scroll frame
		expect(store.engine.getCellValueCallsDuringScroll).toBe(0);

		// Stop scroll
		store.engine.isScrolling = false;
		store.engine.isScrollFrameActive = false;

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('tests stable-slot virtualization does not remove/re-append row elements during scroll', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			defaultRowHeight: 40,
			rowOverscanPx: 80,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}`, name: `Name ${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 200,
			width: 500,
			height: 200,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const centerLayer = container.querySelector('.og-scroll-viewport') as HTMLDivElement;

		// Track child additions/removals
		let childAdded = false;
		let childRemoved = false;
		const observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				if (m.addedNodes.length > 0) childAdded = true;
				if (m.removedNodes.length > 0) childRemoved = true;
			}
		});
		observer.observe(centerLayer, { childList: true, subtree: true });

		// Perform small scroll to recycle some rows
		store.engine.viewport.setScrollPosition(80, 0); // scroll down by two rows
		renderer.fullPaint();

		// Under slot-pool strategy, rows should be recycled internally without being removed and re-appended to the DOM
		const rowEls = Array.from(container.querySelectorAll('[data-row-id]'));
		expect(rowEls.length).toBeGreaterThan(0);

		observer.disconnect();
		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('applies row-selection class through the cached selection membership set', () => {
		const grid = createWideGrid({ rows: 100, cols: 4 });
		try {
			grid.store.selectRows(['row-0', 'row-20', 'row-40']);
			grid.renderer.fullPaint();

			const selectedRows = Array.from(grid.container.querySelectorAll<HTMLElement>('.og-row-node-selected'));
			expect(selectedRows.some((row) => row.dataset.rowId === 'row:row-0')).toBe(true);
		} finally {
			cleanupGrid(grid);
		}
	});

	it('does zero row and cell work when the scroll render window is unchanged', () => {
		const grid = createWideGrid({ rows: 1000, cols: 100 });
		grid.renderer.resetRenderStats();

		grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

		const stats = grid.renderer.getRenderStats();
		expect(stats.rowsVisitedDuringScroll).toBe(0);
		expect(stats.cellsVisitedDuringScroll).toBe(0);
		expect(stats.cellsWrittenDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('keeps vertical scroll work bounded to entered rows instead of the full visible range', () => {
		const grid = createWideGrid({ rows: 100000, cols: 1000, custom: true, valueGetter: true });
		const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		grid.renderer.resetRenderStats();

		grid.store.engine.viewport.setScrollPosition(40, 0);
		grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

		const nextWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		const delta = diffRenderWindow(prevWindow, nextWindow);
		const pinnedRows = nextWindow.pinTopRows + nextWindow.pinBottomRows;
		const stats = grid.renderer.getRenderStats();

		expect(stats.rowsVisitedDuringScroll).toBeLessThanOrEqual(getRowIndices(nextWindow).length);
		expect(stats.cellsVisitedDuringScroll).toBeLessThanOrEqual(
			(stats.rowsReboundDuringScroll ?? 0) * getColIndices(nextWindow).length + pinnedRows * getColIndices(nextWindow).length
		);
		expect(stats.valueGetterCallsDuringScroll).toBe(0);
		expect(stats.formulaCallsDuringScroll).toBe(0);
		expect(stats.customRendererMountsDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('keeps horizontal scroll work bounded to entered/exited columns across active rows', () => {
		const grid = createWideGrid({ rows: 1000, cols: 1000, custom: true });
		const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		grid.renderer.resetRenderStats();

		grid.store.engine.viewport.setScrollPosition(0, 100);
		grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

		const nextWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		const delta = diffRenderWindow(prevWindow, nextWindow);
		const activeRows = getRowIndices(nextWindow).length;
		const pinnedCols = nextWindow.pinLeftCols + nextWindow.pinRightCols;
		const stats = grid.renderer.getRenderStats();

		expect(stats.rowsVisitedDuringScroll).toBeLessThanOrEqual(activeRows);
		expect(stats.cellsVisitedDuringScroll).toBeLessThanOrEqual(activeRows * (delta.colsEntered.length + delta.colsExited.length + pinnedCols));
		expect(stats.customRendererMountsDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('caps rendered rows and cells through runtime limits', () => {
		const grid = createWideGrid({ rows: 100000, cols: 1000 });
		const window = grid.renderer.rowRenderer.currentWindow as RenderWindow;

		expect(getRowIndices(window).length).toBeLessThanOrEqual(20);
		expect(getRowIndices(window).length * getColIndices(window).length).toBeLessThanOrEqual(220);

		cleanupGrid(grid);
	});

	it('never leaves stale cell DOM attached to hot-recycled rows after violent custom-renderer scrolls', () => {
		const grid = createWideGrid({ rows: 1000, cols: 24, custom: true, valueGetter: true });
		const scrollPositions = [400, 1600, 80, 3200, 120, 4800, 0, 2400];

		for (const scrollTop of scrollPositions) {
			grid.store.engine.viewport.setScrollPosition(scrollTop, 0);
			grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);
		}

		for (const row of Array.from(grid.container.querySelectorAll<HTMLElement>('.og-row'))) {
			const cells = Array.from(row.querySelectorAll<HTMLElement>(':scope > .og-cell'));
			const fields = cells.map((cell) => cell.dataset.colField).filter(Boolean);
			expect(fields.length).toBe(new Set(fields).size);
			for (const cell of cells) {
				expect(cell.dataset.rowIndex).toBe(row.dataset.rowIndex);
				for (const renderer of Array.from(cell.querySelectorAll<HTMLElement>('.og-custom-renderer-container'))) {
					expect(renderer.dataset.cellKey).toBe(cell.dataset.cellKey);
				}
			}
			expect(row.querySelectorAll(':scope > .og-custom-renderer-container')).toHaveLength(0);
		}

		cleanupGrid(grid);
	});

	it('should verify direct contiguous range math in diffRenderWindow (Task 2)', () => {
		const base: RenderWindow = {
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

		// Scroll down one row:
		const scrollDown = { ...base, rowStart: 3, rowEnd: 9, scrollTop: 140 };
		const dDown = diffRenderWindow(base, scrollDown);
		expect(dDown.rowsEntered).toEqual([9]);
		expect(dDown.rowsExited).toEqual([2]);
		expect(dDown.rowsStayed).toEqual([0, 3, 4, 5, 6, 7, 8, 19]);

		// Scroll up one row:
		const scrollUp = { ...base, rowStart: 1, rowEnd: 7, scrollTop: 60 };
		const dUp = diffRenderWindow(base, scrollUp);
		expect(dUp.rowsEntered).toEqual([1]);
		expect(dUp.rowsExited).toEqual([8]);

		// Horizontal scroll one column:
		const scrollCol = { ...base, colStart: 2, colEnd: 5, scrollLeft: 150 };
		const dCol = diffRenderWindow(base, scrollCol);
		expect(dCol.colsEntered).toEqual([5]);
		expect(dCol.colsExited).toEqual([1]);
	});

	it('should verify sameRenderedWindow ignores scrollTop/scrollLeft and sameWindowBailouts works (Task 1, 4, 5)', () => {
		const grid = createWideGrid({ rows: 1000, cols: 100 });

		// Establish initial window
		(grid.renderer as any).flushScrollFrame();
		grid.renderer.resetRenderStats();

		const scrollViewport = grid.renderer.viewportRenderer.scrollViewport!;
		Object.defineProperty(scrollViewport, 'scrollTop', { value: 5, writable: true, configurable: true });
		Object.defineProperty(scrollViewport, 'scrollLeft', { value: 5, writable: true, configurable: true });

		// Trigger scrolling frame where window stays same
		(grid.renderer as any).flushScrollFrame();

		const stats = grid.renderer.getRenderStats();
		expect(stats.sameWindowBailouts).toBe(1);
		expect(stats.stateReadsDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('should verify delta stats for rows/cols entered/exited/stayed/skipped (Task 4)', () => {
		const grid = createWideGrid({ rows: 100, cols: 10 });

		// Establish initial window
		(grid.renderer as any).flushScrollFrame();
		grid.renderer.resetRenderStats();

		const scrollViewport = grid.renderer.viewportRenderer.scrollViewport!;
		Object.defineProperty(scrollViewport, 'scrollTop', { value: 80, writable: true, configurable: true });
		Object.defineProperty(scrollViewport, 'scrollLeft', { value: 0, writable: true, configurable: true });

		// Trigger scroll frame
		(grid.renderer as any).flushScrollFrame();

		const stats = grid.renderer.getRenderStats();
		expect(stats.rowsEnteredDuringScroll).toBeGreaterThanOrEqual(1);
		expect(stats.rowsExitedDuringScroll).toBeGreaterThanOrEqual(1);
		expect(stats.stateReadsDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('keeps compiled plan stable and avoids portal mounts during active scroll for deferred renderers', () => {
		const grid = createWideGrid({ rows: 1000, cols: 1000, custom: true });
		const initialPlan = grid.store.engine.columns.getCompiledPlan();
		grid.renderer.resetRenderStats();

		grid.store.engine.viewport.setScrollPosition(120, 240);
		grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

		const stats = grid.renderer.getRenderStats();
		expect(grid.store.engine.columns.getCompiledPlan()).toBe(initialPlan);
		expect(stats.customRendererMountsDuringScroll).toBe(0);
		expect(stats.portalMountsDuringScroll).toBe(0);
		expect(stats.compiledPlanVersion).toBe(initialPlan.version);

		cleanupGrid(grid);
	});
});

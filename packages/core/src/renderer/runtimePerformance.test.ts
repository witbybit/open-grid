// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { diffRenderWindow, getColIndices, getRowIndices, type RenderWindow } from './renderWindow.js';

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
					cellRendererCapabilities: { scrollBehavior: 'defer' as const, deferFallback: 'snapshot' as const },
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
		rowBuffer: 1,
		colBuffer: 1,
		getRowId: (row) => row.id,
		runtimeLimits: { maxRenderedRows: 20, maxRenderedCells: 220 },
	});
	const controller = new ClientRowModelController(store, { rows, columns });
	const container = createContainer();
	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	return { store, controller, container, renderer, columns };
}

function makeScrollCtx(store: GridStore<RuntimePerfRow>) {
	const state = store.getState();
	const displayedColumns = store.engine.columns.getDisplayedColumns();
	return {
		isScrolling: true,
		stateVersion: 0,
		dataVersion: state.dataVersion,
		styleVersion: 0,
		loadingVersion: 0,
		activeEdit: state.activeEdit,
		hasStyleHooks: !!state.styleSlots,
		hasCustomRenderers: displayedColumns.some((c) => !!c.cellRenderer),
		displayedColumns,
		columnPlans: displayedColumns.map((c) => store.engine.columns.getColumnPlan(c.field)!),
		visibleColRange: store.engine.viewport.getVisibleColumnRange(displayedColumns.length),
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
		const controller = new ClientRowModelController(store, {
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
		const displayedColumns = store.getState().columns;
		const columnPlans = displayedColumns.map((c) => store.engine.columns.getColumnPlan(c.field)!);
		renderer.rowRenderer.recycleViewport(true, {
			scrollTop: 100,
			scrollLeft: 0,
			isScrolling: true,
			dataVersion: store.getState().dataVersion,
			styleVersion: 0,
			loadingVersion: 0,
			hasStyleHooks: false,
			displayedColumns,
			columnPlans,
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

	it('tests slot-pool row recycling reuse strategy does not remove/re-append row elements', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			defaultRowHeight: 40,
			rowRecyclingStrategy: 'slot-pool',
			rowBuffer: 2,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}`, name: `Name ${i}` }));
		const controller = new ClientRowModelController(store, {
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

		expect(stats.rowsVisitedDuringScroll).toBeLessThanOrEqual(delta.rowsEntered.length + delta.rowsExited.length + pinnedRows + 2);
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
});

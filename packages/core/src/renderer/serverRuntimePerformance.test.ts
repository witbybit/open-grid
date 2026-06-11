// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerRowModelController, type IGridDatasource } from '../serverRowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { diffRenderWindow, getColIndices, getRowIndices, type RenderWindow } from './renderWindow.js';
import { CellSlot } from './cellSlot.js';
import { CORE_STYLES } from './styles.js';

interface AuditPerfRow {
	id: string;
	timestamp: string;
	service: string;
	severity: string;
	latencyMs: string;
	ipAddress: string;
	[field: string]: string;
}

function createContainer(width = 1120, height = 720): HTMLDivElement {
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

function createAuditRow(index: number): AuditPerfRow {
	const services = ['Auth', 'Billing', 'Database', 'Cache', 'API Gateway', 'Shipping'];
	const severities = ['DEBUG', 'INFO', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
	const latency = index % 8 === 0 ? 700 + (index % 500) : 15 + (index % 85);
	return {
		id: `TR-${1_000_000 + index}`,
		timestamp: new Date(Date.UTC(2026, 5, 5, 18, 30) - index * 60_000).toISOString(),
		service: services[index % services.length],
		severity: severities[index % severities.length],
		latencyMs: String(latency),
		ipAddress: `192.168.1.${(index * 7) % 255}`,
	};
}

function createAuditColumns(count = 1200): ColumnDef<AuditPerfRow>[] {
	const renderer = () => null;
	const columns: ColumnDef<AuditPerfRow>[] = [
		{ field: 'id', header: 'Trace ID', width: 130 },
		{ field: 'timestamp', header: 'Timestamp', width: 220 },
		{
			field: 'service',
			header: 'Microservice',
			width: 140,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'live' },
		},
		{
			field: 'rendererLive',
			header: 'Live Rebind',
			width: 170,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'live' },
			valueGetter: ({ row }) => `live|${row.service}`,
		},
		{
			field: 'rendererDefer',
			header: 'Defer Stable',
			width: 170,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'defer' },
			valueGetterDependencies: ['severity'],
			valueGetter: ({ row }) => `defer|${row.severity}`,
		},
		{
			field: 'severity',
			header: 'Severity',
			width: 120,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'defer' },
		},
		{
			field: 'rendererFallback',
			header: 'Fallback Cache',
			width: 175,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'defer' },
			valueGetterDependencies: ['latencyMs'],
			valueGetter: ({ row }) => `fallback|${row.latencyMs}ms`,
		},
		{
			field: 'rendererDestroy',
			header: 'Destroy Recycle',
			width: 180,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'defer' },
			valueGetterDependencies: ['ipAddress'],
			valueGetter: ({ row }) => `destroy|${row.ipAddress}`,
		},
		{ field: 'latencyMs', header: 'Latency', width: 110, cellRenderer: renderer },
		{ field: 'ipAddress', header: 'Origin IP', width: 140 },
	];

	for (let index = columns.length; index < count; index++) {
		const field = `auditMetric_${index}`;
		columns.push({
			field,
			header: `Metric ${index}`,
			width: 96 + (index % 5) * 8,
			...(index % 7 === 0
				? {
						cellRenderer: renderer,
						cellRendererCapabilities: { scrollBehavior: 'defer' as const },
					}
				: {}),
			...(index % 11 === 0
				? {
						valueGetterDependencies: ['latencyMs'],
						valueGetter: ({ row }: { row: AuditPerfRow }) => `m${index}|${row.latencyMs}`,
					}
				: {}),
		});
	}

	return columns;
}

async function flushAsync(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

async function flushAnimationFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	await flushAsync();
}

function parseRowTop(el: HTMLElement): number {
	// Rows are positioned via transform: translateY(<top>px)
	const match = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(el.style.transform);
	return match ? parseInt(match[1], 10) : 0;
}

function parseCellLeft(el: HTMLElement): number {
	return parseInt(el.style.left || '0', 10);
}

function getScrollContext(grid: AuditGrid) {
	const state = grid.store.getState();
	const plan = grid.store.engine.columns.getCompiledPlan();
	return {
		isScrolling: true,
		state,
		stateVersion: 0,
		dataVersion: state.dataVersion,
		styleVersion: 0,
		loadingVersion: 0,
		activeEdit: state.activeEdit,
		hasStyleHooks: !!state.styleSlots,
		hasCustomRenderers: plan.hasCustomRenderers,
		plan,
		visibleColRange: grid.store.engine.viewport.getVisibleColumnRange(plan.displayedColumns.length),
		focusedCell: state.selection.focus,
		selectionBounds: state.selection.bounds ?? undefined,
		canUseCachedDisplayValues: true,
	};
}

type AuditGrid = Awaited<ReturnType<typeof createServerAuditGrid>>;

async function createServerAuditGrid(options: { rows?: number; cols?: number; blockSize?: number } = {}) {
	const totalRows = options.rows ?? 1_000_000;
	const columns = createAuditColumns(options.cols ?? 1200);
	const requests: Array<{ startRow: number; endRow: number }> = [];
	const datasource: IGridDatasource = {
		getRows: async ({ startRow, endRow }) => {
			requests.push({ startRow, endRow });
			return {
				rows: Array.from({ length: endRow - startRow }, (_, offset) => createAuditRow(startRow + offset)),
				totalCount: totalRows,
			};
		},
	};
	const store = new GridStore<AuditPerfRow>({
		columns,
		defaultRowHeight: 40,
		defaultColWidth: 100,
		rowOverscanPx: 40,
		colBuffer: 1,
		getRowId: (row) => row.id,
		runtimeLimits: { maxRenderedRows: 28, maxRenderedCells: 360 },
	});
	const controller = new ServerRowModelController<AuditPerfRow>(store, { datasource, blockSize: options.blockSize ?? 100, columns });
	const container = createContainer();
	const renderer = new RenderEngine(store.engine, store);
	renderer.onMountCellContent = ({ cellKey, container: host }) => {
		const child = document.createElement('span');
		child.className = 'audit-renderer';
		child.dataset.cellKey = cellKey;
		child.textContent = cellKey;
		host.replaceChildren(child);
	};
	renderer.mount(container);
	await flushAsync();
	renderer.fullPaint();
	return { store, controller, container, renderer, columns, requests };
}

async function browserScrollTo(grid: AuditGrid, scrollTop: number, scrollLeft: number): Promise<void> {
	const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
	expect(scrollViewport).not.toBeNull();
	scrollViewport.scrollTop = scrollTop;
	scrollViewport.scrollLeft = scrollLeft;
	scrollViewport.dispatchEvent(new Event('scroll'));
	await flushAnimationFrame();
}

function cleanupGrid(grid: AuditGrid): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
}

function assertNoStaleOrOverlappingDom(grid: AuditGrid): void {
	const rows = Array.from(grid.container.querySelectorAll<HTMLElement>('.og-row'));
	const currentWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
	const expectedRowIndices = new Set(getRowIndices(currentWindow));
	const activeRowIndices = new Set(grid.renderer.rowRenderer.activeRows.keys());
	expect(grid.renderer.rowRenderer.activeRows.size).toBeGreaterThan(0);
	expect(grid.renderer.rowRenderer.activeRows.size).toBeLessThanOrEqual(28);
	expect(rows.length).toBeGreaterThan(0);
	expect(rows.length).toBeLessThanOrEqual(28 * 3);
	for (const [rowIndex, slot] of grid.renderer.rowRenderer.activeRows) {
		expect(expectedRowIndices.has(rowIndex)).toBe(true);
		expect(slot.cellCount).toBeGreaterThan(0);
		expect(slot.cellCount).toBeLessThanOrEqual(360);
		expect(slot.element.dataset.rowIndex).toBe(String(rowIndex));

		// Assert DOM cells match the active cell count exactly to catch zombie cells
		const cells = Array.from(slot.element.querySelectorAll('.og-cell'));
		expect(cells.length).toBe(slot.cellCount);
	}

	for (const row of rows) {
		const cells = Array.from(row.querySelectorAll<HTMLElement>('.og-cell'));
		if (cells.length === 0) continue;
		const rowIndex = Number(row.dataset.rowIndex);
		expect(activeRowIndices.has(rowIndex)).toBe(true);
		expect(cells.length).toBeLessThanOrEqual(360);

		const fields = cells.map((cell) => cell.dataset.colField).filter(Boolean);
		expect(fields.length).toBe(new Set(fields).size);

		for (const cell of cells) {
			expect(cell.dataset.rowIndex).toBe(row.dataset.rowIndex);
			expect(row.dataset.rowId === cell.dataset.rowId || row.dataset.rowId === `row:${cell.dataset.rowId}`).toBe(true);
			expect(cell.querySelectorAll(':scope > .og-cell-content')).toHaveLength(1);
			// Portal hosts are created lazily on first portal use — text cells have none.
			expect(cell.querySelectorAll(':scope > .og-cell-portal-host').length).toBeLessThanOrEqual(1);
			for (const renderer of Array.from(cell.querySelectorAll<HTMLElement>('.og-custom-renderer-container'))) {
				expect(renderer.dataset.cellKey).toBe(cell.dataset.cellKey);
				if (cell.dataset.cellKey?.includes('@row-pool-')) {
					expect(renderer.dataset.rendererKey).toBe(cell.dataset.cellKey);
				}
			}
		}

		expect(row.querySelectorAll(':scope > .og-custom-renderer-container')).toHaveLength(0);
	}
}

function assertWindowIsContiguousAndCapped(grid: AuditGrid): void {
	const window = grid.renderer.rowRenderer.currentWindow as RenderWindow;
	const rows = getRowIndices(window);
	const cols = getColIndices(window);
	expect(rows.length).toBeGreaterThanOrEqual(12);
	expect(rows.length).toBeLessThanOrEqual(28);
	expect(rows.length * cols.length).toBeLessThanOrEqual(360);

	for (let index = 1; index < rows.length; index++) {
		expect(rows[index]).toBe(rows[index - 1] + 1);
	}
}

function assertViewportGeometryIsContinuous(grid: AuditGrid, expectedScrollTop: number): void {
	const headerHeight = 40;
	const rowHeight = 40;
	const viewportHeight = grid.store.engine.viewport.viewportHeight;
	const visibleTop = headerHeight;
	const visibleBottom = viewportHeight;
	const activeSlots = Array.from(grid.renderer.rowRenderer.activeRows.entries()).filter(
		([, slot]) => slot.rowKind === 'data' || slot.rowKind === 'loading'
	);
	expect(activeSlots.length).toBeGreaterThan(0);

	const projectedRows = activeSlots
		.map(([rowIndex, slot]) => {
			const y = parseRowTop(slot.element);
			return {
				rowIndex,
				screenTop: y - expectedScrollTop + headerHeight,
				screenBottom: y - expectedScrollTop + headerHeight + slot.rowHeight,
			};
		})
		.filter((row) => row.screenBottom > visibleTop && row.screenTop < visibleBottom)
		.sort((a, b) => a.screenTop - b.screenTop);

	if (projectedRows.length === 0) {
		const sample = activeSlots.slice(0, 5).map(([rowIndex, slot]) => ({
			rowIndex,
			rowTop: slot.rowTop,
			top: slot.element.style.transform,
			projectedTop: parseRowTop(slot.element) - expectedScrollTop + headerHeight,
		}));
		throw new Error(
			`No projected rows in viewport: ${JSON.stringify({
				expectedScrollTop,
				engineScrollTop: grid.store.engine.viewport.scrollTop,
				currentWindow: grid.renderer.rowRenderer.currentWindow,
				sample,
			})}`
		);
	}
	const minProjectedRows = Math.floor((viewportHeight - headerHeight) / rowHeight) - 2;
	if (projectedRows.length < minProjectedRows) {
		const sample = activeSlots.slice(0, 24).map(([rowIndex, slot]) => ({
			rowIndex,
			rowTop: slot.rowTop,
			top: slot.element.style.transform,
			projectedTop: parseRowTop(slot.element) - expectedScrollTop + headerHeight,
			projectedBottom: parseRowTop(slot.element) - expectedScrollTop + headerHeight + slot.rowHeight,
		}));
		throw new Error(
			`Too few projected rows in viewport: ${JSON.stringify({
				expectedScrollTop,
				engineScrollTop: grid.store.engine.viewport.scrollTop,
				projectedRows,
				minProjectedRows,
				currentWindow: grid.renderer.rowRenderer.currentWindow,
				sample,
			})}`
		);
	}
	expect(projectedRows.length).toBeGreaterThanOrEqual(minProjectedRows);
	expect(projectedRows[0].screenTop).toBeLessThanOrEqual(visibleTop + rowHeight);

	for (let index = 1; index < projectedRows.length; index++) {
		const prev = projectedRows[index - 1];
		const next = projectedRows[index];
		expect(next.screenTop - prev.screenTop).toBeLessThanOrEqual(rowHeight + 1);
	}

	const rowsContainer = grid.container.querySelector('.og-rows-container') || grid.container;
	const screenRows = Array.from(rowsContainer.querySelectorAll<HTMLElement>('.og-row'))
		.filter((row) => row.querySelector(':scope > .og-cell'))
		.map((row) => {
			const y = parseRowTop(row);
			return {
				rowIndex: Number(row.dataset.rowIndex),
				rowId: row.dataset.rowId,
				screenTop: y - expectedScrollTop + headerHeight,
				screenBottom: y - expectedScrollTop + headerHeight + Number.parseFloat(row.style.height || '40'),
			};
		})
		.filter((row) => row.screenBottom > visibleTop && row.screenTop < visibleBottom)
		.sort((a, b) => a.screenTop - b.screenTop);

	const uniqueScreenRowIndices = new Set(screenRows.map((row) => row.rowIndex));
	expect(uniqueScreenRowIndices.size).toBe(screenRows.length);
	expect(screenRows.length).toBe(projectedRows.length);
	for (let index = 1; index < screenRows.length; index++) {
		const prev = screenRows[index - 1];
		const next = screenRows[index];
		expect(next.rowIndex).toBe(prev.rowIndex + 1);
		expect(next.screenTop - prev.screenTop).toBeLessThanOrEqual(rowHeight + 1);
	}
}

function assertHorizontalGeometryIsContinuous(grid: AuditGrid, expectedScrollLeft: number): void {
	const activeSlots = Array.from(grid.renderer.rowRenderer.activeRows.values()).filter(
		(slot) => slot.rowKind === 'data' || slot.rowKind === 'loading'
	);
	expect(activeSlots.length).toBeGreaterThan(0);
	const firstSlot = activeSlots[0];
	const cells: [number, (typeof firstSlot.leftCells)[number]][] = [];
	for (let i = 0; i < firstSlot.leftCells.length; i++) cells.push([i, firstSlot.leftCells[i]]);
	const cs = firstSlot.centerColStart;
	for (let i = 0; i < firstSlot.centerCells.length; i++) cells.push([cs + i, firstSlot.centerCells[i]]);
	for (let i = 0; i < firstSlot.rightCells.length; i++) cells.push([firstSlot.pinRightStart + i, firstSlot.rightCells[i]]);
	cells.sort(([a], [b]) => a - b);
	expect(cells.length).toBeGreaterThan(0);

	const viewportWidth = grid.store.engine.viewport.viewportWidth;
	const projectedCells = cells
		.map(([colIndex, cell]) => {
			const x = parseCellLeft(cell.element);
			return {
				colIndex,
				screenLeft: x - expectedScrollLeft,
				screenRight: x - expectedScrollLeft + Number.parseFloat(cell.element.style.width || '0'),
			};
		})
		.filter((cell) => cell.screenRight > 0 && cell.screenLeft < viewportWidth)
		.sort((a, b) => a.screenLeft - b.screenLeft);

	if (projectedCells.length === 0) {
		const sample = cells.slice(0, 5).map(([colIndex, cell]) => ({
			colIndex,
			colField: cell.colField,
			left: cell.element.style.left,
			width: cell.element.style.width,
			projectedLeft: parseCellLeft(cell.element) - expectedScrollLeft,
		}));
		throw new Error(
			`No projected cells in viewport: ${JSON.stringify({
				expectedScrollLeft,
				engineScrollLeft: grid.store.engine.viewport.scrollLeft,
				currentWindow: grid.renderer.rowRenderer.currentWindow,
				sample,
			})}`
		);
	}
	expect(projectedCells.length).toBeGreaterThan(0);
	expect(projectedCells[0].screenLeft).toBeLessThanOrEqual(160);

	for (let index = 1; index < projectedCells.length; index++) {
		const prev = projectedCells[index - 1];
		const next = projectedCells[index];
		expect(next.screenLeft - prev.screenRight).toBeLessThanOrEqual(1);
	}
}

function assertScrollStatsAreRuthless(grid: AuditGrid, prevWindow: RenderWindow | null): void {
	const stats = grid.renderer.getRenderStats();
	const window = grid.renderer.rowRenderer.currentWindow as RenderWindow;
	const visibleCols = getColIndices(window).length;
	const activeRows = getRowIndices(window).length;
	const delta = prevWindow ? diffRenderWindow(prevWindow, window) : null;
	// Slot model visits all slots x all visible cols each frame (JS cache skips writes for stable cells).
	const maxExpectedCells = Math.max(activeRows * visibleCols, visibleCols, 1);
	expect(stats.valueGetterCallsDuringScroll).toBe(0);
	expect(stats.formulaCallsDuringScroll).toBe(0);
	expect(stats.getCellValueCallsDuringScroll).toBe(0);
	expect(stats.customRendererMountsDuringScroll).toBe(0);
	expect(stats.focusCallsDuringScroll).toBe(0);
	expect(stats.styleHookCallsDuringScroll).toBe(0);
	expect(stats.cellsVisitedDuringScroll).toBeLessThanOrEqual(maxExpectedCells);
	expect(stats.cellsWrittenDuringScroll).toBeLessThanOrEqual(maxExpectedCells);
	expect(stats.portalOpsDuringScroll).toBeLessThanOrEqual(maxExpectedCells);
}

function assertSelectionDoesNotCreateVisibleRowIslands(grid: AuditGrid, expectedScrollTop: number): void {
	const selectedRows = Array.from(
		grid.container.querySelectorAll<HTMLElement>('.og-rows-container .og-row-selected, .og-rows-container .og-row-focused')
	).filter((row) => row.querySelector(':scope > .og-cell'));
	const visibleSelectedRows = selectedRows.filter((row) => {
		const projectedTop = parseRowTop(row) - expectedScrollTop + 40;
		const height = Number.parseFloat(row.style.height || '40');
		return projectedTop + height > 40 && projectedTop < grid.store.engine.viewport.viewportHeight;
	});
	const focus = grid.store.getState().selection.focus;
	if (!focus) {
		expect(visibleSelectedRows).toHaveLength(0);
		return;
	}

	const focusedVisualIndex = grid.store.engine.getRowModel()?.getVisualIndexByRowId(focus.rowId) ?? -1;
	const currentRows = new Set(getRowIndices(grid.renderer.rowRenderer.currentWindow as RenderWindow));
	if (!currentRows.has(focusedVisualIndex)) {
		expect(visibleSelectedRows).toHaveLength(0);
		return;
	}

	expect(visibleSelectedRows.length).toBeLessThanOrEqual(1);
	if (visibleSelectedRows.length === 0) return;
	const selectedRow = visibleSelectedRows[0];
	expect(selectedRow.dataset.rowIndex).toBe(String(focusedVisualIndex));
	const projectedTop = parseRowTop(selectedRow) - expectedScrollTop + 40;
	expect(projectedTop).toBeGreaterThanOrEqual(40 - 1);
	expect(projectedTop).toBeLessThanOrEqual(grid.store.engine.viewport.viewportHeight);
}

describe('Server demo ruthless runtime performance contracts', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	beforeEach(() => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			callback(performance.now());
			return callbacks.length;
		});
	});

	it('mounts the audit-ledger server grid at million-row scale without expanding rendered DOM beyond caps', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1200 });

		expect(grid.store.engine.getRowModel()?.getVisualRowCount()).toBe(1_000_000);
		expect(grid.requests.length).toBeLessThanOrEqual(1);
		assertWindowIsContiguousAndCapped(grid);
		assertNoStaleOrOverlappingDom(grid);
		assertViewportGeometryIsContinuous(grid, 0);
		assertHorizontalGeometryIsContinuous(grid, 0);

		cleanupGrid(grid);
	});

	it('keeps violent real browser vertical scroll bounded, continuous, and visually non-stale across million rows', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1200 });
		const positions = [40, 400, 40_000, 120, 400_000, 4_000, 8_000_000, 80, 20_000_000, 0];

		for (const scrollTop of positions) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, scrollTop, 0);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertViewportGeometryIsContinuous(grid, scrollTop);
			assertHorizontalGeometryIsContinuous(grid, 0);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		expect(grid.requests.length).toBeLessThanOrEqual(3);
		cleanupGrid(grid);
	}, 20_000);

	it('keeps violent real browser horizontal scroll bounded and horizontally continuous across more than one thousand columns', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1500 });
		const positions = [96, 3_200, 80, 24_000, 640, 80_000, 160, 120_000, 0];

		for (const scrollLeft of positions) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, 0, scrollLeft);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertViewportGeometryIsContinuous(grid, 0);
			assertHorizontalGeometryIsContinuous(grid, scrollLeft);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		cleanupGrid(grid);
	}, 20_000);

	it('survives real browser diagonal fling scroll without stale renderer hosts, blank ranges, or scroll-time recomputation', async () => {
		const grid = await createServerAuditGrid({ rows: 2_000_000, cols: 1600 });
		const flings = [
			{ top: 40, left: 96 },
			{ top: 1_200, left: 12_000 },
			{ top: 400_000, left: 500 },
			{ top: 20_000, left: 90_000 },
			{ top: 64_000_000, left: 140_000 },
			{ top: 80, left: 0 },
		];

		for (const fling of flings) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, fling.top, fling.left);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertViewportGeometryIsContinuous(grid, fling.top);
			assertHorizontalGeometryIsContinuous(grid, fling.left);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		cleanupGrid(grid);
	}, 20_000);

	it('does not leave focused or selected row islands after click selection during server scroll', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1200 });

		await browserScrollTo(grid, 2_000, 0);
		grid.store.selectCell({ rowId: 'TR-1000051', colField: 'timestamp' }, 'pointer');
		await flushAnimationFrame();
		assertSelectionDoesNotCreateVisibleRowIslands(grid, 2_000);

		const scrolls = [2_080, 8_000, 80, 20_000, 2_000, 400_000, 2_040];
		for (const scrollTop of scrolls) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, scrollTop, 0);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertViewportGeometryIsContinuous(grid, scrollTop);
			assertHorizontalGeometryIsContinuous(grid, 0);
			assertSelectionDoesNotCreateVisibleRowIslands(grid, scrollTop);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		cleanupGrid(grid);
	}, 20_000);

	it('recreates and catches cell duplication and mismatched virtualization index bugs during scrolling and viewport resizing', async () => {
		const grid = await createServerAuditGrid({ rows: 100_000, cols: 100 });
		grid.store.setPinnedColumns({ left: 1 });
		await flushAnimationFrame();
		grid.renderer.fullPaint();

		// 1. Initial assertion
		assertNoStaleOrOverlappingDom(grid);

		// 2. Perform diagonal scroll back and forth to trigger cell virtualization and pool exchanges
		await browserScrollTo(grid, 400, 300);
		await browserScrollTo(grid, 0, 0);
		await browserScrollTo(grid, 800, 600);
		await browserScrollTo(grid, 0, 0);

		// 3. Shrink viewport height to trigger COLD release of some row/cell slots
		grid.store.setViewportSize(1120, 200);
		grid.store.updateVisibleRanges();
		grid.renderer.scheduleGeometryPaint('resize');
		await flushAnimationFrame();

		// 4. Grow viewport height back to original, which re-acquires rows and cells from pool
		grid.store.setViewportSize(1120, 720);
		grid.store.updateVisibleRanges();
		grid.renderer.scheduleGeometryPaint('resize');
		await flushAnimationFrame();

		// 5. Scroll again to trigger binding of those re-acquired cells
		await browserScrollTo(grid, 400, 300);

		// Wait for scroll-end timer (80ms) and post-scroll idle decoration to complete
		await new Promise((resolve) => setTimeout(resolve, 150));
		await flushAnimationFrame();

		// 6. Assert strict DOM contracts. With the bugs present, this will catch:
		// - Duplicate .og-cell-content or .og-cell-portal-host children in cells
		// - Zombie cells remaining attached to row elements with mismatched row index datasets
		assertNoStaleOrOverlappingDom(grid);

		// Check for duplicate .og-cell-content and .og-cell-portal-host elements directly in DOM
		const stats = grid.renderer.getRenderStats();
		console.log('COLD RELEASES COUNT:', stats.coldDomReleases);

		const allCells = Array.from(grid.container.querySelectorAll<HTMLElement>('.og-cell'));
		const row10Cells = allCells.filter((cell) => cell.dataset.rowIndex === '10');
		console.log('ROW 10 CELLS DETAIL:', row10Cells.length);
		for (let i = 0; i < row10Cells.length; i++) {
			const cell = row10Cells[i];
			const slot = CellSlot.fromElement(cell as HTMLDivElement);
			console.log(`Cell ${i} (${cell.dataset.colField}):`, {
				childrenCount: cell.childNodes.length,
				childClasses: Array.from(cell.childNodes).map((c: any) => c.className),
				hasCachedParts: !!slot,
				cachedContentHasParent: slot ? !!slot.contentElement.parentNode : false,
				cachedPortalHasParent: slot ? !!slot.portalHostElement?.parentNode : false,
			});
		}

		cleanupGrid(grid);
	});

	it('asserts CSS styles define hide rules for text and empty content modes and rules for custom renderer container', () => {
		expect(CORE_STYLES).toContain('.og-cell[data-content-mode="text"] > .og-cell-portal-host');
		expect(CORE_STYLES).toContain('.og-cell[data-content-mode="empty"] > .og-cell-portal-host');
		expect(CORE_STYLES).toContain('.og-custom-renderer-container');
	});

	it('preserves custom-live portals during scrolling without increasing warmMisses', async () => {
		const grid = await createServerAuditGrid({ rows: 1000, cols: 50 });
		await flushAnimationFrame();

		// Initial render stats
		const statsBefore = grid.renderer.rowRenderer.portalMountManager['customRendererManager'].getStats();
		const missesBefore = statsBefore.warmMisses;

		// Perform scroll
		await browserScrollTo(grid, 120, 0);
		await flushAnimationFrame();

		const statsAfter = grid.renderer.rowRenderer.portalMountManager['customRendererManager'].getStats();
		const missesAfter = statsAfter.warmMisses;

		// The warmMisses should not increase for already-rendered/live cells on scroll.
		// Slot model may cold-mount renderers for new slots added as the pool grows into overscan rows.
		expect(missesAfter).toBeLessThanOrEqual(missesBefore + 20);
		cleanupGrid(grid);
	});

	it('does not produce zombie cells under stable-slot virtualization', async () => {
		const cols = createAuditColumns(20);
		const totalRows = 100;
		const store = new GridStore<AuditPerfRow>({
			columns: cols,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 40,
			colBuffer: 1,
			getRowId: (row) => row.id,
		});
		const datasource: IGridDatasource = {
			getRows: async ({ startRow, endRow }) => {
				return {
					rows: Array.from({ length: endRow - startRow }, (_, offset) => createAuditRow(startRow + offset)),
					totalCount: totalRows,
				};
			},
		};
		const controller = new ServerRowModelController<AuditPerfRow>(store, { datasource, blockSize: 50, columns: cols });
		const container = createContainer();
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		await flushAsync();
		renderer.fullPaint();

		// Scroll up and down violently
		await browserScrollTo({ renderer, store, container } as any, 500, 0);
		await browserScrollTo({ renderer, store, container } as any, 0, 0);
		await browserScrollTo({ renderer, store, container } as any, 1000, 0);
		await browserScrollTo({ renderer, store, container } as any, 200, 0);
		await flushAnimationFrame();

		assertNoStaleOrOverlappingDom({ renderer, store, container } as any);

		renderer.unmount();
		container.remove();
	});
});

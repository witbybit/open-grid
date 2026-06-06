// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerRowModelController, type IGridDatasource } from '../serverRowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { diffRenderWindow, getColIndices, getRowIndices, type RenderWindow } from './renderWindow.js';

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
			cellRendererCapabilities: { scrollBehavior: 'live', estimatedCost: 'cheap', recycle: 'preserve' },
		},
		{
			field: 'rendererLive',
			header: 'Live Rebind',
			width: 170,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'live', estimatedCost: 'cheap', recycle: 'rebind', supportsRebind: true, warmCache: true },
			valueGetter: ({ row }) => `live|${row.service}`,
		},
		{
			field: 'rendererDefer',
			header: 'Defer Stable',
			width: 170,
			cellRenderer: renderer,
			cellRendererCapabilities: {
				scrollBehavior: 'defer',
				deferFallback: 'snapshot',
				estimatedCost: 'medium',
				interactive: true,
				recycle: 'preserve',
				warmCache: true,
			},
			valueGetterDependencies: ['severity'],
			valueGetter: ({ row }) => `defer|${row.severity}`,
		},
		{
			field: 'severity',
			header: 'Severity',
			width: 120,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'fallback', estimatedCost: 'medium', interactive: false },
		},
		{
			field: 'rendererFallback',
			header: 'Fallback Cache',
			width: 175,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'fallback', estimatedCost: 'expensive', recycle: 'preserve', warmCache: true },
			valueGetterDependencies: ['latencyMs'],
			valueGetter: ({ row }) => `fallback|${row.latencyMs}ms`,
		},
		{
			field: 'rendererDestroy',
			header: 'Destroy Recycle',
			width: 180,
			cellRenderer: renderer,
			cellRendererCapabilities: { scrollBehavior: 'fallback', estimatedCost: 'medium', recycle: 'destroy', warmCache: false },
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
						cellRendererCapabilities: {
							scrollBehavior: 'defer' as const,
							deferFallback: 'snapshot' as const,
							estimatedCost: 'medium' as const,
						},
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

function getScrollContext(grid: AuditGrid) {
	const state = grid.store.getState();
	const displayedColumns = grid.store.engine.columns.getDisplayedColumns();
	return {
		isScrolling: true,
		stateVersion: 0,
		dataVersion: state.dataVersion,
		styleVersion: 0,
		loadingVersion: 0,
		activeEdit: state.activeEdit,
		hasStyleHooks: !!state.styleSlots,
		hasCustomRenderers: displayedColumns.some((column) => !!column.cellRenderer),
		displayedColumns,
		columnPlans: displayedColumns.map((column) => grid.store.engine.columns.getColumnPlan(column.field)!),
		visibleColRange: grid.store.engine.viewport.getVisibleColumnRange(displayedColumns.length),
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
		rowBuffer: 1,
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

function cleanupGrid(grid: AuditGrid): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
}

function assertNoStaleOrOverlappingDom(grid: AuditGrid): void {
	const rows = Array.from(grid.container.querySelectorAll<HTMLElement>('.og-row'));
	expect(grid.renderer.rowRenderer.activeRows.size).toBeGreaterThan(0);
	expect(grid.renderer.rowRenderer.activeRows.size).toBeLessThanOrEqual(28);
	expect(rows.length).toBeGreaterThan(0);
	expect(rows.length).toBeLessThanOrEqual(28 * 3);
	for (const slot of grid.renderer.rowRenderer.activeRows.values()) {
		expect(slot.cells.size).toBeGreaterThan(0);
		expect(slot.cells.size).toBeLessThanOrEqual(360);
	}

	for (const row of rows) {
		const cells = Array.from(row.querySelectorAll<HTMLElement>(':scope > .og-cell'));
		if (cells.length === 0) continue;
		expect(cells.length).toBeLessThanOrEqual(360);

		const fields = cells.map((cell) => cell.dataset.colField).filter(Boolean);
		expect(fields.length).toBe(new Set(fields).size);

		for (const cell of cells) {
			expect(cell.dataset.rowIndex).toBe(row.dataset.rowIndex);
			expect(row.dataset.rowId === cell.dataset.rowId || row.dataset.rowId === `row:${cell.dataset.rowId}`).toBe(true);
			for (const renderer of Array.from(cell.querySelectorAll<HTMLElement>('.og-custom-renderer-container'))) {
				expect(renderer.dataset.cellKey).toBe(cell.dataset.cellKey);
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

function assertScrollStatsAreRuthless(grid: AuditGrid, prevWindow: RenderWindow | null): void {
	const stats = grid.renderer.getRenderStats();
	const window = grid.renderer.rowRenderer.currentWindow as RenderWindow;
	const visibleCols = getColIndices(window).length;
	const activeRows = getRowIndices(window).length;
	const delta = prevWindow ? diffRenderWindow(prevWindow, window) : null;
	const enteredCols = delta ? Math.max(delta.colsEntered.length, delta.colsExited.length) : visibleCols;
	const enteredRows = delta ? Math.max(delta.rowsEntered.length, delta.rowsExited.length) : activeRows;
	const maxExpectedCells = Math.max(activeRows * enteredCols + enteredRows * visibleCols, visibleCols, 1);
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

describe('Server demo ruthless runtime performance contracts', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('mounts the audit-ledger server grid at million-row scale without expanding rendered DOM beyond caps', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1200 });

		expect(grid.store.engine.getRowModel()?.getVisualRowCount()).toBe(1_000_000);
		expect(grid.requests.length).toBeLessThanOrEqual(1);
		assertWindowIsContiguousAndCapped(grid);
		assertNoStaleOrOverlappingDom(grid);

		cleanupGrid(grid);
	});

	it('keeps violent vertical server scroll bounded and visually non-stale across million rows', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1200 });
		const positions = [40, 400, 40_000, 120, 400_000, 4_000, 8_000_000, 80, 20_000_000, 0];

		for (const scrollTop of positions) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			grid.store.engine.viewport.setScrollPosition(scrollTop, 0);
			grid.renderer.rowRenderer.recycleViewport(true, getScrollContext(grid) as any);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		expect(grid.requests.length).toBeLessThanOrEqual(3);
		cleanupGrid(grid);
	});

	it('keeps violent horizontal server scroll bounded across more than one thousand columns', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1500 });
		const positions = [96, 3_200, 80, 24_000, 640, 80_000, 160, 120_000, 0];

		for (const scrollLeft of positions) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			grid.store.engine.viewport.setScrollPosition(0, scrollLeft);
			grid.renderer.rowRenderer.recycleViewport(true, getScrollContext(grid) as any);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		cleanupGrid(grid);
	});

	it('survives diagonal fling scroll without stale renderer hosts, blank ranges, or scroll-time recomputation', async () => {
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
			grid.store.engine.viewport.setScrollPosition(fling.top, fling.left);
			grid.renderer.rowRenderer.recycleViewport(true, getScrollContext(grid) as any);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		cleanupGrid(grid);
	});
});

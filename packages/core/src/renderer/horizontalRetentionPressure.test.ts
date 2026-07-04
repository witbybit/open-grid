// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { CELL_SLOT_RETENTION_CONFIG } from './cellSlotRetention.js';

interface WideRow {
	id: string;
	[field: string]: string;
}

function createWideColumns(count: number): ColumnDef<WideRow>[] {
	return Array.from({ length: count }, (_, i) => ({ field: `c${i}`, header: `Col ${i}`, width: 100 }));
}

function createWideRows(count: number, colCount: number): WideRow[] {
	return Array.from({ length: count }, (_, r) => {
		const row: WideRow = { id: `row-${r}` };
		for (let c = 0; c < colCount; c++) row[`c${c}`] = `r${r}c${c}`;
		return row;
	});
}

function mountWideGrid(rows: number, cols: number, configureStore?: (store: GridStore<WideRow>) => void) {
	// Run scroll-driven RAF work synchronously — jsdom never fires real RAF callbacks on its own.
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

	const columns = createWideColumns(cols);
	const store = new GridStore<WideRow>({
		columns,
		defaultRowHeight: 40,
		defaultColWidth: 100,
		getRowId: (row) => row.id,
	});
	configureStore?.(store);
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: createWideRows(rows, cols),
		columns: store.getState().columns,
	});
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 500,
		bottom: 300,
		width: 500,
		height: 300,
		toJSON: () => ({}),
	} as DOMRect);
	document.body.appendChild(container);

	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	return { store, controller, container, renderer };
}

function cleanup(grid: ReturnType<typeof mountWideGrid>): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
	vi.unstubAllGlobals();
}

describe('horizontal cell-slot retention pressure (bounded by cellSlotRetention.ts)', () => {
	it('bounds cellsByColumnInstanceId per row slot even after scrolling through far more distinct columns than the bound', () => {
		// 3000 columns at 100px each — far more than fit in any single horizontal window.
		const totalCols = 3000;
		const grid = mountWideGrid(30, totalCols);

		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		expect(scrollViewport).not.toBeNull();

		const [firstSlot] = grid.renderer.rowRenderer.activeRows.values();
		expect(firstSlot).toBeDefined();
		const initialCellCount = firstSlot.cellsByColumnInstanceId.size;
		expect(initialCellCount).toBeGreaterThan(0);
		// Sanity: nowhere near the full column set is retained after initial mount.
		expect(initialCellCount).toBeLessThan(totalCols / 2);

		// Scroll across many distinct horizontal windows — far enough that none of the
		// windows overlap, so every pass visits columns the row slot has never bound before.
		const totalScrollWidth = totalCols * 100 - 500;
		const windowCount = 20;
		for (let i = 1; i <= windowCount; i++) {
			scrollViewport.scrollLeft = Math.floor((totalScrollWidth * i) / windowCount);
			scrollViewport.dispatchEvent(new Event('scroll'));
		}

		const [slotAfterScroll] = grid.renderer.rowRenderer.activeRows.values();
		const cellCountAfterScroll = slotAfterScroll.cellsByColumnInstanceId.size;

		// Without eviction, 20 non-overlapping windows would have retained on the order of
		// 20 * initialCellCount (100+) distinct CellSlot objects forever. cellSlotRetention.ts
		// bounds cellsByColumnInstanceId to the currently-needed set (visible + approach-band + pinned +
		// focused) plus a small LRU tail of recently-exited columns — never the full history.
		const bound = CELL_SLOT_RETENTION_CONFIG.maxRetainedCenterCellsPerRowSlot + CELL_SLOT_RETENTION_CONFIG.maxRecentlyExitedColumnsPerRowSlot;
		expect(cellCountAfterScroll).toBeLessThanOrEqual(bound);
		// Still grew somewhat from the initial mount (the LRU tail is doing real work, not just
		// always sitting empty) — this isn't a trivial "always equals the visible window" bound.
		expect(cellCountAfterScroll).toBeGreaterThan(initialCellCount);

		cleanup(grid);
	}, 15_000); // 3000-column mount + 20 scroll windows is slow under full-suite parallel load (~5-9s observed)

	it('retains a bounded working set immediately after mount before any horizontal scroll', () => {
		// Establishes the "healthy" baseline this file's growth assertion is measured against —
		// at rest, a row slot should only hold cells for its initially visible + buffered columns.
		const grid = mountWideGrid(30, 3000);
		const [slot] = grid.renderer.rowRenderer.activeRows.values();
		expect(slot).toBeDefined();
		// Viewport is 500px wide at 100px/col ⇒ ~5 visible columns, plus colBuffer on each side.
		expect(slot.cellsByColumnInstanceId.size).toBeLessThan(20);
		cleanup(grid);
	});

	it('never evicts pinned-left/right columns under retention pressure, even far from the visible window', () => {
		const totalCols = 3000;
		const grid = mountWideGrid(30, totalCols, (store) => store.setPinnedColumns({ left: 1, right: 1 }));

		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		const instanceIdOf = (field: string) => (grid.store.engine.columns.getColumnDef(field) as { instanceId: string } | undefined)?.instanceId;
		const firstInstanceId = instanceIdOf('c0');
		const lastInstanceId = instanceIdOf(`c${totalCols - 1}`);
		const [slot] = grid.renderer.rowRenderer.activeRows.values();
		expect(slot.cellsByColumnInstanceId.has(firstInstanceId as any)).toBe(true); // pinned-left
		expect(slot.cellsByColumnInstanceId.has(lastInstanceId as any)).toBe(true); // pinned-right

		// Scroll far enough, across enough distinct windows, to blow well past the retention
		// budget for ordinary center columns.
		const totalScrollWidth = totalCols * 100 - 500;
		for (let i = 1; i <= 20; i++) {
			scrollViewport.scrollLeft = Math.floor((totalScrollWidth * i) / 20);
			scrollViewport.dispatchEvent(new Event('scroll'));
		}

		const [slotAfterScroll] = grid.renderer.rowRenderer.activeRows.values();
		expect(slotAfterScroll.cellsByColumnInstanceId.has(firstInstanceId as any)).toBe(true);
		expect(slotAfterScroll.cellsByColumnInstanceId.has(lastInstanceId as any)).toBe(true);
		// And they're still the correct physical cells for their pinned lane, not stale/recreated
		// with the wrong identity.
		expect(slotAfterScroll.leftCells[0]?.colField).toBe('c0');
		expect(slotAfterScroll.rightCells[0]?.colField).toBe(`c${totalCols - 1}`);

		cleanup(grid);
	});
});

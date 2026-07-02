// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';

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

function mountWideGrid(rows: number, cols: number) {
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

describe('horizontal cell-slot retention pressure (characterization — Phase 5 will bound this)', () => {
	it('grows cellsByColumnId per row slot proportionally to distinct columns scrolled through, with no eviction', () => {
		// 3000 columns at 100px each — far more than fit in any single horizontal window.
		const totalCols = 3000;
		const grid = mountWideGrid(30, totalCols);

		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		expect(scrollViewport).not.toBeNull();

		const [firstSlot] = grid.renderer.rowRenderer.activeRows.values();
		expect(firstSlot).toBeDefined();
		const initialCellCount = firstSlot.cellsByColumnId.size;
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
		const cellCountAfterScroll = slotAfterScroll.cellsByColumnId.size;

		// Current reality: reconcileCellTopologyForScroll never evicts from cellsByColumnId —
		// it only detaches DOM for off-window columns and keeps the CellSlot object forever.
		// This assertion documents that unbounded growth, proportional to distinct columns
		// visited, is what happens today. Phase 5 (cellSlotRetention.ts) replaces this with a
		// bounded policy (visible + approach-band + pinned + small LRU); at that point this
		// assertion must be replaced with an upper bound close to initialCellCount.
		expect(cellCountAfterScroll).toBeGreaterThan(initialCellCount * 5);

		cleanup(grid);
	});

	it('retains a bounded working set immediately after mount before any horizontal scroll', () => {
		// Establishes the "healthy" baseline this file's growth assertion is measured against —
		// at rest, a row slot should only hold cells for its initially visible + buffered columns.
		const grid = mountWideGrid(30, 3000);
		const [slot] = grid.renderer.rowRenderer.activeRows.values();
		expect(slot).toBeDefined();
		// Viewport is 500px wide at 100px/col ⇒ ~5 visible columns, plus colBuffer on each side.
		expect(slot.cellsByColumnId.size).toBeLessThan(20);
		cleanup(grid);
	});
});

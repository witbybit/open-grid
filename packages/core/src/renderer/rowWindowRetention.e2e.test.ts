// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';

interface TallRow {
	id: string;
	name: string;
}

function createTallRows(count: number): TallRow[] {
	return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}` }));
}

function mountTallGrid(rowCount: number) {
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

	const columns: ColumnDef<TallRow>[] = [{ field: 'name', header: 'Name', width: 150 }];
	const store = new GridStore<TallRow>({ columns, defaultRowHeight: 40, defaultColWidth: 150, getRowId: (row) => row.id });
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: createTallRows(rowCount),
		columns: store.getState().columns,
	});
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 300,
		bottom: 400,
		width: 300,
		height: 400,
		toJSON: () => ({}),
	} as DOMRect);
	document.body.appendChild(container);

	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	return { store, controller, container, renderer };
}

function cleanup(grid: ReturnType<typeof mountTallGrid>): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
	vi.unstubAllGlobals();
}

describe('vertical focus/edit row retention — end to end', () => {
	it('a focused row scrolled far out of the render window keeps its RowCtrl and CellCtrl alive, and reuses the same identity on scroll-back', () => {
		const grid = mountTallGrid(2000);
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		expect(scrollViewport).not.toBeNull();

		// Focus a row near the top.
		grid.store.selectCell({ rowId: 'row-5', colField: 'name' }, 'pointer');

		const rowCtrlBefore = grid.store.engine.rowCtrls.get('row-5');
		expect(rowCtrlBefore).toBeDefined();
		const column = grid.store.engine.columns.getPrimaryColumnByField('name');
		expect(column).toBeDefined();
		const cellCtrlBefore = grid.store.engine.rowCtrls.cellCtrls.getByRowAndColumn('row-5', column!.instanceId);
		expect(cellCtrlBefore).toBeDefined();

		// Scroll far enough that row-5 falls well outside the normal render window.
		scrollViewport.scrollTop = 40 * 1000; // ~row 1000 at 40px/row
		scrollViewport.dispatchEvent(new Event('scroll'));

		// The focused row's RowCtrl must survive — vertical retention keeps it bound in the pool,
		// and even if retention were absent, RowCtrlStore itself never evicts a merely-virtualized row.
		const rowCtrlDuringScroll = grid.store.engine.rowCtrls.get('row-5');
		expect(rowCtrlDuringScroll).toBe(rowCtrlBefore);

		// It should still be physically attached (vertical retention keeps it in the pool), not just
		// remembered in the store with a stale attachedSlotId.
		expect(rowCtrlDuringScroll!.attachedSlotId).toBeDefined();

		// Scroll back to the top.
		scrollViewport.scrollTop = 0;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const rowCtrlAfter = grid.store.engine.rowCtrls.get('row-5');
		expect(rowCtrlAfter).toBe(rowCtrlBefore);
		const cellCtrlAfter = grid.store.engine.rowCtrls.cellCtrls.getByRowAndColumn('row-5', column!.instanceId);
		expect(cellCtrlAfter).toBe(cellCtrlBefore);

		cleanup(grid);
	});

	it('a non-focused row scrolled out of the window is not force-retained (baseline: retention is targeted, not universal)', () => {
		const grid = mountTallGrid(2000);
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;

		// No focus/edit set anywhere.
		scrollViewport.scrollTop = 40 * 1000;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const activeRowIndices = new Set(grid.renderer.rowRenderer.activeRows.keys());
		// row-5 (index 5) should not be forced into the pool just because it once existed.
		expect(activeRowIndices.has(5)).toBe(false);

		cleanup(grid);
	});
});

import { describe, expect, it } from 'vitest';
import { RowCtrlStore } from './RowCtrlStore.js';
import { getOrCreateCellCtrl } from './RowCtrl.js';

describe('RowCtrlStore', () => {
	it('creates a fresh RowCtrl for a new rowId', () => {
		const store = new RowCtrlStore();
		const ctrl = store.getOrCreate('r1');
		expect(ctrl.rowId).toBe('r1');
		expect(ctrl.cells.size).toBe(0);
		expect(store.stats.created).toBe(1);
	});

	it('reuses the same RowCtrl object across repeated getOrCreate calls for the same rowId', () => {
		const store = new RowCtrlStore();
		const first = store.getOrCreate('r1');
		const second = store.getOrCreate('r1');
		expect(second).toBe(first);
		expect(store.stats.created).toBe(1);
		expect(store.stats.reused).toBe(1);
	});

	it('row rebind: deleting a rowId does not affect a differently-keyed RowCtrl, and re-creating after delete never resurrects identity', () => {
		const store = new RowCtrlStore();
		const original = store.getOrCreate('r1');
		original.rowVersion = 5;

		store.delete('r1');
		expect(store.get('r1')).toBeUndefined();

		const recreated = store.getOrCreate('r1');
		expect(recreated).not.toBe(original);
		expect(recreated.rowVersion).toBe(-1); // fresh controller, no memory of the deleted one
		expect(store.stats.evicted).toBe(1);
	});

	it('sweep removes every RowCtrl not in the live set', () => {
		const store = new RowCtrlStore();
		store.getOrCreate('r1');
		store.getOrCreate('r2');
		store.getOrCreate('r3');

		const evicted = store.sweep(new Set(['r2']));
		expect(evicted).toBe(2);
		expect(store.get('r1')).toBeUndefined();
		expect(store.get('r2')).toBeDefined();
		expect(store.get('r3')).toBeUndefined();
	});

	it('virtualized-out rows survive: a RowCtrl is not deleted just because attachedSlotId is cleared', () => {
		const store = new RowCtrlStore();
		const ctrl = store.getOrCreate('r1');
		ctrl.attachedSlotId = 'rsp-0';
		// Simulate scrolling the row out of the render window — caller clears attachedSlotId but
		// must NOT call delete() for a merely-virtualized row.
		ctrl.attachedSlotId = undefined;
		expect(store.get('r1')).toBe(ctrl);
	});
});

describe('getOrCreateCellCtrl', () => {
	it('creates a CellCtrl keyed by field within the row', () => {
		const store = new RowCtrlStore();
		const rowCtrl = store.getOrCreate('r1');
		const { cellCtrl, created } = getOrCreateCellCtrl(rowCtrl, 'price', 'coli1' as any);
		expect(created).toBe(true);
		expect(cellCtrl.rowId).toBe('r1');
		expect(cellCtrl.field).toBe('price');
		expect(cellCtrl.columnInstanceId).toBe('coli1');
	});

	it('reuses the same CellCtrl object across frames for the same (rowId, columnInstanceId)', () => {
		const store = new RowCtrlStore();
		const rowCtrl = store.getOrCreate('r1');
		const first = getOrCreateCellCtrl(rowCtrl, 'price', 'coli1' as any);
		const second = getOrCreateCellCtrl(rowCtrl, 'price', 'coli1' as any);
		expect(second.cellCtrl).toBe(first.cellCtrl);
		expect(second.created).toBe(false);
	});

	it('same field, different columnInstanceId (semantic replacement) — mints a fresh CellCtrl, does not reuse the stale one', () => {
		const store = new RowCtrlStore();
		const rowCtrl = store.getOrCreate('r1');
		const before = getOrCreateCellCtrl(rowCtrl, 'price', 'coli1' as any);
		before.cellCtrl.lastResolvedContentMode = 'portal';

		const after = getOrCreateCellCtrl(rowCtrl, 'price', 'coli2' as any);
		expect(after.created).toBe(true);
		expect(after.cellCtrl).not.toBe(before.cellCtrl);
		expect(after.cellCtrl.lastResolvedContentMode).toBeUndefined();
		expect(after.cellCtrl.columnInstanceId).toBe('coli2');
	});

	it('row rebind: CellCtrls for the old row are not visible from the new RowCtrl at the same field', () => {
		const store = new RowCtrlStore();
		const rowA = store.getOrCreate('rowA');
		getOrCreateCellCtrl(rowA, 'price', 'coli1' as any).cellCtrl.lastResolvedContentMode = 'text';

		// A different logical row reuses the same physical slot conceptually, but RowCtrlStore keys
		// by rowId, not slot — rowB's CellCtrl map starts empty regardless of rowA's state.
		const rowB = store.getOrCreate('rowB');
		const { cellCtrl, created } = getOrCreateCellCtrl(rowB, 'price', 'coli1' as any);
		expect(created).toBe(true);
		expect(cellCtrl.lastResolvedContentMode).toBeUndefined();
	});
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../../rowModel.js';
import { GridStore, type ColumnDef } from '../../store.js';
import { mountedCellFreshness } from '../visualFreshness.js';
import { RenderEngine } from '../renderEngine.js';
import { CellSlot } from '../cellSlot.js';

interface Row {
	id: string;
	name: string;
}

/**
 * Plan 154 Task 11 (Phase 3b): CellCtrl.lastResolvedFreshness must be a truthful mirror of what its
 * physical CellSlot actually has stamped — not an independently reconstructed value. Several binder
 * branches (freeze, html-snapshot, text-impostor) only conditionally call stampMountedVersions on
 * cellSlot (see binders/binderShared.ts), so reconstructing CellCtrl's freshness from the current
 * frame's context values (as rowCellBinder.ts used to) could diverge from what cellSlot really has
 * mounted whenever that condition doesn't fire. stampCellCtrlResolution now reads straight from
 * cellSlot (mountedCellFreshness) instead, which this test locks in.
 */
describe('CellCtrl.lastResolvedFreshness — mirrors CellSlot, not an independently reconstructed value', () => {
	it('after a full bind, cellCtrl.lastResolvedFreshness equals mountedCellFreshness(cellSlot) for the physical slot showing that row', () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

		const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name', width: 150 }];
		const store = new GridStore<Row>({ columns, defaultRowHeight: 40, defaultColWidth: 150, getRowId: (r) => r.id });
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}` })),
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

		const rowCtrl = store.engine.rowCtrls.get('row-0');
		expect(rowCtrl).toBeDefined();
		const column = store.engine.columns.getPrimaryColumnByField('name');
		expect(column).toBeDefined();
		const cellCtrl = store.engine.rowCtrls.cellCtrls.getByRowAndColumn('row-0', column!.instanceId);
		expect(cellCtrl).toBeDefined();
		expect(cellCtrl!.lastResolvedFreshness).not.toBeUndefined();

		const cellEl = container.querySelector('.og-cell[data-row-id="row-0"][data-col-field="name"]') as HTMLDivElement;
		expect(cellEl).not.toBeNull();
		const cellSlot = CellSlot.fromElement(cellEl);

		expect(cellCtrl!.lastResolvedFreshness).toEqual(mountedCellFreshness(cellSlot));

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.unstubAllGlobals();
	});
});

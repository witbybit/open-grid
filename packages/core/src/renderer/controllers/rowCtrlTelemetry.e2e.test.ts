// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../../rowModel.js';
import { GridStore, type ColumnDef } from '../../store.js';
import { RenderEngine } from '../renderEngine.js';

interface Row {
	id: string;
	name: string;
}

describe('RenderStats.controllers — end to end', () => {
	it('reports rowCtrls/cellCtrls created counts after mounting a grid, and resets to zero on resetRenderStats', () => {
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

		const stats = renderer.getRenderStats();
		expect(stats.controllers).toBeDefined();
		expect(stats.controllers!.rowCtrlsCreated).toBeGreaterThan(0);
		expect(stats.controllers!.cellCtrlsCreated).toBeGreaterThan(0);

		renderer.resetRenderStats();
		const resetStats = renderer.getRenderStats();
		expect(resetStats.controllers!.rowCtrlsCreated).toBe(0);
		expect(resetStats.controllers!.cellCtrlsCreated).toBe(0);
		// RowCtrls attached earlier still exist in the store — resetting stats must not evict them.
		expect(store.engine.rowCtrls.get('row-0')).toBeDefined();

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.unstubAllGlobals();
	});
});

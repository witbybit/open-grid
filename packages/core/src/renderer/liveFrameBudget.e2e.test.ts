// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';

interface LiveRow {
	id: string;
	value: string;
}

function mountLiveGrid(rowCount: number) {
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

	const columns: ColumnDef<LiveRow>[] = [
		{
			field: 'value',
			header: 'Value',
			width: 150,
			cellRenderer: () => null,
			cellRendererCapabilities: { scrollPresentation: 'live' } as any,
		} as any,
	];
	const store = new GridStore<LiveRow>({
		columns,
		defaultRowHeight: 40,
		defaultColWidth: 150,
		getRowId: (row) => row.id,
		rendererOptions: {
			liveReact: {
				rowOverscan: 2,
				columnOverscan: 1,
				maxMountsPerFrame: 100,
				maxUpdatesPerFrame: 100,
			},
		},
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: Array.from({ length: rowCount }, (_, i) => ({ id: `row-${i}`, value: `v${i}` })),
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

function cleanup(grid: ReturnType<typeof mountLiveGrid>): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
	vi.unstubAllGlobals();
}

describe('LiveFrameBudget wiring — end to end sanity (unconfigured)', () => {
	it('unconfigured budget does not interfere with ordinary live-cell scrolling', () => {
		const grid = mountLiveGrid(200);
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = grid.renderer.getRenderStats() as any;
		// Physical live cells recycle their portal across row rebinds (keyed by CellSlot instance, not
		// row id — see identityKeys.ts's createCellInstanceRendererKey), so once the pool is warm
		// (as it is here, after the initial full mount), scrolling produces updates, not fresh mounts.
		// Either counter firing proves the wiring runs; see liveCellBinder.budget.test.ts for the
		// mount-vs-update/emergency-shell branch logic itself, tested directly and deterministically.
		expect(stats.liveReactMountsDuringScroll + stats.liveReactUpdatesDuringScroll).toBeGreaterThan(0);
		expect(stats.liveReactEmergencyShellsDuringScroll || 0).toBe(0);
		expect(stats.liveReactOverscanMounts || 0).toBeGreaterThanOrEqual(0);

		cleanup(grid);
	});

	it('live overscan execution mounts offscreen live cells and records the overscan work', () => {
		const grid = mountLiveGrid(200);
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = grid.renderer.getRenderStats() as any;
		const plan = grid.renderer.rowRenderer.currentViewportPlan;
		expect(plan).not.toBeNull();
		expect(plan!.liveCells.overscan.length).toBeGreaterThan(0);
		expect(stats.liveReactOverscanMounts || 0).toBeGreaterThan(0);

		cleanup(grid);
	});
});

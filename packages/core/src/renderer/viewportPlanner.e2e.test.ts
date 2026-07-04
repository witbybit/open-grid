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
	const store = new GridStore<LiveRow>({ columns, defaultRowHeight: 40, defaultColWidth: 150, getRowId: (row) => row.id });
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

describe('ViewportPlanner wiring — end to end', () => {
	it('a scrollPresentation:"live" column populates ViewportPlan.liveRows/liveCenterColumns during a scroll frame', () => {
		const grid = mountLiveGrid(200);
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		expect(scrollViewport).not.toBeNull();

		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const plan = grid.renderer.rowRenderer.currentViewportPlan;
		expect(plan).not.toBeNull();
		expect(plan!.liveRows.size).toBeGreaterThan(0);
		expect(plan!.liveCenterColumns.size).toBeGreaterThan(0);

		cleanup(grid);
	});

	it('a non-live (freeze default) column does not populate liveRows/liveCenterColumns', () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});
		const columns: ColumnDef<LiveRow>[] = [{ field: 'value', header: 'Value', width: 150 }];
		const store = new GridStore<LiveRow>({ columns, defaultRowHeight: 40, defaultColWidth: 150, getRowId: (row) => row.id });
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 200 }, (_, i) => ({ id: `row-${i}`, value: `v${i}` })),
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

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const plan = renderer.rowRenderer.currentViewportPlan;
		expect(plan).not.toBeNull();
		expect(plan!.liveRows.size).toBe(0);
		expect(plan!.liveCenterColumns.size).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.unstubAllGlobals();
	});
});

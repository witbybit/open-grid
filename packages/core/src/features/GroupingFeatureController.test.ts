import { describe, it, expect, vi } from 'vitest';
import { GroupingFeatureController } from './GroupingFeatureController.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

interface TestRow {
	id: string;
	name: string;
	category: string;
}

function makeStore(): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'category', header: 'Category', width: 100 },
		],
		getRowId: (row) => row.id,
	});
}

function makeController(store: GridStore<TestRow>): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store, {
		rows: [
			{ id: '1', name: 'Product A', category: 'Fruit' },
			{ id: '2', name: 'Product B', category: 'Veggie' },
		],
		columns: store.getState().columns,
	});
}

function getFeatureContext(store: GridStore<TestRow>): GridFeatureContext<TestRow> {
	const engine = (store as any).engine;
	return {
		stateManager: engine.stateManager,
		columns: engine.columns,
		invalidation: engine.invalidation,
		eventBus: engine.eventBus,
		changeApplier: engine.changeApplier,
		commandHistory: engine.commandHistory,
		requestRender: (reason: string) => engine.eventBus.dispatchEvent(GridEventName.renderInvalidated, { reason }),
	};
}

describe('GroupingFeatureController', () => {
	describe('setGroupBy', () => {
		it('clears expansion.groups', () => {
			const store = makeStore();
			store.setState((s) => ({
				...s,
				expansion: { groups: { 'group-1': true as const }, treeRows: {}, details: {} },
			}));
			const feature = new GroupingFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.setGroupBy(['name']);

			expect(store.getState().expansion.groups).toEqual({});
			store.destroy();
		});

		it('updates groupBy in state', () => {
			const store = makeStore();
			const feature = new GroupingFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.setGroupBy(['category']);

			expect(store.getState().groupBy).toEqual(['category']);
			store.destroy();
		});

		it('invalidates geometry, viewport, headers, overlay', () => {
			const store = makeStore();
			const engine = (store as any).engine;
			const feature = new GroupingFeatureController(getFeatureContext(store), () => store.getRowModel());

			const spyGeometry = vi.spyOn(engine.invalidation, 'invalidateGeometry');
			const spyViewport = vi.spyOn(engine.invalidation, 'invalidateViewport');
			const spyHeaders = vi.spyOn(engine.invalidation, 'invalidateHeaders');
			const spyOverlay = vi.spyOn(engine.invalidation, 'invalidateOverlay');

			feature.setGroupBy(['category']);

			expect(spyGeometry).toHaveBeenCalled();
			expect(spyViewport).toHaveBeenCalled();
			expect(spyHeaders).toHaveBeenCalled();
			expect(spyOverlay).toHaveBeenCalled();
			store.destroy();
		});

		it('emits groupByChanged event', () => {
			const store = makeStore();
			const listener = vi.fn();
			store.addEventListener(GridEventName.groupByChanged, listener);
			const feature = new GroupingFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.setGroupBy(['category']);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ groupBy: ['category'] }) }));
			store.destroy();
		});
	});

	describe('addGroupBy', () => {
		it('inserts colId and dispatches groupColumnAdded', () => {
			const store = makeStore();
			const listener = vi.fn();
			store.addEventListener(GridEventName.groupColumnAdded, listener);
			const feature = new GroupingFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.addGroupBy('name');

			expect(store.getState().groupBy).toContain('name');
			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ colId: 'name' }) }));
			store.destroy();
		});

		it('does not duplicate already-added colId', () => {
			const store = makeStore();
			const feature = new GroupingFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.addGroupBy('name');
			feature.addGroupBy('name');

			expect(store.getState().groupBy?.filter((id) => id === 'name')).toHaveLength(1);
			store.destroy();
		});
	});

	describe('removeGroupBy', () => {
		it('removes colId and dispatches groupColumnRemoved', () => {
			const store = makeStore();
			const listener = vi.fn();
			store.addEventListener(GridEventName.groupColumnRemoved, listener);
			const feature = new GroupingFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.addGroupBy('name');
			listener.mockClear();
			feature.removeGroupBy('name');

			expect(store.getState().groupBy).not.toContain('name');
			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ colId: 'name' }) }));
			store.destroy();
		});
	});

	describe('setAggDefs', () => {
		it('invalidates viewport and overlay, emits aggDefsChanged', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const engine = (store as any).engine;
			const feature = new GroupingFeatureController(getFeatureContext(store), () => store.getRowModel());
			const listener = vi.fn();
			store.addEventListener(GridEventName.aggDefsChanged, listener);

			const spyViewport = vi.spyOn(engine.invalidation, 'invalidateViewport');
			const spyOverlay = vi.spyOn(engine.invalidation, 'invalidateOverlay');

			feature.setAggDefs([] as any[]);

			expect(spyViewport).toHaveBeenCalled();
			expect(spyOverlay).toHaveBeenCalled();
			expect(listener).toHaveBeenCalledOnce();

			ctrl.dispose();
			store.destroy();
		});

		it('updates aggDefs in state', () => {
			const store = makeStore();
			const feature = new GroupingFeatureController(getFeatureContext(store), () => store.getRowModel());
			const defs = [{ colField: 'id', type: 'count' as const }] as any[];

			feature.setAggDefs(defs);

			expect(store.getState().aggDefs).toEqual(defs);
			store.destroy();
		});
	});
});

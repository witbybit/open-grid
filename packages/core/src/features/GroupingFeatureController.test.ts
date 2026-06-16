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
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
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
		columns: engine.columns,
		getState: () => engine.stateManager.getState(),
		applyChange: (change) => engine.changeApplier.apply(change),
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
			const feature = new GroupingFeatureController({
				ctx: getFeatureContext(store),
				getRowModel: () => store.getRowModel(),
				invalidation: (store as any).engine.invalidation,
			});

			feature.setGroupBy(['name']);

			expect(store.getState().expansion.groups).toEqual({});
			store.destroy();
		});

		it('updates groupBy in state', () => {
			const store = makeStore();
			const feature = new GroupingFeatureController({
				ctx: getFeatureContext(store),
				getRowModel: () => store.getRowModel(),
				invalidation: (store as any).engine.invalidation,
			});

			feature.setGroupBy(['category']);

			expect(store.getState().groupBy).toEqual(['category']);
			store.destroy();
		});

		it('invalidates geometry, viewport, headers, overlay', () => {
			const store = makeStore();
			const engine = (store as any).engine;
			const feature = new GroupingFeatureController({
				ctx: getFeatureContext(store),
				getRowModel: () => store.getRowModel(),
				invalidation: (store as any).engine.invalidation,
			});

			const spyInvalidate = vi.spyOn(engine.invalidation, 'invalidate');

			feature.setGroupBy(['category']);

			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'geometry' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'viewport' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'headers' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'overlay' }));
			store.destroy();
		});

		it('emits groupByChanged event', () => {
			const store = makeStore();
			const listener = vi.fn();
			store.addEventListener(GridEventName.groupByChanged, listener);
			const feature = new GroupingFeatureController({
				ctx: getFeatureContext(store),
				getRowModel: () => store.getRowModel(),
				invalidation: (store as any).engine.invalidation,
			});

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
			const feature = new GroupingFeatureController({
				ctx: getFeatureContext(store),
				getRowModel: () => store.getRowModel(),
				invalidation: (store as any).engine.invalidation,
			});

			feature.addGroupBy('name');

			expect(store.getState().groupBy).toContain('name');
			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ colId: 'name' }) }));
			store.destroy();
		});

		it('does not duplicate already-added colId', () => {
			const store = makeStore();
			const feature = new GroupingFeatureController({
				ctx: getFeatureContext(store),
				getRowModel: () => store.getRowModel(),
				invalidation: (store as any).engine.invalidation,
			});

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
			const feature = new GroupingFeatureController({
				ctx: getFeatureContext(store),
				getRowModel: () => store.getRowModel(),
				invalidation: (store as any).engine.invalidation,
			});

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
			const feature = new GroupingFeatureController({
				ctx: getFeatureContext(store),
				getRowModel: () => store.getRowModel(),
				invalidation: (store as any).engine.invalidation,
			});
			const listener = vi.fn();
			store.addEventListener(GridEventName.aggDefsChanged, listener);

			const spyInvalidate = vi.spyOn(engine.invalidation, 'invalidate');

			feature.setAggDefs([] as any[]);

			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'viewport' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'overlay' }));
			expect(listener).toHaveBeenCalledOnce();

			ctrl.dispose();
			store.destroy();
		});

		it('updates aggDefs in state', () => {
			const store = makeStore();
			const feature = new GroupingFeatureController({
				ctx: getFeatureContext(store),
				getRowModel: () => store.getRowModel(),
				invalidation: (store as any).engine.invalidation,
			});
			const defs = [{ colField: 'id', type: 'count' as const }] as any[];

			feature.setAggDefs(defs);

			expect(store.getState().aggDefs).toEqual(defs);
			store.destroy();
		});
	});
});

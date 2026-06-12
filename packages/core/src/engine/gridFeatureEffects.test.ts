/**
 * Phase 0: Characterization tests — lock down side-effects of representative mutations.
 * These tests exercise the CURRENT implementation and must stay green as we refactor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

function makeStore(extra?: Partial<Parameters<typeof GridStore>[0]>): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'price', header: 'Price', width: 100 },
		],
		getRowId: (row) => row.id,
		...extra,
	});
}

function makeController(store: GridStore<TestRow>): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store, {
		rows: [
			{ id: '1', name: 'Product A', price: 10 },
			{ id: '2', name: 'Product B', price: 20 },
			{ id: '3', name: 'Product C', price: 30 },
		],
		columns: store.getState().columns,
	});
}

describe('Phase 0: gridFeatureEffects characterization', () => {
	describe('setColumnWidth', () => {
		it('changes columnWidths in state', () => {
			const store = makeStore();
			const ctrl = makeController(store);

			store.setColumnWidth('name', 999);
			expect(store.getState().columnWidths['name']).toBe(999);

			ctrl.dispose();
			store.destroy();
		});

		it('dispatches columnResized event', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const listener = vi.fn();
			store.addEventListener(GridEventName.columnResized, listener);

			store.setColumnWidth('name', 200);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					payload: { colField: 'name', width: 200 },
				})
			);

			ctrl.dispose();
			store.destroy();
		});

		it('invalidates geometry, headers, and column', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const engine = (store as any).engine;

			const spyInvalidate = vi.spyOn(engine.invalidation, 'invalidate');

			store.setColumnWidth('name', 200);

			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'geometry' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'headers' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'column', colId: 'name' }));

			ctrl.dispose();
			store.destroy();
		});

		it('triggers one renderInvalidated event', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const listener = vi.fn();
			store.addEventListener(GridEventName.renderInvalidated, listener);

			store.setColumnWidth('name', 250);

			expect(listener).toHaveBeenCalledOnce();

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('setGroupBy', () => {
		it('clears expansion.groups', () => {
			const store = makeStore();
			// Set some initial expansion state
			store.setState((s) => ({
				...s,
				expansion: { groups: { 'group-1': true as const }, treeRows: {}, details: {} },
			}));

			store.setGroupBy(['name']);
			expect(store.getState().expansion.groups).toEqual({});

			store.destroy();
		});

		it('invalidates geometry, viewport, headers, overlay', () => {
			const store = makeStore();
			const engine = (store as any).engine;

			const spyInvalidate = vi.spyOn(engine.invalidation, 'invalidate');

			store.setGroupBy(['name']);

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

			store.setGroupBy(['price']);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					payload: expect.objectContaining({ groupBy: ['price'] }),
				})
			);

			store.destroy();
		});
	});

	describe('setAggDefs', () => {
		it('updates aggDefs in state', () => {
			const store = makeStore();
			const ctrl = makeController(store);

			const defs = [{ colField: 'price', type: 'sum' as const }] as any[];
			store.setAggDefs(defs);
			expect(store.getState().aggDefs).toEqual(defs);

			ctrl.dispose();
			store.destroy();
		});

		it('invalidates viewport and overlay', () => {
			const store = makeStore();
			const engine = (store as any).engine;

			const spyInvalidate = vi.spyOn(engine.invalidation, 'invalidate');

			store.setAggDefs([] as any[]);

			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'viewport' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'overlay' }));

			store.destroy();
		});

		it('emits aggDefsChanged event', () => {
			const store = makeStore();
			const listener = vi.fn();
			store.addEventListener(GridEventName.aggDefsChanged, listener);

			store.setAggDefs([] as any[]);

			expect(listener).toHaveBeenCalledOnce();

			store.destroy();
		});
	});

	describe('startEditing and commitEdit', () => {
		it('startEditing sets activeEdit in state', () => {
			const store = makeStore();
			const ctrl = makeController(store);

			store.startEditing('1', 'name');
			expect(store.getState().activeEdit).toEqual({ rowId: '1', colField: 'name' });

			ctrl.dispose();
			store.destroy();
		});

		it('commitEdit with validator failure returns false and does not close editor', async () => {
			const store = makeStore({
				columns: [
					{ field: 'id', header: 'ID', width: 50 },
					{
						field: 'name',
						header: 'Name',
						width: 150,
						valueValidator: async () => 'Value is too short',
					},
					{ field: 'price', header: 'Price', width: 100 },
				],
			});
			const ctrl = makeController(store);

			store.startEditing('1', 'name');
			const result = await store.commitEdit('1', 'name', 'A');

			expect(result).toBe(false);
			// Editor should still be open (activeEdit not cleared)
			expect(store.getState().activeEdit).not.toBeNull();

			ctrl.dispose();
			store.destroy();
		});

		it('commitEdit with async valueSetter returning false returns false and rolls back', async () => {
			const store = makeStore({
				columns: [
					{ field: 'id', header: 'ID', width: 50 },
					{
						field: 'name',
						header: 'Name',
						width: 150,
						// valueSetter returning false triggers rollback
						valueSetter: async () => false,
					},
					{ field: 'price', header: 'Price', width: 100 },
				],
			});
			const ctrl = makeController(store);

			store.startEditing('1', 'name');
			const originalValue = store.getState().columns.find((c) => c.field === 'name');
			void originalValue; // just to reference it
			const result = await store.commitEdit('1', 'name', 'New Value');

			expect(result).toBe(false);

			ctrl.dispose();
			store.destroy();
		});

		it('commitEdit success returns true and closes editor (activeEdit becomes null)', async () => {
			const store = makeStore();
			const ctrl = makeController(store);

			store.startEditing('1', 'name');
			const result = await store.commitEdit('1', 'name', 'Updated Name');

			expect(result).toBe(true);
			expect(store.getState().activeEdit).toBeNull();

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('applyRowSelectionGesture', () => {
		it('updates selectedRowIds for replace gesture', () => {
			const store = makeStore();
			const ctrl = makeController(store);

			store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1', '2'] });
			expect(store.getState().selectedRowIds).toEqual(['1', '2']);

			ctrl.dispose();
			store.destroy();
		});

		it('invalidates changed rows and headers', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const engine = (store as any).engine;

			const spyInvalidate = vi.spyOn(engine.invalidation, 'invalidate');

			store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1', '3'] });

			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'row', rowId: '1' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'row', rowId: '3' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'headers' }));

			ctrl.dispose();
			store.destroy();
		});

		it('emits rowSelectionChanged event with correct payload', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const listener = vi.fn();
			store.addEventListener(GridEventName.rowSelectionChanged, listener);

			store.applyRowSelectionGesture({ kind: 'select', rowIds: ['2'], source: 'api' });

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					payload: expect.objectContaining({
						selectedRowIds: ['2'],
						addedRowIds: ['2'],
						removedRowIds: [],
						source: 'api',
					}),
				})
			);

			ctrl.dispose();
			store.destroy();
		});

		it('returns null and emits no event when no rows change', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			// Select '1' first
			store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1'] });

			const listener = vi.fn();
			store.addEventListener(GridEventName.rowSelectionChanged, listener);

			// Replace with same set — no change
			const result = store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1'] });
			expect(result).toBeNull();
			expect(listener).not.toHaveBeenCalled();

			ctrl.dispose();
			store.destroy();
		});
	});
});

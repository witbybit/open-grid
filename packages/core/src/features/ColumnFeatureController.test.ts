import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ColumnFeatureController } from './ColumnFeatureController.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

function makeStore(): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'price', header: 'Price', width: 100 },
		],
		getRowId: (row) => row.id,
	});
}

function makeController(store: GridStore<TestRow>): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store, {
		rows: [
			{ id: '1', name: 'Product A', price: 10 },
			{ id: '2', name: 'Product B', price: 20 },
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

describe('ColumnFeatureController', () => {
	describe('resizeColumn', () => {
		it('changes columnWidths in state', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new ColumnFeatureController(getFeatureContext(store));

			feature.resizeColumn('name', 999);
			expect(store.getState().columnWidths['name']).toBe(999);

			ctrl.dispose();
			store.destroy();
		});

		it('dispatches columnResized event', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new ColumnFeatureController(getFeatureContext(store));
			const listener = vi.fn();
			store.addEventListener(GridEventName.columnResized, listener);

			feature.resizeColumn('name', 200);

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
			const feature = new ColumnFeatureController(getFeatureContext(store));

			const spyInvalidate = vi.spyOn(engine.invalidation, 'invalidate');

			feature.resizeColumn('name', 200);

			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'geometry' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'headers' }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'column', colId: 'name' }));

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('moveColumn', () => {
		it('changes column order', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new ColumnFeatureController(getFeatureContext(store));

			const beforeFields = store.getDisplayedColumns().map((c) => c.field);
			feature.moveColumn('name', 0); // move 'name' to first displayed position

			const afterFields = store.getDisplayedColumns().map((c) => c.field);
			expect(afterFields).not.toEqual(beforeFields);
			expect(afterFields[0]).toBe('name');

			ctrl.dispose();
			store.destroy();
		});

		it('dispatches columnOrderChanged event', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new ColumnFeatureController(getFeatureContext(store));
			const listener = vi.fn();
			store.addEventListener(GridEventName.columnOrderChanged, listener);

			feature.moveColumn('price', 0);

			expect(listener).toHaveBeenCalledOnce();

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('setColumnReorderEnabled', () => {
		it('dispatches columnReorderToggled and invalidates headers', () => {
			const store = makeStore();
			const engine = (store as any).engine;
			const feature = new ColumnFeatureController(getFeatureContext(store));
			const listener = vi.fn();
			store.addEventListener(GridEventName.columnReorderToggled, listener);
			const spyInvalidate = vi.spyOn(engine.invalidation, 'invalidate');

			feature.setColumnReorderEnabled(false);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { enabled: false } }));
			expect(spyInvalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'headers' }));

			store.destroy();
		});
	});

	describe('getColumnState', () => {
		it('returns snapshot of column widths and visibility', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));

			// Set some widths
			store.setColumnWidth('id', 80);
			store.setColumnWidth('name', 200);

			const state = feature.getColumnState();
			expect(state).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ field: 'id', width: 80 }),
					expect.objectContaining({ field: 'name', width: 200 }),
					expect.objectContaining({ field: 'price' }),
				])
			);

			store.destroy();
		});
	});

	describe('applyColumnState', () => {
		it('applies width changes', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));

			feature.applyColumnState([{ field: 'name', width: 300 }]);

			expect(store.getState().columnWidths['name']).toBe(300);
			store.destroy();
		});

		it('applies visibility changes', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));

			feature.applyColumnState([{ field: 'price', hide: true }]);

			const col = store.getState().columns.find((c) => c.field === 'price');
			expect(col?.hide).toBe(true);
			store.destroy();
		});
	});
});

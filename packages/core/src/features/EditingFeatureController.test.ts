import { describe, it, expect, vi } from 'vitest';
import { EditingFeatureController } from './EditingFeatureController.js';
import type { EditingFeatureControllerDeps } from './EditingFeatureController.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

function makeStore(columnOverrides?: Parameters<typeof GridStore>[0]['columns']): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: columnOverrides ?? [
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

function makeEditingFeature(store: GridStore<TestRow>): EditingFeatureController<TestRow> {
	const engine = (store as any).engine;
	const deps: EditingFeatureControllerDeps<TestRow> = {
		ctx: getFeatureContext(store),
		getRowModel: () => engine.getRowModel(),
		data: engine.data,
		notifyCellChange: (rowId, colField) => engine.notifyCellChange(rowId, colField),
		setCellValue: (rowId, colField, value, undoable) => engine.setCellValue(rowId, colField, value, undoable),
	};
	return new EditingFeatureController(deps);
}

describe('EditingFeatureController', () => {
	it('startEdit sets activeEdit in state', () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);

		feature.startEdit('1', 'name');
		expect(store.getState().activeEdit).toEqual({ rowId: '1', colField: 'name' });

		ctrl.dispose();
		store.destroy();
	});

	it('stopEdit clears activeEdit and fires editStopped event', () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);
		const listener = vi.fn();
		store.addEventListener(GridEventName.editStopped, listener);

		feature.startEdit('1', 'name');
		feature.stopEdit(false);

		expect(store.getState().activeEdit).toBeNull();
		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ payload: expect.objectContaining({ rowId: '1', colField: 'name', cancel: false }) })
		);

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit with sync validator failure returns false', async () => {
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 50 },
			{
				field: 'name',
				header: 'Name',
				width: 150,
				valueValidator: async () => 'Too short',
			},
			{ field: 'price', header: 'Price', width: 100 },
		]);
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);

		feature.startEdit('1', 'name');
		const result = await feature.commitEdit('1', 'name', 'A');

		expect(result).toBe(false);
		expect(store.getState().activeEdit).not.toBeNull();

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit with async validator failure returns false', async () => {
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 50 },
			{
				field: 'name',
				header: 'Name',
				width: 150,
				valueValidator: async () => {
					await new Promise((resolve) => setTimeout(resolve, 0));
					return 'Async validation failed';
				},
			},
			{ field: 'price', header: 'Price', width: 100 },
		]);
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);

		feature.startEdit('1', 'name');
		const result = await feature.commitEdit('1', 'name', 'B');

		expect(result).toBe(false);

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit with valueSetter returning false returns false (rollback)', async () => {
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 50 },
			{
				field: 'name',
				header: 'Name',
				width: 150,
				valueSetter: async () => false,
			},
			{ field: 'price', header: 'Price', width: 100 },
		]);
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);

		feature.startEdit('1', 'name');
		const result = await feature.commitEdit('1', 'name', 'New Name');

		expect(result).toBe(false);

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit success returns true and closes editor', async () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);
		const stopSpy = vi.spyOn(feature, 'stopEdit');

		feature.startEdit('1', 'name');
		const result = await feature.commitEdit('1', 'name', 'Updated Name');

		expect(result).toBe(true);
		expect(stopSpy).toHaveBeenCalledWith(false);

		ctrl.dispose();
		store.destroy();
	});
});

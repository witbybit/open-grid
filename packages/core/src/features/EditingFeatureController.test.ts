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
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
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
		columns: engine.columns,
		getState: () => engine.stateManager.getState(),
		applyChange: (change) => engine.changeApplier.apply(change),
	};
}

function makeEditingFeature(store: GridStore<TestRow>): EditingFeatureController<TestRow> {
	const engine = (store as any).engine;
	const deps: EditingFeatureControllerDeps<TestRow> = {
		ctx: getFeatureContext(store),
		getRowModel: () => engine.getRowModel(),
		data: engine.data,
		notifyCellChange: (rowId, colField) => engine.notifyCellChange(rowId, colField),
	};
	return new EditingFeatureController(deps);
}

describe('EditingFeatureController', () => {
	it('startEdit sets activeEdit in state', () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);

		feature.startEdit('1', 'name');
		expect(store.getState().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				colId: 'name',
				columnInstanceId: expect.any(String),
				originalValue: 'Product A',
				draftValue: 'Product A',
				startedBy: 'api',
				version: 1,
			})
		);

		ctrl.dispose();
		store.destroy();
	});

	it('startEdit records the real source when provided', () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);

		feature.startEdit('1', 'name', 'keyboard');
		expect(store.getState().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				startedBy: 'keyboard',
			})
		);

		ctrl.dispose();
		store.destroy();
	});

	it('startEdit resolves duplicate-field columns by instance id when provided', () => {
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name A', width: 150, colId: 'name-a' },
			{ field: 'name', header: 'Name B', width: 150, colId: 'name-b' },
			{ field: 'price', header: 'Price', width: 100 },
		]);
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);
		const secondNameColumn = store.engine.columns.getDisplayedColumns()[2] as { field: string; colId?: string; instanceId?: string };

		feature.startEdit('1', secondNameColumn.instanceId!);

		expect(store.getState().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: secondNameColumn.instanceId,
			})
		);

		ctrl.dispose();
		store.destroy();
	});

	it('updateEditDraft stores the current draft in activeEdit state', () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);

		feature.startEdit('1', 'name');
		feature.updateEditDraft('1', 'name', 'Draft Name');

		expect(store.getState().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				originalValue: 'Product A',
				draftValue: 'Draft Name',
				startedBy: 'api',
				version: 1,
			})
		);

		ctrl.dispose();
		store.destroy();
	});

	it('updateEditDraft respects duplicate-field active editor instance identity', () => {
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name A', width: 150, colId: 'name-a' },
			{ field: 'name', header: 'Name B', width: 150, colId: 'name-b' },
			{ field: 'price', header: 'Price', width: 100 },
		]);
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);
		const firstNameColumn = store.engine.columns.getDisplayedColumns()[1] as { instanceId?: string };
		const secondNameColumn = store.engine.columns.getDisplayedColumns()[2] as { instanceId?: string };

		feature.startEdit('1', secondNameColumn.instanceId!);
		feature.updateEditDraft('1', firstNameColumn.instanceId!, 'Wrong Column Draft');
		expect(store.getState().activeEdit).toEqual(
			expect.objectContaining({
				columnInstanceId: secondNameColumn.instanceId,
				draftValue: 'Product A',
			})
		);

		feature.updateEditDraft('1', secondNameColumn.instanceId!, 'Right Column Draft');
		expect(store.getState().activeEdit).toEqual(
			expect.objectContaining({
				columnInstanceId: secondNameColumn.instanceId,
				draftValue: 'Right Column Draft',
			})
		);

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
		expect(store.canUndo()).toBe(false);

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit success returns true and closes editor', async () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);
		const engine = (store as any).engine;

		feature.startEdit('1', 'name');
		const result = await feature.commitEdit('1', 'name', 'Updated Name');

		expect(result).toBe(true);
		expect(store.getState().activeEdit).toBeNull();
		expect(store.canUndo()).toBe(true);

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit rejects a different duplicate-field column instance while another instance is active', async () => {
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name A', width: 150, colId: 'name-a' },
			{ field: 'name', header: 'Name B', width: 150, colId: 'name-b' },
			{ field: 'price', header: 'Price', width: 100 },
		]);
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);
		const firstNameColumn = store.engine.columns.getDisplayedColumns()[1] as { instanceId?: string };
		const secondNameColumn = store.engine.columns.getDisplayedColumns()[2] as { instanceId?: string };

		feature.startEdit('1', secondNameColumn.instanceId!);
		const result = await feature.commitEdit('1', firstNameColumn.instanceId!, 'Wrong Column Commit');

		expect(result).toBe(false);
		expect(store.getState().activeEdit).toEqual(
			expect.objectContaining({
				columnInstanceId: secondNameColumn.instanceId,
				draftValue: 'Product A',
			})
		);
		expect(store.getCellValue('1', 'name')).toBe('Product A');

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit invokes async valueSetter exactly once and commits through history once', async () => {
		const valueSetter = vi.fn(async ({ row }) => {
			row.name = 'Server Accepted';
			return true;
		});
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 50 },
			{
				field: 'name',
				header: 'Name',
				width: 150,
				valueSetter,
			},
			{ field: 'price', header: 'Price', width: 100 },
		]);
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);
		const engine = (store as any).engine;

		feature.startEdit('1', 'name');
		const result = await feature.commitEdit('1', 'name', 'Updated Name');

		expect(result).toBe(true);
		expect(valueSetter).toHaveBeenCalledTimes(1);
		expect(engine.getRawCellValue('1', 'name')).toBe('Server Accepted');
		expect(store.canUndo()).toBe(true);

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit returns false and does not call valueSetter when the row is no longer available', async () => {
		const valueSetter = vi.fn(async () => true);
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 50 },
			{
				field: 'name',
				header: 'Name',
				width: 150,
				valueSetter,
			},
			{ field: 'price', header: 'Price', width: 100 },
		]);
		const ctrl = makeController(store);
		const feature = makeEditingFeature(store);

		store.setRows([{ id: '2', name: 'Product B', price: 20 }]);

		const result = await feature.commitEdit('1', 'name', 'Missing');

		expect(result).toBe(false);
		expect(valueSetter).not.toHaveBeenCalled();
		expect(store.canUndo()).toBe(false);

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit respects validateOnEdit: false and does not auto-publish validation errors', async () => {
		const store = new GridStore<TestRow>(
			{
				columns: [
					{ field: 'id', header: 'ID', width: 50 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: {
						validateOnEdit: false,
						cellRules: [
							{ id: 'required-name', field: 'name', validate: ({ value }) => (value ? null : { message: 'Name is required' }) },
						],
					},
				},
			}
		);
		const ctrl = makeController(store);

		await store.commitEdit('1', 'name', '');
		await new Promise((res) => setTimeout(res, 0));

		expect(store.engine.dataIntegrity?.getCellErrorMessage('1', 'name')).toBeNull();

		ctrl.dispose();
		store.destroy();
	});

	it('commitEdit rejects blocking proposal validation when validateOnSubmit is enabled', async () => {
		const store = new GridStore<TestRow>(
			{
				columns: [
					{ field: 'id', header: 'ID', width: 50 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: {
						validateOnSubmit: true,
						cellRules: [
							{ id: 'required-name', field: 'name', validate: ({ value }) => (value ? null : { message: 'Name is required' }) },
						],
					},
				},
			}
		);
		const ctrl = makeController(store);
		const blockedHandler = vi.fn();
		store.addEventListener(GridEventName.writeBlocked, blockedHandler);

		store.startEditing('1', 'name');
		const result = await store.commitEdit('1', 'name', '');

		expect(result).toBe(false);
		expect(blockedHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					source: 'edit',
					status: 'validationFailed',
					rowCount: 1,
					colCount: 1,
				}),
			})
		);
		expect(store.getState().activeEdit).toEqual(
			expect.objectContaining({ rowId: '1', colField: 'name', colId: 'name', columnInstanceId: expect.any(String) })
		);
		expect(store.getCellValue('1', 'name')).toBe('Product A');
		expect(store.canUndo()).toBe(false);

		ctrl.dispose();
		store.destroy();
	});
});

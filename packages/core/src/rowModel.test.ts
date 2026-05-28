import { describe, it, expect } from 'vitest';
import { GridStore } from './store.js';
import { ClientRowModelController } from './rowModel.js';

interface TestRow {
	id: string;
	name: string;
	user?: {
		name: string;
	};
}

describe('ClientRowModelController', () => {
	it('should initialize and populate visualRows correctly', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const rows = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
		];

		const controller = new ClientRowModelController(store, {
			rows,
			columns: store.getState().columns,
		});

		expect(controller.getRowCount()).toBe(2);
		expect(controller.getVisualRowCount()).toBe(2);
		expect(controller.getRowIndexById('1')).toBe(0);
		expect(controller.getVisualRowIndexById('1')).toBe(0);
		expect(controller.getRowIndexById('2')).toBe(1);

		const visualRow1 = controller.getVisualRow(0);
		expect(visualRow1?.kind).toBe('data');
		expect(visualRow1?.id).toBe('1');

		const node1 = controller.getRowNode(0);
		expect(node1?.data.name).toBe('Alice');
	});

	it('should support updating cell values directly', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const rows = [{ id: '1', name: 'Alice' }];
		const controller = new ClientRowModelController(store, {
			rows,
			columns: store.getState().columns,
		});

		controller.setCellValue('1', 'name', 'Alicia');
		const node = controller.getRowNodeById('1');
		expect(node?.data.name).toBe('Alicia');
	});

	it('should refresh sorting when a nested column path changes through its parent object', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'user.name', header: 'User' }],
			sortModel: [{ colId: 'user.name', sort: 'asc' }],
		});

		const controller = new ClientRowModelController(store, {
			rows: [
				{ id: '1', name: 'One', user: { name: 'Alice' } },
				{ id: '2', name: 'Two', user: { name: 'Bob' } },
			],
			columns: store.getState().columns,
		});

		controller.updateRows((rows) => rows.map((row) => (row.id === '2' ? { ...row, user: { name: 'Aaron' } } : row)));

		expect(controller.getRowNode(0)?.id).toBe('2');
	});
});

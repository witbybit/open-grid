import { describe, it, expect, vi } from 'vitest';
import { GridStore } from './store.js';
import { ServerRowModelController, IGridDatasource } from './serverRowModel.js';

interface TestRow {
	id: string;
	name: string;
}

describe('ServerRowModelController', () => {
	it('should initialize and fetch initial block', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: IGridDatasource = {
			getRows: vi.fn().mockResolvedValue({
				rows: [
					{ id: '1', name: 'Alice' },
					{ id: '2', name: 'Bob' },
				],
				totalCount: 100,
			}),
		};

		const controller = new ServerRowModelController(store, {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		// wait for promise
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getRowCount()).toBe(100);
		expect(controller.getRowIndexById('1')).toBe(0);
		expect(controller.getRowIndexById('2')).toBe(1);

		const node1 = controller.getRowNode(0);
		expect(node1?.data.name).toBe('Alice');
	});
});

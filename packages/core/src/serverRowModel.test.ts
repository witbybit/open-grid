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
		expect(controller.getVisualRowCount()).toBe(100);
		expect(controller.getRowIndexById('1')).toBe(0);
		expect(controller.getVisualRowIndexById('1')).toBe(0);
		expect(controller.getRowIndexById('2')).toBe(1);

		const visualRow1 = controller.getVisualRow(0);
		expect(visualRow1?.kind).toBe('data');
		expect(visualRow1?.id).toBe('1');

		const node1 = controller.getRowNode(0);
		expect(node1?.data.name).toBe('Alice');
	});

	it('should return synthetic loading nodes for unloaded indices within row count', async () => {
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

		await new Promise((resolve) => setTimeout(resolve, 0));

		// index 80 is not loaded yet (since blockSize is 50, only block 0 has loaded)
		const node = controller.getRowNode(80);
		expect(node).not.toBeNull();
		expect(node?.id).toBe('__loading_80');
		expect(store.isRowLoading(node!.id)).toBe(true);
		expect(controller.getVisualRow(80)?.id).toBe('__loading_80');
	});

	it('should pre-fetch blocks ahead of time based on scroll velocity', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: IGridDatasource = {
			getRows: vi.fn().mockImplementation((params) => {
				return Promise.resolve({
					rows: Array.from({ length: params.endRow - params.startRow }, (_, i) => ({
						id: String(params.startRow + i),
						name: `Row ${params.startRow + i}`,
					})),
					totalCount: 1000,
				});
			}),
		};

		const controller = new ServerRowModelController(store, {
			datasource: mockDatasource,
			blockSize: 100,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		// Set scrolling velocity downwards (moderate velocity, vy = 1.0 px/ms)
		store.engine.viewport.setScrollPosition(100, 0, performance.now() - 100);
		store.engine.viewport.setScrollPosition(200, 0, performance.now()); // vy = 1.0 px/ms

		// Clear mock history before loadVisibleBlocks so we only track calls made by loadVisibleBlocks
		vi.mocked(mockDatasource.getRows).mockClear();

		// Call loadVisibleBlocks with a visible range in block 0
		controller.loadVisibleBlocks(20, 40);

		// Waiting for the async predictive fetch
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Since we are scrolling down, block 1 (indices 100-199) and block 2 (indices 200-299) should be fetched ahead of time
		expect(mockDatasource.getRows).toHaveBeenCalledWith(expect.objectContaining({ startRow: 100, endRow: 200 }));
		expect(mockDatasource.getRows).toHaveBeenCalledWith(expect.objectContaining({ startRow: 200, endRow: 300 }));
	});

	it('should suppress pre-fetching blocks during extremely high scroll velocity', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: IGridDatasource = {
			getRows: vi.fn().mockImplementation((params) => {
				return Promise.resolve({
					rows: Array.from({ length: params.endRow - params.startRow }, (_, i) => ({
						id: String(params.startRow + i),
						name: `Row ${params.startRow + i}`,
					})),
					totalCount: 1000,
				});
			}),
		};

		const controller = new ServerRowModelController(store, {
			datasource: mockDatasource,
			blockSize: 100,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		// Set scrolling velocity downwards extremely fast (vy = 8.0 px/ms)
		store.engine.viewport.setScrollPosition(100, 0, performance.now() - 50);
		store.engine.viewport.setScrollPosition(500, 0, performance.now());

		// Clear mock history before loadVisibleBlocks so we only track calls made by loadVisibleBlocks
		vi.mocked(mockDatasource.getRows).mockClear();

		// Call loadVisibleBlocks with a visible range
		controller.loadVisibleBlocks(20, 40);

		// Waiting for any potential async predictive fetch
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Since velocity is extremely high (> 1.5 px/ms), fetches should be suppressed to prevent network storm
		expect(mockDatasource.getRows).not.toHaveBeenCalled();
	});

	it('should transition loading state from true to false and respect loadingSkeletonCount', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			loadingSkeletonCount: 8,
		});

		const mockDatasource: IGridDatasource = {
			getRows: vi.fn().mockImplementation(() => {
				return new Promise((resolve) => {
					setTimeout(() => {
						resolve({
							rows: [
								{ id: '1', name: 'Alice' },
								{ id: '2', name: 'Bob' },
							],
							totalCount: 100,
						});
					}, 20);
				});
			}),
		};

		const controller = new ServerRowModelController(store, {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		// Verify store enters loading state immediately
		expect(store.getState().loading).toBe(true);
		expect(store.getState().loadingSkeletonCount).toBe(8);

		// Wait for the async server response
		await new Promise((resolve) => setTimeout(resolve, 30));

		// Verify loading state is now false and rows are loaded
		expect(store.getState().loading).toBe(false);
		expect(controller.getRowCount()).toBe(100);
	});

	it('should not synchronously set state and increment dataVersion when fetching subsequent blocks (blockIndex > 0)', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: IGridDatasource = {
			getRows: vi.fn().mockImplementation((params) => {
				return Promise.resolve({
					rows: Array.from({ length: params.endRow - params.startRow }, (_, i) => ({
						id: String(params.startRow + i),
						name: `Row ${params.startRow + i}`,
					})),
					totalCount: 1000,
				});
			}),
		};

		const controller = new ServerRowModelController(store, {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		// Reset dataVersion/loading change listeners
		const stateBefore = store.getState();
		const initialDataVersion = stateBefore.dataVersion;

		const stateSpy = vi.spyOn(store, 'setState');

		// Trigger fetch block 1 (subsequent block)
		controller.loadVisibleBlocks(60, 60);

		// The setState should not have been called synchronously during the fetch start for block index 1
		// Since setState wasn't called synchronously, dataVersion should still be the same
		expect(stateSpy).not.toHaveBeenCalled();
		expect(store.getState().dataVersion).toBe(initialDataVersion);

		// Now wait for the async fetch to complete
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Now the async response should have arrived, triggering setState with dataVersion increment
		expect(stateSpy).toHaveBeenCalled();
		expect(store.getState().dataVersion).toBe(initialDataVersion + 1);
	});

	it('should ignore an in-flight response after dispose', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let resolveRows!: (value: { rows: TestRow[]; totalCount: number }) => void;
		const mockDatasource: IGridDatasource = {
			getRows: vi.fn().mockImplementation(() => {
				return new Promise((resolve) => {
					resolveRows = resolve as typeof resolveRows;
				});
			}),
		};

		const controller = new ServerRowModelController<TestRow>(store, {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		controller.dispose();
		resolveRows({ rows: [{ id: '1', name: 'Late Alice' }], totalCount: 1 });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getRowCount()).toBe(0);
		expect(controller.getRowIndexById('1')).toBe(-1);
	});

	it('should switch datasource and block size when server options change', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const firstDatasource: IGridDatasource = {
			getRows: vi.fn().mockResolvedValue({
				rows: [{ id: '1', name: 'Alice' }],
				totalCount: 1,
			}),
		};
		const secondDatasource: IGridDatasource = {
			getRows: vi.fn().mockResolvedValue({
				rows: [{ id: '2', name: 'Bob' }],
				totalCount: 1,
			}),
		};

		const controller = new ServerRowModelController(store, {
			datasource: firstDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getRowNode(0)?.data.name).toBe('Alice');

		controller.setDatasource(secondDatasource, 25);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(secondDatasource.getRows).toHaveBeenCalledWith(expect.objectContaining({ startRow: 0, endRow: 25 }));
		expect(controller.getRowIndexById('1')).toBe(-1);
		expect(controller.getRowNode(0)?.data.name).toBe('Bob');
	});
});

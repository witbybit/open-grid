import { describe, it, expect, vi } from 'vitest';
import { GridEventName, GridStore } from './store.js';
import { ServerRowModelController, IGridDatasource } from './serverRowModel.js';

interface TestRow {
	id: string;
	name: string;
}

function getRowNode<TData>(controller: ServerRowModelController<TData>, index: number) {
	const vr = controller.getVisualRow(index);
	return vr?.kind === 'data' ? vr.node : null;
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

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		// wait for promise
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(100);
		expect(controller.getVisualRowIndexById('row:1')).toBe(0);
		expect(controller.getVisualRowIndexById('row:2')).toBe(1);
		expect(controller.getVisualIndexByRowId('1')).toBe(0);

		const visualRow1 = controller.getVisualRow(0);
		expect(visualRow1?.kind).toBe('data');
		expect(visualRow1?.id).toBe('row:1');

		const node1 = getRowNode(controller, 0);
		expect(node1?.data.name).toBe('Alice');
	});

	it('should return loading visual row for unloaded indices within row count', async () => {
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

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		// index 80 is not loaded yet (since blockSize is 50, only block 0 has loaded)
		const visualRow = controller.getVisualRow(80);
		expect(visualRow).not.toBeNull();
		expect(visualRow?.kind).toBe('loading');
		expect(visualRow?.id).toBe('loading:80');
		expect(visualRow?.kind === 'loading' ? visualRow.rowIndex : undefined).toBe(80);
		expect('node' in visualRow!).toBe(false);
		expect(store.getRowNodeById(visualRow!.id)).toBeNull();
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

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
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

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
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

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
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
		expect(controller.getVisualRowCount()).toBe(100);
	});

	it('should not synchronously set state and increment globalVersion when fetching subsequent blocks (blockIndex > 0)', async () => {
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

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		// Reset globalVersion/loading change listeners
		const stateBefore = store.getState();
		const initialGlobalVersion = stateBefore.globalVersion;

		const stateSpy = vi.spyOn(store, 'setState');

		// Trigger fetch block 1 (subsequent block)
		controller.loadVisibleBlocks(60, 60);

		// The setState should not have been called synchronously during the fetch start for block index 1
		// Since setState wasn't called synchronously, globalVersion should still be the same
		expect(stateSpy).not.toHaveBeenCalled();
		expect(store.getState().globalVersion).toBe(initialGlobalVersion);

		// Now wait for the async fetch to complete
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Now the async response should have arrived, triggering setState with globalVersion increment
		expect(stateSpy).toHaveBeenCalled();
		expect(store.getState().globalVersion).toBe(initialGlobalVersion + 1);
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

		const controller = new ServerRowModelController<TestRow>(store.getServerRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		controller.dispose();
		resolveRows({ rows: [{ id: '1', name: 'Late Alice' }], totalCount: 1 });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(0);
		expect(controller.getVisualRowIndexById('1')).toBe(-1);
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

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: firstDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice');

		controller.setDatasource(secondDatasource, 25);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(secondDatasource.getRows).toHaveBeenCalledWith(expect.objectContaining({ startRow: 0, endRow: 25 }));
		expect(controller.getVisualRowIndexById('1')).toBe(-1);
		expect(getRowNode(controller, 0)?.data.name).toBe('Bob');
	});

	it('captures datasource fetch failures as runtime faults', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const runtimeFault = vi.fn();
		const blockLoadFailed = vi.fn();
		store.addEventListener(GridEventName.runtimeFault, runtimeFault);
		store.addEventListener(GridEventName.serverBlockLoadFailed, blockLoadFailed);

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: {
				getRows: vi.fn().mockRejectedValue(new Error('network down')),
			},
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(runtimeFault).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					source: 'server-row-model',
					operation: 'fetch-block',
					message: 'network down',
					context: { blockIndex: 0 },
				}),
			})
		);
		expect(store.getRuntimeFaults()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: 'server-row-model',
					operation: 'fetch-block',
				}),
			])
		);
		expect(blockLoadFailed).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					blockIndex: 0,
					startRow: 0,
					endRow: 49,
					message: 'network down',
				}),
			})
		);
		expect(store.getState().loading).toBe(false);

		controller.dispose();
		store.destroy();
	});
});

describe('ServerRowModelController – pagination mode', () => {
	function makeStore() {
		return new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
	}

	function makeRows(start: number, count: number): TestRow[] {
		return Array.from({ length: count }, (_, i) => ({ id: String(start + i), name: `Row ${start + i}` }));
	}

	it('fetches block 0 with pageNumber and pageSize in GetRowsParams', async () => {
		const store = makeStore();
		const getRows = vi.fn().mockResolvedValue({ rows: makeRows(0, 50), totalCount: 1000 });
		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 50,
			columns: store.getState().columns,
			pagination: { pageSize: 200, initialPage: 0 },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows).toHaveBeenCalledWith(expect.objectContaining({ startRow: 0, endRow: 50, pageNumber: 0, pageSize: 200 }));

		controller.dispose();
		store.destroy();
	});

	it('totalCount drives pageCount and dispatches paginationChanged', async () => {
		const store = makeStore();
		const paginationChanged = vi.fn();
		store.addEventListener(GridEventName.paginationChanged, paginationChanged);

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: makeRows(0, 50), totalCount: 1000 }) },
			blockSize: 50,
			columns: store.getState().columns,
			pagination: { pageSize: 200 },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(paginationChanged).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: { page: 0, pageCount: 5, totalRows: 1000, pageSize: 200 },
			})
		);
		expect(store.getState().serverPagination).toEqual({ page: 0, pageCount: 5, totalRows: 1000, pageSize: 200 });
		// Visual row count is the current page window, not the global total
		expect(controller.getVisualRowCount()).toBe(200);

		controller.dispose();
		store.destroy();
	});

	it('goToPage navigates to the target page and purges cache', async () => {
		const store = makeStore();
		const getRows = vi.fn().mockResolvedValue({ rows: makeRows(0, 50), totalCount: 1000 });
		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 50,
			columns: store.getState().columns,
			pagination: { pageSize: 200 },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		getRows.mockClear();

		controller.goToPage(2);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Block 0 of page 2: absoluteStartRow = 2 * 200 = 400
		expect(getRows).toHaveBeenCalledWith(expect.objectContaining({ startRow: 400, endRow: 450, pageNumber: 2, pageSize: 200 }));
		expect(store.getState().serverPagination?.page).toBe(2);

		controller.dispose();
		store.destroy();
	});

	it('last page is sized correctly when totalCount is not a multiple of pageSize', async () => {
		const store = makeStore();
		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: makeRows(0, 50), totalCount: 950 }) },
			blockSize: 50,
			columns: store.getState().columns,
			pagination: { pageSize: 200 },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		// Pages: 0..199, 200..399, 400..599, 600..799, 800..949 → pageCount=5
		expect(store.getState().serverPagination?.pageCount).toBe(5);

		// Navigate to last page (4): rows 800..949 = 150 rows
		controller.goToPage(4);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(150);

		controller.dispose();
		store.destroy();
	});

	it('goToPage is a no-op in infinite scroll mode', async () => {
		const store = makeStore();
		const getRows = vi.fn().mockResolvedValue({ rows: makeRows(0, 50), totalCount: 500 });
		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 50,
			columns: store.getState().columns,
			// No pagination option — infinite scroll mode
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		getRows.mockClear();

		controller.goToPage(2);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Should not have triggered a new fetch
		expect(getRows).not.toHaveBeenCalled();
		expect(store.getState().serverPagination).toBeUndefined();

		controller.dispose();
		store.destroy();
	});

	it('setDatasource in page mode purges exactly once without a second cascade fetch', async () => {
		const store = makeStore();
		const getRows1 = vi.fn().mockResolvedValue({ rows: makeRows(0, 50), totalCount: 1000 });
		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: { getRows: getRows1 },
			blockSize: 50,
			columns: store.getState().columns,
			pagination: { pageSize: 200 },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		const getRows2 = vi.fn().mockResolvedValue({ rows: makeRows(0, 50), totalCount: 800 });
		controller.setDatasource({ getRows: getRows2 });
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Exactly one call on the new datasource (block 0 of page 0)
		expect(getRows2).toHaveBeenCalledTimes(1);
		expect(getRows2).toHaveBeenCalledWith(expect.objectContaining({ startRow: 0, endRow: 50, pageNumber: 0, pageSize: 200 }));

		controller.dispose();
		store.destroy();
	});
});

import { describe, it, expect, vi } from 'vitest';
import { GridEventName, GridStore } from './store.js';
import { InfiniteRowModelController, type InfiniteDatasource } from './infiniteRowModel.js';

interface TestRow {
	id: string;
	name: string;
}

function getRowNode<TData>(controller: InfiniteRowModelController<TData>, index: number) {
	const vr = controller.getVisualRow(index);
	return vr?.kind === 'data' ? vr.node : null;
}

describe('InfiniteRowModelController', () => {
	it('should initialize and fetch initial block', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockResolvedValue({
				rows: [
					{ id: '1', name: 'Alice' },
					{ id: '2', name: 'Bob' },
				],
				totalCount: 100,
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		// wait for promise
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(100);
		expect(controller.getVisualIndexById('row:1')).toBe(0);
		expect(controller.getVisualIndexById('row:2')).toBe(1);
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

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockResolvedValue({
				rows: [
					{ id: '1', name: 'Alice' },
					{ id: '2', name: 'Bob' },
				],
				totalCount: 100,
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
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

	it('implements the viewport/load-state contract for infinite blocks', async () => {
		let rejectBlock!: (error: unknown) => void;
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					return Promise.resolve({
						rows: [
							{ id: '1', name: 'Alice' },
							{ id: '2', name: 'Bob' },
						],
						totalCount: 100,
					});
				}
				return new Promise((_, reject) => {
					rejectBlock = reject;
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getKnownRowCount()).toBe(100);
		expect(controller.getEstimatedRowCount()).toBe(100);
		expect(controller.getRowCountKind()).toBe('known');
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getRowLoadState(80)).toEqual({ kind: 'loading', reason: 'infinite-block' });
		expect(controller.isRangeLoaded(0, 1)).toBe(true);
		expect(controller.isRangeLoaded(0, 80)).toBe(false);

		controller.ensureRange(50, 50, 'test');
		expect(controller.isRowLoading(50)).toBe(true);

		rejectBlock!(new Error('block failed'));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getRowLoadState(50)).toEqual({ kind: 'failed', error: 'block failed', retryable: true });
		expect(controller.isRowFailed(50)).toBe(true);
		expect(controller.getRangeLoadState(49, 51)).toEqual({
			loaded: 0,
			loading: 1,
			failed: 2,
			placeholder: 0,
			missing: 0,
		});
	});

	it('should pre-fetch blocks ahead of time based on scroll velocity', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
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

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
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

		const mockDatasource: InfiniteDatasource<TestRow> = {
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

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
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

		const mockDatasource: InfiniteDatasource<TestRow> = {
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

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
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

		const mockDatasource: InfiniteDatasource<TestRow> = {
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

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		// Reset globalVersion/loading change listeners
		const stateBefore = store.getState();
		const initialGlobalVersion = stateBefore.globalVersion;

		const stateSpy = vi.spyOn(store.engine.stateManager, 'commitState');

		// Trigger fetch block 1 (subsequent block)
		controller.loadVisibleBlocks(60, 60);

		// The runtime should not synchronously mutate state during the fetch start for block index 1.
		// Since no direct state write happened yet, globalVersion should still be the same.
		expect(stateSpy).not.toHaveBeenCalled();
		expect(store.getState().globalVersion).toBe(initialGlobalVersion);

		// Now wait for the async fetch to complete
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Now the async response should have arrived, triggering the centralized state write with globalVersion increment.
		expect(stateSpy).toHaveBeenCalled();
		expect(store.getState().globalVersion).toBe(initialGlobalVersion + 1);
	});

	it('should ignore an in-flight response after dispose', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let resolveRows!: (value: { rows: TestRow[]; totalCount: number }) => void;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				return new Promise((resolve) => {
					resolveRows = resolve as typeof resolveRows;
				});
			}),
		};

		const controller = new InfiniteRowModelController<TestRow>(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		controller.dispose();
		resolveRows({ rows: [{ id: '1', name: 'Late Alice' }], totalCount: 1 });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(0);
		expect(controller.getVisualIndexById('1')).toBe(-1);
	});

	it('should switch datasource and block size when server options change', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const firstDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockResolvedValue({
				rows: [{ id: '1', name: 'Alice' }],
				totalCount: 1,
			}),
		};
		const secondDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockResolvedValue({
				rows: [{ id: '2', name: 'Bob' }],
				totalCount: 1,
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: firstDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice');

		controller.setDatasource(secondDatasource, 25);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(secondDatasource.getRows).toHaveBeenCalledWith(expect.objectContaining({ startRow: 0, endRow: 25 }));
		expect(controller.getVisualIndexById('1')).toBe(-1);
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
		store.addEventListener(GridEventName.infiniteBlockLoadFailed, blockLoadFailed);

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
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
					source: 'infinite-row-model',
					operation: 'fetch-block',
					message: 'network down',
					context: { blockIndex: 0 },
				}),
			})
		);
		expect(store.getRuntimeFaults()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: 'infinite-row-model',
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

import { describe, it, expect, vi } from 'vitest';
import { GridEventName, GridStore } from './store.js';
import { InfiniteRowModelController, type InfiniteDatasource } from './infiniteRowModel.js';
import { ServerPageRowModelController } from './serverPageRowModel.js';
import type { GridQueryModel } from './query/GridQueryModel.js';

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
				rows: Array.from({ length: 50 }, (_, index) => ({
					id: String(index + 1),
					name: index === 0 ? 'Alice' : index === 1 ? 'Bob' : `Row ${index + 1}`,
				})),
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
				rows: Array.from({ length: 50 }, (_, index) => ({
					id: String(index + 1),
					name: index === 0 ? 'Alice' : index === 1 ? 'Bob' : `Row ${index + 1}`,
				})),
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
						rows: Array.from({ length: 50 }, (_, index) => ({
							id: String(index + 1),
							name: index === 0 ? 'Alice' : index === 1 ? 'Bob' : `Row ${index + 1}`,
						})),
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

		expect(controller.getVisualRow(50)).toEqual(
			expect.objectContaining({ kind: 'failed', id: 'failed:50', rowIndex: 50, error: 'block failed' })
		);
		expect(controller.getRowLoadState(50)).toEqual({ kind: 'failed', error: 'block failed', retryable: true });
		expect(controller.isRowFailed(50)).toBe(true);
		expect(controller.getRangeLoadState(49, 51)).toEqual({
			loaded: 1,
			loading: 0,
			failed: 2,
			placeholder: 0,
			missing: 0,
		});
	});

	it('exposes deliberate loading rows for queued infinite work before request execution starts', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let callCount = 0;
		let resolveBlockZero!: (value: { rows: TestRow[]; totalCount: number }) => void;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					callCount++;
					if (callCount === 1) {
						return Promise.resolve({
							rows: Array.from({ length: 10 }, (_, index) => ({
								id: `row-${index}`,
								name: `Row ${index}`,
							})),
							totalCount: 20,
						});
					}
					return new Promise((resolve) => {
						resolveBlockZero = resolve as typeof resolveBlockZero;
					});
				}
				return Promise.resolve({
					rows: Array.from({ length: 10 }, (_, index) => ({
						id: `row-${10 + index}`,
						name: `Row ${10 + index}`,
					})),
					totalCount: 20,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 10,
			maxConcurrentRequests: 1,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.ensureRange(0, 0, 'force-reload');
		controller.loadVisibleBlocks(10, 19);
		expect(controller.getBlockSnapshots()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockIndex: 0,
					state: 'refreshing',
					committedRowCount: 10,
				}),
				expect.objectContaining({
					blockIndex: 1,
					state: 'queued',
					committedRowCount: 0,
				}),
			])
		);
		expect(controller.getRowLoadState(10)).toEqual({ kind: 'loading', reason: 'infinite-block' });
		expect(controller.getVisualRow(10)?.kind).toBe('loading');

		resolveBlockZero({
			rows: Array.from({ length: 10 }, (_, index) => ({
				id: `row-${index}`,
				name: `Row ${index}`,
			})),
			totalCount: 20,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(10)?.kind).toBe('data');
		expect(getRowNode(controller, 10)?.data.name).toBe('Row 10');

		controller.dispose();
		store.destroy();
	});

	it('publishes a core refresh invalidation when a non-zero infinite block resolves', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let resolveSecondBlock!: (value: { rows: TestRow[]; totalCount: number }) => void;
		const applyRefreshInvalidation = vi.spyOn(store.engine, 'applyRowModelRefreshInvalidation');
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					return Promise.resolve({
						rows: Array.from({ length: 50 }, (_, index) => ({
							id: `row-${index}`,
							name: `Row ${index}`,
						})),
						totalCount: 100,
					});
				}
				return new Promise((resolve) => {
					resolveSecondBlock = resolve as typeof resolveSecondBlock;
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		applyRefreshInvalidation.mockClear();

		controller.ensureRange(50, 50, 'test');
		expect(controller.getVisualRow(50)?.kind).toBe('loading');

		resolveSecondBlock({
			rows: Array.from({ length: 50 }, (_, index) => ({
				id: `row-${50 + index}`,
				name: `Row ${50 + index}`,
			})),
			totalCount: 100,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(50)?.kind).toBe('data');
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 100,
				nextRowCount: 100,
				changedStartIndex: 50,
				changedEndIndex: 99,
			}),
			expect.objectContaining({
				invalidationReason: 'viewport',
				requestRenderReason: 'rows:infinite-block-loaded',
			})
		);

		controller.dispose();
		store.destroy();
	});

	it('ignores an older request for the same block when a newer retry request wins by requestId', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let resolveFirst!: (value: { rows: TestRow[]; totalCount: number }) => void;
		let resolveSecond!: (value: { rows: TestRow[]; totalCount: number }) => void;
		let callCount = 0;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				callCount++;
				return new Promise((resolve) => {
					if (callCount === 1) resolveFirst = resolve as typeof resolveFirst;
					else resolveSecond = resolve as typeof resolveSecond;
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 4,
			columns: store.getState().columns,
		});

		controller.ensureRange(0, 0, 'retry');

		resolveSecond({
			rows: Array.from({ length: 4 }, (_, index) => ({
				id: String(index + 2),
				name: index === 0 ? 'New Block Winner' : `Fresh Row ${index + 2}`,
			})),
			totalCount: 4,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		resolveFirst({
			rows: Array.from({ length: 4 }, (_, index) => ({
				id: String(index + 1),
				name: index === 0 ? 'Stale Block Loser' : `Stale Row ${index + 1}`,
			})),
			totalCount: 4,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('New Block Winner');
		expect(store.getRawRowById('1')).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('retries a failed initial infinite block load and replaces failed placeholders with committed rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let callCount = 0;
		let rejectInitial!: (error: unknown) => void;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					return Promise.resolve({
						rows: Array.from({ length: 10 }, (_, index) => ({
							id: `row-${index}`,
							name: `Row ${index}`,
						})),
						totalCount: 20,
					});
				}
				callCount++;
				if (callCount === 1) {
					return new Promise((_, reject) => {
						rejectInitial = reject;
					});
				}
				return Promise.resolve({
					rows: Array.from({ length: 10 }, (_, index) => ({
						id: `row-${10 + index}`,
						name: `Recovered ${10 + index}`,
					})),
					totalCount: 20,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.ensureRange(10, 10, 'test');
		rejectInitial!(new Error('block 1 failed'));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getBlockSnapshots()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockIndex: 1,
					state: 'failedInitial',
					committedRowCount: 0,
					error: 'block 1 failed',
				}),
			])
		);
		expect(controller.getRowLoadState(10)).toEqual({
			kind: 'failed',
			error: 'block 1 failed',
			retryable: true,
		});
		expect(controller.getVisualRow(10)?.kind).toBe('failed');

		controller.ensureRange(10, 10, 'retry');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getBlockSnapshots()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					blockIndex: 1,
					state: 'loaded',
					committedRowCount: 10,
				}),
			])
		);
		expect(controller.getRowLoadState(10)).toEqual({ kind: 'loaded', rowId: 'row-10' });
		expect(controller.getVisualRow(10)?.kind).toBe('data');
		expect(getRowNode(controller, 10)?.data.name).toBe('Recovered 10');

		controller.dispose();
		store.destroy();
	});

	it('rejects a short non-terminal infinite block response instead of committing blank gaps', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let impossibleShortBlockObserved = false;
		let callCount = 0;
		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('but totalCount 4 still requires rows within that block')) {
				impossibleShortBlockObserved = true;
			}
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: {
				getRows: vi.fn().mockImplementation(() => {
					callCount++;
					if (callCount === 1) {
						return Promise.resolve({
							rows: [
								{ id: '1', name: 'Alice v1' },
								{ id: '2', name: 'Bob v1' },
								{ id: '3', name: 'Carol v1' },
								{ id: '4', name: 'Dylan v1' },
							],
							totalCount: 4,
						});
					}
					return Promise.resolve({
						rows: [
							{ id: '1', name: 'Alice v2' },
							{ id: '2', name: 'Bob v2' },
						],
						totalCount: 4,
					});
				}),
			},
			blockSize: 4,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(0)?.kind).toBe('data');

		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(4);
		expect(impossibleShortBlockObserved).toBe(true);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.isRangeLoaded(0, 3)).toBe(true);
		expect(controller.getRangeLoadState(0, 3)).toEqual({
			loaded: 4,
			loading: 0,
			failed: 0,
			placeholder: 0,
			missing: 0,
		});
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');
		expect(getRowNode(controller, 2)?.data.name).toBe('Carol v1');

		controller.dispose();
		store.destroy();
	});

	it('keeps infinite scrolling reachable beyond block zero when totalCount is unknown and a block is full', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) =>
				Promise.resolve({
					rows: Array.from({ length: params.endRow - params.startRow }, (_, index) => ({
						id: `row-${params.startRow + index}`,
						name: `Row ${params.startRow + index}`,
					})),
				})
			),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getKnownRowCount()).toBeNull();
		expect(controller.getRowCountKind()).toBe('estimated');
		expect(controller.getVisualRowCount()).toBe(100);
		expect(controller.getRowLoadState(50)).toEqual({ kind: 'loading', reason: 'infinite-block' });

		vi.mocked(mockDatasource.getRows).mockClear();
		controller.ensureRange(50, 50, 'test');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mockDatasource.getRows).toHaveBeenCalledWith(
			expect.objectContaining({
				startRow: 50,
				endRow: 100,
			}),
			expect.objectContaining({ signal: expect.any(Object) })
		);
		expect(controller.getVisualRow(50)?.kind).toBe('data');
		expect(getRowNode(controller, 50)?.data.name).toBe('Row 50');

		controller.dispose();
		store.destroy();
	});

	it('treats a short infinite block without totalCount as the terminal known row count', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					return Promise.resolve({
						rows: Array.from({ length: 50 }, (_, index) => ({
							id: `row-${index}`,
							name: `Row ${index}`,
						})),
					});
				}
				return Promise.resolve({
					rows: Array.from({ length: 20 }, (_, index) => ({
						id: `row-${50 + index}`,
						name: `Row ${50 + index}`,
					})),
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.ensureRange(50, 50, 'test');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getKnownRowCount()).toBe(70);
		expect(controller.getRowCountKind()).toBe('known');
		expect(controller.getVisualRowCount()).toBe(70);
		expect(controller.getVisualRow(69)?.kind).toBe('data');
		expect(getRowNode(controller, 69)?.data.name).toBe('Row 69');
		expect(controller.getRowLoadState(70)).toEqual({ kind: 'missing' });
		expect(controller.getVisualRow(70)).toBeNull();

		controller.dispose();
		store.destroy();
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
		expect(mockDatasource.getRows).toHaveBeenCalledWith(
			expect.objectContaining({ startRow: 100, endRow: 200 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);
		expect(mockDatasource.getRows).toHaveBeenCalledWith(
			expect.objectContaining({ startRow: 200, endRow: 300 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);
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

	it('respects maxConcurrentRequests for infinite block loads and drains queued work deterministically', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let resolveBlock20!: (value: { rows: TestRow[]; totalCount: number }) => void;
		let resolveBlock30!: (value: { rows: TestRow[]; totalCount: number }) => void;
		const getRows = vi.fn().mockImplementation((params: { startRow: number; endRow: number }) => {
			if (params.startRow === 0) {
				return Promise.resolve({
					rows: Array.from({ length: 10 }, (_, index) => ({
						id: `row-${index}`,
						name: `Row ${index}`,
					})),
					totalCount: 100,
				});
			}
			if (params.startRow === 20) {
				return new Promise((resolve) => {
					resolveBlock20 = resolve as typeof resolveBlock20;
				});
			}
			if (params.startRow === 30) {
				return new Promise((resolve) => {
					resolveBlock30 = resolve as typeof resolveBlock30;
				});
			}
			throw new Error(`Unexpected startRow ${params.startRow}`);
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			maxConcurrentRequests: 1,
			prefetchBlockCount: 0,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		vi.mocked(getRows).mockClear();

		controller.loadVisibleBlocks(20, 39);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows).toHaveBeenCalledTimes(1);
		expect(getRows).toHaveBeenLastCalledWith(
			expect.objectContaining({ startRow: 20, endRow: 30 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);

		resolveBlock20({
			rows: Array.from({ length: 10 }, (_, index) => ({
				id: `row-${20 + index}`,
				name: `Row ${20 + index}`,
			})),
			totalCount: 100,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows).toHaveBeenCalledTimes(2);
		expect(getRows).toHaveBeenLastCalledWith(
			expect.objectContaining({ startRow: 30, endRow: 40 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);

		resolveBlock30({
			rows: Array.from({ length: 10 }, (_, index) => ({
				id: `row-${30 + index}`,
				name: `Row ${30 + index}`,
			})),
			totalCount: 100,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(20)?.kind).toBe('data');
		expect(controller.getVisualRow(30)?.kind).toBe('data');

		controller.dispose();
		store.destroy();
	});

	it('prioritizes visible infinite block loads ahead of queued prefetch work', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let resolveBlock10!: (value: { rows: TestRow[]; totalCount: number }) => void;
		let resolveBlock30!: (value: { rows: TestRow[]; totalCount: number }) => void;
		let resolveBlock40!: (value: { rows: TestRow[]; totalCount: number }) => void;
		const getRows = vi.fn().mockImplementation((params: { startRow: number; endRow: number }) => {
			if (params.startRow === 0) {
				return Promise.resolve({
					rows: Array.from({ length: 10 }, (_, index) => ({
						id: `row-${index}`,
						name: `Row ${index}`,
					})),
					totalCount: 100,
				});
			}
			if (params.startRow === 10) {
				return new Promise((resolve) => {
					resolveBlock10 = resolve as typeof resolveBlock10;
				});
			}
			if (params.startRow === 30) {
				return new Promise((resolve) => {
					resolveBlock30 = resolve as typeof resolveBlock30;
				});
			}
			if (params.startRow === 40) {
				return new Promise((resolve) => {
					resolveBlock40 = resolve as typeof resolveBlock40;
				});
			}
			throw new Error(`Unexpected startRow ${params.startRow}`);
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			maxConcurrentRequests: 1,
			prefetchBlockCount: 1,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		vi.mocked(getRows).mockClear();

		store.engine.viewport.setScrollPosition(100, 0, performance.now() - 100);
		store.engine.viewport.setScrollPosition(200, 0, performance.now());
		controller.loadVisibleBlocks(10, 19);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows).toHaveBeenCalledTimes(1);
		expect(getRows).toHaveBeenLastCalledWith(
			expect.objectContaining({ startRow: 10, endRow: 20 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);

		controller.loadVisibleBlocks(30, 39);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRows).toHaveBeenCalledTimes(1);

		resolveBlock10({
			rows: Array.from({ length: 10 }, (_, index) => ({
				id: `row-${10 + index}`,
				name: `Row ${10 + index}`,
			})),
			totalCount: 100,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows).toHaveBeenCalledTimes(2);
		expect(getRows).toHaveBeenLastCalledWith(
			expect.objectContaining({ startRow: 30, endRow: 40 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);

		resolveBlock30({
			rows: Array.from({ length: 10 }, (_, index) => ({
				id: `row-${30 + index}`,
				name: `Row ${30 + index}`,
			})),
			totalCount: 100,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows).toHaveBeenCalledTimes(3);
		expect(getRows).toHaveBeenLastCalledWith(
			expect.objectContaining({ startRow: 40, endRow: 50 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);

		resolveBlock40({
			rows: Array.from({ length: 10 }, (_, index) => ({
				id: `row-${40 + index}`,
				name: `Row ${40 + index}`,
			})),
			totalCount: 100,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		controller.dispose();
		store.destroy();
	});

	it('refetches infinite rows on sort changes and publishes the returned order', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const getRows = vi.fn().mockImplementation((params: { sortModel: Array<{ colId: string; sort: string }> | null }) => {
			if (params.sortModel?.[0]?.sort === 'desc') {
				return Promise.resolve({
					rows: [
						{ id: '2', name: 'Zulu' },
						{ id: '1', name: 'Alpha' },
					],
					totalCount: 2,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Zulu' },
				],
				totalCount: 2,
			});
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alpha');

		store.setSortModel([{ colId: 'name', sort: 'desc' }]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows.mock.calls.at(-1)?.[0].sortModel).toEqual([{ colId: 'name', sort: 'desc' }]);
		expect(getRowNode(controller, 0)?.data.name).toBe('Zulu');

		controller.dispose();
		store.destroy();
	});

	it('publishes infinite sort changes only when the async response commits', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const applyRefreshInvalidation = vi.spyOn(store.engine, 'applyRowModelRefreshInvalidation');
		let resolveSortedRows!: (value: { rows: TestRow[]; totalCount: number }) => void;
		const getRows = vi.fn().mockImplementation((params: { sortModel: Array<{ colId: string; sort: string }> | null }) => {
			if (params.sortModel?.[0]?.sort === 'desc') {
				return new Promise((resolve) => {
					resolveSortedRows = resolve as typeof resolveSortedRows;
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Zulu' },
				],
				totalCount: 2,
			});
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		applyRefreshInvalidation.mockClear();

		store.setSortModel([{ colId: 'name', sort: 'desc' }]);
		expect(getRows.mock.calls.at(-1)?.[0].sortModel).toEqual([{ colId: 'name', sort: 'desc' }]);
		expect(applyRefreshInvalidation).not.toHaveBeenCalled();
		expect(controller.getVisualRow(0)?.kind).toBe('loading');

		resolveSortedRows({
			rows: [
				{ id: '2', name: 'Zulu' },
				{ id: '1', name: 'Alpha' },
			],
			totalCount: 2,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Zulu');
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 2,
				nextRowCount: 2,
				changedStartIndex: 0,
				changedEndIndex: 1,
			}),
			expect.objectContaining({
				invalidationReason: 'viewport',
				requestRenderReason: 'rows:infinite-block-loaded',
			})
		);

		controller.dispose();
		store.destroy();
	});

	it('refetches infinite rows on filter changes and publishes the filtered result', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const getRows = vi.fn().mockImplementation((params: { filterModel: Record<string, unknown> | null }) => {
			if (params.filterModel?.name) {
				return Promise.resolve({
					rows: [{ id: '2', name: 'Beta' }],
					totalCount: 1,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Beta' },
				],
				totalCount: 2,
			});
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRowCount()).toBe(2);

		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'et' } });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows.mock.calls.at(-1)?.[0].filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'et' } });
		expect(controller.getVisualRowCount()).toBe(1);
		expect(getRowNode(controller, 0)?.data.name).toBe('Beta');

		controller.dispose();
		store.destroy();
	});

	it('publishes infinite filter changes only when the async response commits', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const applyRefreshInvalidation = vi.spyOn(store.engine, 'applyRowModelRefreshInvalidation');
		let resolveFilteredRows!: (value: { rows: TestRow[]; totalCount: number }) => void;
		const getRows = vi.fn().mockImplementation((params: { filterModel: Record<string, unknown> | null }) => {
			if (params.filterModel?.name) {
				return new Promise((resolve) => {
					resolveFilteredRows = resolve as typeof resolveFilteredRows;
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Beta' },
				],
				totalCount: 2,
			});
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		applyRefreshInvalidation.mockClear();

		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'et' } });
		expect(getRows.mock.calls.at(-1)?.[0].filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'et' } });
		expect(applyRefreshInvalidation).not.toHaveBeenCalled();
		expect(controller.getVisualRow(0)?.kind).toBe('loading');

		resolveFilteredRows({
			rows: [{ id: '2', name: 'Beta' }],
			totalCount: 1,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(1);
		expect(getRowNode(controller, 0)?.data.name).toBe('Beta');
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 2,
				nextRowCount: 1,
				changedStartIndex: 0,
				changedEndIndex: 0,
			}),
			expect.objectContaining({
				invalidationReason: 'viewport',
				requestRenderReason: 'rows:infinite-block-loaded',
			})
		);

		controller.dispose();
		store.destroy();
	});

	it('refetches infinite rows on quick-filter changes and publishes the returned rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const getRows = vi.fn().mockImplementation((params: { quickFilterModel: { text: string } | null }) => {
			if (params.quickFilterModel?.text === 'bet') {
				return Promise.resolve({
					rows: [{ id: '2', name: 'Beta' }],
					totalCount: 1,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Beta' },
				],
				totalCount: 2,
			});
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRowCount()).toBe(2);

		store.setQuickFilter('bet');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows.mock.calls.at(-1)?.[0].quickFilterModel).toEqual({ text: 'bet', columnIds: undefined });
		expect(controller.getVisualRowCount()).toBe(1);
		expect(getRowNode(controller, 0)?.data.name).toBe('Beta');

		controller.dispose();
		store.destroy();
	});

	it('refetches infinite rows on query-model changes and publishes the returned rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const queryModel: GridQueryModel = {
			version: 1,
			root: {
				kind: 'group',
				id: 'root',
				operator: 'and',
				children: [{ kind: 'condition', id: 'c1', columnId: 'name', operator: 'contains', value: 'bet' }],
			},
		};
		const getRows = vi.fn().mockImplementation((params: { queryModel: GridQueryModel | null }) => {
			if (params.queryModel) {
				return Promise.resolve({
					rows: [{ id: '2', name: 'Beta' }],
					totalCount: 1,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Beta' },
				],
				totalCount: 2,
			});
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRowCount()).toBe(2);

		store.setQueryModel(queryModel);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows.mock.calls.at(-1)?.[0].queryModel).toEqual(queryModel);
		expect(controller.getVisualRowCount()).toBe(1);
		expect(getRowNode(controller, 0)?.data.name).toBe('Beta');

		controller.dispose();
		store.destroy();
	});

	it('passes immutable query snapshots to the infinite datasource', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const queryModel: GridQueryModel = {
			version: 1,
			root: {
				kind: 'group',
				id: 'root',
				operator: 'and',
				children: [{ kind: 'condition', id: 'c1', columnId: 'name', operator: 'contains', value: 'alp' }],
			},
		};
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);
		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'alp' } });
		store.setQuickFilter('alp', ['name']);
		store.setQueryModel(queryModel);

		const getRows = vi.fn().mockImplementation((params) => {
			const liveState = store.getState();
			expect(params.sortModel).toEqual(liveState.sortModel);
			expect(params.filterModel).toEqual(liveState.filterModel);
			expect(params.quickFilterModel).toEqual(liveState.quickFilterModel);
			expect(params.queryModel).toEqual(liveState.queryModel);
			expect(params.sortModel).not.toBe(liveState.sortModel);
			expect(params.filterModel).not.toBe(liveState.filterModel);
			expect(params.quickFilterModel).not.toBe(liveState.quickFilterModel);
			expect(params.queryModel).not.toBe(liveState.queryModel);
			expect(Object.isFrozen(params.sortModel)).toBe(true);
			expect(Object.isFrozen(params.filterModel)).toBe(true);
			expect(Object.isFrozen(params.quickFilterModel)).toBe(true);
			expect(Object.isFrozen(params.queryModel)).toBe(true);
			expect(() => {
				((params.sortModel as Array<{ sort: string }>)[0]!).sort = 'desc';
			}).toThrow();
			expect(() => {
				(params.filterModel as Record<string, { value: string }>).name.value = 'mutated';
			}).toThrow();
			expect(() => {
				(params.quickFilterModel as { text: string }).text = 'mutated';
			}).toThrow();
			expect(() => {
				(((params.queryModel as GridQueryModel).root.children as Array<{ value?: unknown }>)[0]!).value = 'mutated';
			}).toThrow();
			return Promise.resolve({
				rows: [{ id: '1', name: 'Alpha' }],
				totalCount: 1,
			});
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(store.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);
		expect(store.getState().filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'alp' } });
		expect(store.getState().quickFilterModel).toEqual({ text: 'alp', columnIds: ['name'] });
		expect(store.getState().queryModel).toEqual(queryModel);

		controller.dispose();
		store.destroy();
	});

	it('refetches server-page rows on sort changes and publishes the returned order', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const getPage = vi.fn().mockImplementation((params: { sortModel: Array<{ colId: string; sort: string }> | null }) => {
			if (params.sortModel?.[0]?.sort === 'desc') {
				return Promise.resolve({
					rows: [
						{ id: '2', name: 'Zulu' },
						{ id: '1', name: 'Alpha' },
					],
					totalRowCount: 2,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Zulu' },
				],
				totalRowCount: 2,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getPage.mock.calls.at(-1)?.[0].sortModel).toBeNull();

		store.setSortModel([{ colId: 'name', sort: 'desc' }]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getPage.mock.calls.at(-1)?.[0].sortModel).toEqual([{ colId: 'name', sort: 'desc' }]);
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Zulu');

		controller.dispose();
		store.destroy();
	});

	it('publishes server-page sort changes only when the async response commits', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const applyRefreshInvalidation = vi.spyOn(store.engine, 'applyRowModelRefreshInvalidation');
		let resolveSortedPage!: (value: { rows: TestRow[]; totalRowCount: number }) => void;
		const getPage = vi.fn().mockImplementation((params: { sortModel: Array<{ colId: string; sort: string }> | null }) => {
			if (params.sortModel?.[0]?.sort === 'desc') {
				return new Promise((resolve) => {
					resolveSortedPage = resolve as typeof resolveSortedPage;
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Zulu' },
				],
				totalRowCount: 2,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		applyRefreshInvalidation.mockClear();

		store.setSortModel([{ colId: 'name', sort: 'desc' }]);
		expect(getPage.mock.calls.at(-1)?.[0].sortModel).toEqual([{ colId: 'name', sort: 'desc' }]);
		expect(applyRefreshInvalidation).not.toHaveBeenCalled();
		expect(controller.getVisualRow(0)?.kind).toBe('loading');

		resolveSortedPage({
			rows: [
				{ id: '2', name: 'Zulu' },
				{ id: '1', name: 'Alpha' },
			],
			totalRowCount: 2,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Zulu');
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 10,
				nextRowCount: 2,
				changedStartIndex: 0,
				changedEndIndex: 9,
			}),
			expect.objectContaining({
				invalidationReason: 'viewport',
				requestRenderReason: 'rows:server-page-loaded',
			})
		);

		controller.dispose();
		store.destroy();
	});

	it('retains server-page RowNode identity when the same row id is reloaded', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let callCount = 0;
		const getPage = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: [{ id: '1', name: 'Alpha v1' }],
					totalRowCount: 1,
				});
			}
			return Promise.resolve({
				rows: [{ id: '1', name: 'Alpha v2' }],
				totalRowCount: 1,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		const originalNode = controller.getRowNodeById('1');
		expect(originalNode).not.toBeNull();
		expect(originalNode?.data.name).toBe('Alpha v1');

		controller.reloadPage('force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		const reloadedNode = controller.getRowNodeById('1');
		expect(reloadedNode).toBe(originalNode);
		expect(reloadedNode?.data.name).toBe('Alpha v2');
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node : null).toBe(originalNode);

		controller.dispose();
		store.destroy();
	});

	it('reloads the server-page datasource after editing a field that participates in server sort', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let callCount = 0;
		const getPage = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount <= 2) {
				return Promise.resolve({
					rows: [{ id: '1', name: 'Alpha' }],
					totalRowCount: 1,
				});
			}
			return Promise.resolve({
				rows: [{ id: '1', name: 'Zulu' }],
				totalRowCount: 1,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		vi.mocked(getPage).mockClear();

		const node = store.getRowNode('1');
		expect(node?.setData({ id: '1', name: 'Locally Edited' }).status).toBe('applied');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getPage).toHaveBeenCalledTimes(1);
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Zulu');

		controller.dispose();
		store.destroy();
	});

	it('reloads the server-page datasource after editing a field that participates in server filter', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let callCount = 0;
		const getPage = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: [
						{ id: '1', name: 'Alpha' },
						{ id: '2', name: 'Beta' },
					],
					totalRowCount: 2,
				});
			}
			if (callCount === 2) {
				return Promise.resolve({
					rows: [{ id: '2', name: 'Beta' }],
					totalRowCount: 1,
				});
			}
			return Promise.resolve({
				rows: [],
				totalRowCount: 0,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'et' } });
		await new Promise((resolve) => setTimeout(resolve, 0));
		vi.mocked(getPage).mockClear();

		expect(store.setCellValue('2', 'name', 'Removed From Filter').status).toBe('applied');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getPage).toHaveBeenCalledTimes(1);
		expect(controller.getVisualRowCount()).toBe(0);

		controller.dispose();
		store.destroy();
	});

	it('publishes a core refresh invalidation when a server-page response resolves', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const applyRefreshInvalidation = vi.spyOn(store.engine, 'applyRowModelRefreshInvalidation');
		let resolvePageTwo!: (value: { rows: TestRow[]; totalRowCount: number }) => void;
		const getPage = vi.fn().mockImplementation((params: { page: number }) => {
			if (params.page === 0) {
				return Promise.resolve({
					rows: [
						{ id: '1', name: 'Alpha' },
						{ id: '2', name: 'Beta' },
					],
					totalRowCount: 4,
				});
			}
			return new Promise((resolve) => {
				resolvePageTwo = resolve as typeof resolvePageTwo;
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 2 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		applyRefreshInvalidation.mockClear();

		controller.goToPage(1);
		expect(controller.getVisualRow(0)?.kind).toBe('loading');

		resolvePageTwo({
			rows: [
				{ id: '3', name: 'Gamma' },
				{ id: '4', name: 'Delta' },
			],
			totalRowCount: 4,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 2,
				nextRowCount: 2,
				changedStartIndex: 0,
				changedEndIndex: 1,
			}),
			expect.objectContaining({
				invalidationReason: 'viewport',
				requestRenderReason: 'rows:server-page-loaded',
			})
		);

		controller.dispose();
		store.destroy();
	});

	it('refetches server-page rows on filter changes and publishes the filtered result', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const getPage = vi.fn().mockImplementation((params: { filterModel: Record<string, unknown> | null }) => {
			if (params.filterModel?.name) {
				return Promise.resolve({
					rows: [{ id: '2', name: 'Beta' }],
					totalRowCount: 1,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Beta' },
				],
				totalRowCount: 2,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRowCount()).toBe(2);

		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'et' } });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getPage.mock.calls.at(-1)?.[0].filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'et' } });
		expect(controller.getVisualRowCount()).toBe(1);
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Beta');

		controller.dispose();
		store.destroy();
	});

	it('publishes server-page filter changes only when the async response commits', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const applyRefreshInvalidation = vi.spyOn(store.engine, 'applyRowModelRefreshInvalidation');
		let resolveFilteredPage!: (value: { rows: TestRow[]; totalRowCount: number }) => void;
		const getPage = vi.fn().mockImplementation((params: { filterModel: Record<string, unknown> | null }) => {
			if (params.filterModel?.name) {
				return new Promise((resolve) => {
					resolveFilteredPage = resolve as typeof resolveFilteredPage;
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Beta' },
				],
				totalRowCount: 2,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		applyRefreshInvalidation.mockClear();

		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'et' } });
		expect(getPage.mock.calls.at(-1)?.[0].filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'et' } });
		expect(applyRefreshInvalidation).not.toHaveBeenCalled();
		expect(controller.getVisualRow(0)?.kind).toBe('loading');

		resolveFilteredPage({
			rows: [{ id: '2', name: 'Beta' }],
			totalRowCount: 1,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(1);
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Beta');
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 10,
				nextRowCount: 1,
				changedStartIndex: 0,
				changedEndIndex: 9,
			}),
			expect.objectContaining({
				invalidationReason: 'viewport',
				requestRenderReason: 'rows:server-page-loaded',
			})
		);

		controller.dispose();
		store.destroy();
	});

	it('refetches server-page rows on quick-filter changes and publishes the returned rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const getPage = vi.fn().mockImplementation((params: { quickFilterModel: { text: string } | null }) => {
			if (params.quickFilterModel?.text === 'bet') {
				return Promise.resolve({
					rows: [{ id: '2', name: 'Beta' }],
					totalRowCount: 1,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Beta' },
				],
				totalRowCount: 2,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRowCount()).toBe(2);

		store.setQuickFilter('bet');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getPage.mock.calls.at(-1)?.[0].quickFilterModel).toEqual({ text: 'bet', columnIds: undefined });
		expect(controller.getVisualRowCount()).toBe(1);
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Beta');

		controller.dispose();
		store.destroy();
	});

	it('refetches server-page rows on query-model changes and publishes the returned rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const queryModel: GridQueryModel = {
			version: 1,
			root: {
				kind: 'group',
				id: 'root',
				operator: 'and',
				children: [{ kind: 'condition', id: 'c1', columnId: 'name', operator: 'contains', value: 'bet' }],
			},
		};
		const getPage = vi.fn().mockImplementation((params: { queryModel: GridQueryModel | null }) => {
			if (params.queryModel) {
				return Promise.resolve({
					rows: [{ id: '2', name: 'Beta' }],
					totalRowCount: 1,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Beta' },
				],
				totalRowCount: 2,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRowCount()).toBe(2);

		store.setQueryModel(queryModel);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getPage.mock.calls.at(-1)?.[0].queryModel).toEqual(queryModel);
		expect(controller.getVisualRowCount()).toBe(1);
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Beta');

		controller.dispose();
		store.destroy();
	});

	it('passes immutable query snapshots to the server-page datasource', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const queryModel: GridQueryModel = {
			version: 1,
			root: {
				kind: 'group',
				id: 'root',
				operator: 'and',
				children: [{ kind: 'condition', id: 'c1', columnId: 'name', operator: 'contains', value: 'bet' }],
			},
		};
		store.setSortModel([{ colId: 'name', sort: 'desc' }]);
		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'bet' } });
		store.setQuickFilter('bet', ['name']);
		store.setQueryModel(queryModel);

		const getPage = vi.fn().mockImplementation((params) => {
			const liveState = store.getState();
			expect(params.sortModel).toEqual(liveState.sortModel);
			expect(params.filterModel).toEqual(liveState.filterModel);
			expect(params.quickFilterModel).toEqual(liveState.quickFilterModel);
			expect(params.queryModel).toEqual(liveState.queryModel);
			expect(params.sortModel).not.toBe(liveState.sortModel);
			expect(params.filterModel).not.toBe(liveState.filterModel);
			expect(params.quickFilterModel).not.toBe(liveState.quickFilterModel);
			expect(params.queryModel).not.toBe(liveState.queryModel);
			expect(Object.isFrozen(params.sortModel)).toBe(true);
			expect(Object.isFrozen(params.filterModel)).toBe(true);
			expect(Object.isFrozen(params.quickFilterModel)).toBe(true);
			expect(Object.isFrozen(params.queryModel)).toBe(true);
			expect(() => {
				((params.sortModel as Array<{ sort: string }>)[0]!).sort = 'asc';
			}).toThrow();
			expect(() => {
				(params.filterModel as Record<string, { value: string }>).name.value = 'mutated';
			}).toThrow();
			expect(() => {
				(params.quickFilterModel as { text: string }).text = 'mutated';
			}).toThrow();
			expect(() => {
				(((params.queryModel as GridQueryModel).root.children as Array<{ value?: unknown }>)[0]!).value = 'mutated';
			}).toThrow();
			return Promise.resolve({
				rows: [{ id: '2', name: 'Beta' }],
				totalRowCount: 1,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(store.getState().sortModel).toEqual([{ colId: 'name', sort: 'desc' }]);
		expect(store.getState().filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'bet' } });
		expect(store.getState().quickFilterModel).toEqual({ text: 'bet', columnIds: ['name'] });
		expect(store.getState().queryModel).toEqual(queryModel);

		controller.dispose();
		store.destroy();
	});

	it('passes an AbortSignal to the server-page datasource and aborts stale requests on query reset', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let initialSignal: AbortSignal | undefined;
		let resolveReplacement!: (value: { rows: TestRow[]; totalRowCount: number }) => void;
		let callCount = 0;
		const getPage = vi.fn().mockImplementation((_params, context) => {
			callCount++;
			if (callCount === 1) {
				initialSignal = context.signal;
				return new Promise(() => undefined);
			}
			return new Promise((resolve) => {
				resolveReplacement = resolve as typeof resolveReplacement;
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		expect(initialSignal).toBeDefined();
		expect(initialSignal?.aborted).toBe(false);

		store.setSortModel([{ colId: 'name', sort: 'asc' }]);
		expect(initialSignal?.aborted).toBe(true);

		resolveReplacement({
			rows: [{ id: '2', name: 'Sorted Page Winner' }],
			totalRowCount: 1,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Sorted Page Winner');

		controller.dispose();
		store.destroy();
	});

	it('aborts in-flight server-page datasource requests on dispose', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let signal: AbortSignal | undefined;
		const getPage = vi.fn().mockImplementation((_params, context) => {
			signal = context.signal;
			return new Promise(() => undefined);
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		expect(signal).toBeDefined();
		expect(signal?.aborted).toBe(false);

		controller.dispose();

		expect(signal?.aborted).toBe(true);
		store.destroy();
	});

	it('rejects a negative server-page totalRowCount and keeps committed rows during reloadPage', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let callCount = 0;
		let negativeCountObserved = false;
		const getPage = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: [{ id: '1', name: 'Alpha v1' }],
					totalRowCount: 1,
				});
			}
			return Promise.resolve({
				rows: [{ id: '1', name: 'Alpha v2' }],
				totalRowCount: -1,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(0)?.kind).toBe('data');

		store.addEventListener(GridEventName.serverPageLoadFailed, (event) => {
			if (event.payload.message.includes('negative totalRowCount -1')) {
				negativeCountObserved = true;
			}
		});

		controller.reloadPage('force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(negativeCountObserved).toBe(true);
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Alpha v1');
		expect(controller.getPageState().totalRowCount).toBe(1);
		expect(controller.getPageState().error).toBe('Server datasource returned negative totalRowCount -1');

		controller.dispose();
		store.destroy();
	});

	it('rejects a server-page totalRowCount smaller than the loaded page range and keeps committed rows during reloadPage', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let impossibleCountObserved = false;
		let pageOneCallCount = 0;
		const getPage = vi.fn().mockImplementation((params: { page: number }) => {
			if (params.page === 0) {
				return Promise.resolve({
					rows: [
						{ id: '1', name: 'Alpha' },
						{ id: '2', name: 'Beta' },
					],
					totalRowCount: 4,
				});
			}
			pageOneCallCount++;
			if (pageOneCallCount === 1) {
				return Promise.resolve({
					rows: [
						{ id: '3', name: 'Gamma' },
						{ id: '4', name: 'Delta' },
					],
					totalRowCount: 4,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '3', name: 'Gamma' },
					{ id: '4', name: 'Delta' },
				],
				totalRowCount: 3,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 2 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.goToPage(1);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(0)?.kind).toBe('data');

		store.addEventListener(GridEventName.serverPageLoadFailed, (event) => {
			if (event.payload.message.includes('smaller than the loaded page range ending at 3')) {
				impossibleCountObserved = true;
			}
		});

		controller.reloadPage('force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(impossibleCountObserved).toBe(true);
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Gamma');
		expect(controller.getPageState().totalRowCount).toBe(4);
		expect(controller.getPageState().error).toBe(
			'Server datasource returned totalRowCount 3, which is smaller than the loaded page range ending at 3'
		);

		controller.dispose();
		store.destroy();
	});

	it('rejects duplicate server-page row ids and keeps committed rows during reloadPage', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let duplicateRowObserved = false;
		let callCount = 0;
		const getPage = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: [
						{ id: '1', name: 'Alpha v1' },
						{ id: '2', name: 'Beta v1' },
					],
					totalRowCount: 2,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha v2' },
					{ id: '1', name: 'Alpha duplicated' },
				],
				totalRowCount: 2,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 10 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(0)?.kind).toBe('data');

		store.addEventListener(GridEventName.serverPageLoadFailed, (event) => {
			if (event.payload.message.includes('duplicate row id "1"')) {
				duplicateRowObserved = true;
			}
		});

		controller.reloadPage('force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(duplicateRowObserved).toBe(true);
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Alpha v1');
		expect(controller.getVisualRow(1)?.kind).toBe('data');
		expect(controller.getVisualRow(1)?.kind === 'data' ? controller.getVisualRow(1)?.node.data.name : null).toBe('Beta v1');
		expect(controller.getPageState().totalRowCount).toBe(2);
		expect(controller.getPageState().error).toBe('Server datasource returned duplicate row id "1" within one page');

		controller.dispose();
		store.destroy();
	});

	it('rejects an oversized server-page response and keeps committed rows during reloadPage', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let oversizedPageObserved = false;
		let callCount = 0;
		const getPage = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: [
						{ id: '1', name: 'Alpha v1' },
						{ id: '2', name: 'Beta v1' },
					],
					totalRowCount: 2,
				});
			}
			return Promise.resolve({
				rows: [
					{ id: '1', name: 'Alpha v2' },
					{ id: '2', name: 'Beta v2' },
					{ id: '3', name: 'Gamma v2' },
				],
				totalRowCount: 3,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 2 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(0)?.kind).toBe('data');

		store.addEventListener(GridEventName.serverPageLoadFailed, (event) => {
			if (event.payload.message.includes('returned 3 rows for page size 2')) {
				oversizedPageObserved = true;
			}
		});

		controller.reloadPage('force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(oversizedPageObserved).toBe(true);
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Alpha v1');
		expect(controller.getVisualRow(1)?.kind).toBe('data');
		expect(controller.getVisualRow(1)?.kind === 'data' ? controller.getVisualRow(1)?.node.data.name : null).toBe('Beta v1');
		expect(controller.getPageState().totalRowCount).toBe(2);
		expect(controller.getPageState().error).toBe('Server datasource returned 3 rows for page size 2');

		controller.dispose();
		store.destroy();
	});

	it('rejects a short non-terminal server-page response and keeps committed rows during reloadPage', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let impossibleShortPageObserved = false;
		let callCount = 0;
		const getPage = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: [
						{ id: '1', name: 'Alpha v1' },
						{ id: '2', name: 'Beta v1' },
					],
					totalRowCount: 2,
				});
			}
			return Promise.resolve({
				rows: [{ id: '1', name: 'Alpha v2' }],
				totalRowCount: 2,
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 2 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(0)?.kind).toBe('data');

		store.addEventListener(GridEventName.serverPageLoadFailed, (event) => {
			if (event.payload.message.includes('returned 1 rows for page 0 with page size 2')) {
				impossibleShortPageObserved = true;
			}
		});

		controller.reloadPage('force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(impossibleShortPageObserved).toBe(true);
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.kind === 'data' ? controller.getVisualRow(0)?.node.data.name : null).toBe('Alpha v1');
		expect(controller.getVisualRow(1)?.kind).toBe('data');
		expect(controller.getVisualRow(1)?.kind === 'data' ? controller.getVisualRow(1)?.node.data.name : null).toBe('Beta v1');
		expect(controller.getPageState().totalRowCount).toBe(2);
		expect(controller.getPageState().error).toBe(
			'Server datasource returned 1 rows for page 0 with page size 2, but totalRowCount 2 still requires rows within that page'
		);

		controller.dispose();
		store.destroy();
	});

	it('publishes a core refresh invalidation when a server-page response fails', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const applyRefreshInvalidation = vi.spyOn(store.engine, 'applyRowModelRefreshInvalidation');
		let rejectPageTwo!: (error: unknown) => void;
		const getPage = vi.fn().mockImplementation((params: { page: number }) => {
			if (params.page === 0) {
				return Promise.resolve({
					rows: [
						{ id: '1', name: 'Alpha' },
						{ id: '2', name: 'Beta' },
					],
					totalRowCount: 4,
				});
			}
			return new Promise((_, reject) => {
				rejectPageTwo = reject as typeof rejectPageTwo;
			});
		});

		const controller = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			pagination: { pageSize: 2 },
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		applyRefreshInvalidation.mockClear();

		controller.goToPage(1);
		expect(controller.getVisualRow(0)?.kind).toBe('loading');

		rejectPageTwo(new Error('page failed'));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(0)?.kind).toBe('failed');
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 2,
				nextRowCount: 0,
				changedStartIndex: 0,
				changedEndIndex: 1,
			}),
			expect.objectContaining({
				invalidationReason: 'viewport',
				requestRenderReason: 'rows:server-page-load-failed',
			})
		);

		controller.dispose();
		store.destroy();
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
							rows: Array.from({ length: 50 }, (_, index) => ({
								id: String(index + 1),
								name: index === 0 ? 'Alice' : index === 1 ? 'Bob' : `Row ${index + 1}`,
							})),
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

	it('passes an AbortSignal to the infinite datasource and aborts stale requests on query reset', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let initialSignal: AbortSignal | undefined;
		let resolveReplacement!: (value: { rows: TestRow[]; totalCount: number }) => void;
		let callCount = 0;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((_params, context) => {
				callCount++;
				if (callCount === 1) {
					initialSignal = context.signal;
					return new Promise(() => undefined);
				}
				return new Promise((resolve) => {
					resolveReplacement = resolve as typeof resolveReplacement;
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		expect(initialSignal).toBeDefined();
		expect(initialSignal?.aborted).toBe(false);

		store.setSortModel([{ colId: 'name', sort: 'asc' }]);
		expect(initialSignal?.aborted).toBe(true);

		resolveReplacement({
			rows: [{ id: '2', name: 'Sorted Winner' }],
			totalCount: 1,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRowNode(controller, 0)?.data.name).toBe('Sorted Winner');

		controller.dispose();
		store.destroy();
	});

	it('aborts in-flight infinite datasource requests on dispose', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let signal: AbortSignal | undefined;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((_params, context) => {
				signal = context.signal;
				return new Promise(() => undefined);
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		expect(signal).toBeDefined();
		expect(signal?.aborted).toBe(false);

		controller.dispose();

		expect(signal?.aborted).toBe(true);
		store.destroy();
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

		expect(secondDatasource.getRows).toHaveBeenCalledWith(
			expect.objectContaining({ startRow: 0, endRow: 25 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);
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

	it('purgeCache resets failed block state and known row count before refetching', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let rejectBlockOne!: (error: unknown) => void;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					return Promise.resolve({
						rows: Array.from({ length: 50 }, (_, index) => ({
							id: String(index + 1),
							name: index === 0 ? 'Alice' : `Row ${index + 1}`,
						})),
						totalCount: 100,
					});
				}
				return new Promise((_, reject) => {
					rejectBlockOne = reject;
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.ensureRange(50, 50, 'test');
		rejectBlockOne!(new Error('block failed'));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getRowLoadState(50)).toEqual({ kind: 'failed', error: 'block failed', retryable: true });
		expect(controller.getKnownRowCount()).toBe(100);

		controller.purgeCache();

		expect(controller.getKnownRowCount()).toBeNull();
		expect(controller.getRowCountKind()).toBe('estimated');
		expect(controller.getRowLoadState(50)).toEqual({ kind: 'loading', reason: 'infinite-block' });
		expect(mockDatasource.getRows).toHaveBeenLastCalledWith(
			expect.objectContaining({ startRow: 0, endRow: 50 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getKnownRowCount()).toBe(100);

		controller.dispose();
		store.destroy();
	});

	it('retains committed infinite rows while a loaded block refreshes and if that refresh fails', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let rejectRefresh!: (error: unknown) => void;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (vi.mocked(mockDatasource.getRows).mock.calls.length === 1) {
					return Promise.resolve({
						rows: [{ id: '1', name: 'Alice v1' }],
						totalCount: 1,
					});
				}
				return new Promise((_, reject) => {
					rejectRefresh = reject;
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		controller.ensureRange(0, 0, 'force-reload');
		expect(controller.getBlockSnapshots()).toEqual([
			expect.objectContaining({
				blockIndex: 0,
				state: 'refreshing',
				committedRowCount: 1,
			}),
		]);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		rejectRefresh!(new Error('refresh failed'));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getBlockSnapshots()).toEqual([
			expect.objectContaining({
				blockIndex: 0,
				state: 'failedRefresh',
				committedRowCount: 1,
				error: 'refresh failed',
			}),
		]);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');
		expect(controller.getVisualIndexByRowId('1')).toBe(0);
		expect(controller.getRangeLoadState(0, 0)).toEqual({
			loaded: 1,
			loading: 0,
			failed: 0,
			placeholder: 0,
			missing: 0,
		});

		controller.dispose();
		store.destroy();
	});

	it('rejects an oversized infinite block response without partially mutating the committed rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let callCount = 0;
		let rejectResponseObserved = false;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.resolve({
						rows: [{ id: '1', name: 'Alice v1' }],
						totalCount: 1,
					});
				}
				return Promise.resolve({
					rows: [
						{ id: '1', name: 'Alice v2' },
						{ id: '2', name: 'Bob' },
					],
						totalCount: 2,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 1,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('returned 2 rows')) {
				rejectResponseObserved = true;
			}
		});

		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(rejectResponseObserved).toBe(true);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');
		expect(store.getRawRowById('2')).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('rejects duplicate row ids in an infinite block response without partially mutating the committed rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let callCount = 0;
		let duplicateResponseObserved = false;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.resolve({
						rows: [{ id: '1', name: 'Alice v1' }],
						totalCount: 1,
					});
				}
				return Promise.resolve({
					rows: [
						{ id: '1', name: 'Alice v2' },
						{ id: '1', name: 'Alice duplicate' },
					],
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 2,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('duplicate row id')) {
				duplicateResponseObserved = true;
			}
		});

		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(duplicateResponseObserved).toBe(true);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');
		expect(controller.getVisualIndexByRowId('1')).toBe(0);

		controller.dispose();
		store.destroy();
	});

	it('rejects a row id that is already committed in a different infinite block', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let duplicateAcrossBlocksObserved = false;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					return Promise.resolve({
						rows: Array.from({ length: 50 }, (_, index) => ({
							id: index === 0 ? '1' : `row-${index}`,
							name: index === 0 ? 'Alice v1' : `Row ${index}`,
						})),
						totalCount: 100,
					});
				}
				return Promise.resolve({
					rows: Array.from({ length: 50 }, (_, index) => ({
						id: index === 0 ? '1' : `row-${50 + index}`,
						name: index === 0 ? 'Alice duplicated elsewhere' : `Row ${50 + index}`,
					})),
					totalCount: 100,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('already committed at visual index 0')) {
				duplicateAcrossBlocksObserved = true;
			}
		});

		controller.ensureRange(50, 50, 'test');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(duplicateAcrossBlocksObserved).toBe(true);
		expect(controller.getRowLoadState(50)).toEqual({
			kind: 'failed',
			error: 'Infinite datasource returned row id "1" for visual index 50, but that row id is already committed at visual index 0',
			retryable: true,
		});
		expect(controller.getVisualRow(50)?.kind).toBe('failed');
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');
		expect(controller.getVisualIndexByRowId('1')).toBe(0);

		controller.dispose();
		store.destroy();
	});

	it('rejects a negative infinite totalCount without partially mutating the committed rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let invalidTotalObserved = false;
		let callCount = 0;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.resolve({
						rows: [{ id: '1', name: 'Alice v1' }],
						totalCount: 1,
					});
				}
				return Promise.resolve({
					rows: [{ id: '1', name: 'Alice v2' }],
					totalCount: -1,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('negative totalCount -1')) {
				invalidTotalObserved = true;
			}
		});

		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(invalidTotalObserved).toBe(true);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');
		expect(controller.getKnownRowCount()).toBe(1);

		controller.dispose();
		store.destroy();
	});

	it('rejects an infinite totalCount that is smaller than the loaded range', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let impossibleTotalObserved = false;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					return Promise.resolve({
						rows: Array.from({ length: 50 }, (_, index) => ({
							id: `row-${index}`,
							name: `Row ${index}`,
						})),
						totalCount: 100,
					});
				}
				return Promise.resolve({
					rows: [{ id: 'row-50', name: 'Row 50' }],
					totalCount: 10,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Row 0');

		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('smaller than the loaded range ending at 50')) {
				impossibleTotalObserved = true;
			}
		});

		controller.ensureRange(50, 50, 'test');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(impossibleTotalObserved).toBe(true);
		expect(controller.getRowLoadState(50)).toEqual({
			kind: 'failed',
			error: 'Infinite datasource returned totalCount 10, which is smaller than the loaded range ending at 50',
			retryable: true,
		});
		expect(controller.getVisualRow(50)?.kind).toBe('failed');
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Row 0');
		expect(controller.getKnownRowCount()).toBe(100);

		controller.dispose();
		store.destroy();
	});

	it('drops committed infinite rows beyond a newly shrunk known row count', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let shrinkKnownCount = false;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					const totalCount = shrinkKnownCount ? 60 : 100;
					return Promise.resolve({
						rows: Array.from({ length: 50 }, (_, index) => ({
							id: `row-${index}`,
							name: `Row ${index}`,
						})),
						totalCount,
					});
				}
				return Promise.resolve({
					rows: Array.from({ length: 50 }, (_, index) => ({
						id: `row-${50 + index}`,
						name: `Row ${50 + index}`,
					})),
					totalCount: 100,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.ensureRange(50, 50, 'test');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getSelectableDataRowIds('loaded')).toContain('row-80');
		expect(controller.getVisualRow(80)?.kind).toBe('data');

		shrinkKnownCount = true;
		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getKnownRowCount()).toBe(60);
		expect(controller.getVisualRowCount()).toBe(60);
		expect(controller.getSelectableDataRowIds('loaded')).not.toContain('row-80');
		expect(controller.getVisualRow(80)).toBeNull();
		expect(controller.getRowLoadState(80)).toEqual({ kind: 'missing' });
		expect(controller.getSelectableDataRowIds('loaded')).toContain('row-55');

		controller.dispose();
		store.destroy();
	});

	it('evicts least recently used non-visible infinite blocks when maxBlocksInCache is reached', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) =>
				Promise.resolve({
					rows: Array.from({ length: params.endRow - params.startRow }, (_, index) => ({
						id: `row-${params.startRow + index}`,
						name: `Row ${params.startRow + index}`,
					})),
					totalCount: 6,
				})
			),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 2,
			maxBlocksInCache: 2,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(0)?.kind).toBe('data');

		controller.ensureRange(2, 2, 'test');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(2)?.kind).toBe('data');

		// Touch block 1 so block 0 becomes the LRU candidate before block 2 is loaded.
		expect(controller.getVisualRow(2)?.kind).toBe('data');

		controller.ensureRange(4, 4, 'test');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(4)?.kind).toBe('data');
		expect(controller.getSelectableDataRowIds('loaded')).not.toContain('row-0');
		expect(controller.getSelectableDataRowIds('loaded')).toContain('row-2');
		expect(controller.getSelectableDataRowIds('loaded')).toContain('row-4');
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loading', reason: 'infinite-block' });
		expect(controller.getVisualRow(0)?.kind).toBe('loading');
		expect(controller.getVisualRow(2)?.kind).toBe('data');

		controller.dispose();
		store.destroy();
	});

	it('treats an in-range gap inside a loaded infinite block as loading and refetches that block', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let callCount = 0;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				callCount++;
				return Promise.resolve({
					rows: Array.from({ length: 4 }, (_, index) => ({
						id: `row-${index}`,
						name: callCount === 1 ? `Row ${index} v1` : `Row ${index} repaired`,
					})),
					totalCount: 4,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 4,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getVisualRow(1)?.kind).toBe('data');

		const block = ((controller as unknown as { blockCache: { getBlock: (index: number) => { rows: Array<unknown> } | null } }).blockCache.getBlock(0));
		expect(block).not.toBeNull();
		block!.rows[1] = null;

		expect(controller.getRowLoadState(1)).toEqual({ kind: 'loading', reason: 'infinite-block' });
		expect(controller.getVisualRow(1)?.kind).toBe('loading');

		vi.mocked(mockDatasource.getRows).mockClear();
		controller.ensureRange(0, 3, 'viewport-render');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mockDatasource.getRows).toHaveBeenCalledWith(
			expect.objectContaining({ startRow: 0, endRow: 4 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);
		expect(controller.getVisualRow(1)?.kind).toBe('data');
		expect(getRowNode(controller, 1)?.data.name).toBe('Row 1 repaired');

		controller.dispose();
		store.destroy();
	});

	it('treats hasMore false as a terminal infinite row count without totalCount', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockResolvedValue({
				rows: [
					{ id: '1', name: 'Alpha' },
					{ id: '2', name: 'Beta' },
				],
				hasMore: false,
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getKnownRowCount()).toBe(2);
		expect(controller.getRowCountKind()).toBe('known');
		expect(controller.getVisualRowCount()).toBe(2);
		expect(controller.getVisualRow(1)?.kind).toBe('data');
		expect(controller.getRowLoadState(2)).toEqual({ kind: 'missing' });

		controller.dispose();
		store.destroy();
	});

	it('treats lastRow as the terminal infinite row count without totalCount', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockResolvedValue({
				rows: Array.from({ length: 50 }, (_, index) => ({
					id: `row-${index}`,
					name: `Row ${index}`,
				})),
				lastRow: 50,
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getKnownRowCount()).toBe(50);
		expect(controller.getRowCountKind()).toBe('known');
		expect(controller.getVisualRowCount()).toBe(50);
		expect(controller.getVisualRow(49)?.kind).toBe('data');
		expect(controller.getVisualRow(50)).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('does not terminalize a short infinite block when hasMore explicitly stays true', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					return Promise.resolve({
						rows: Array.from({ length: 50 }, (_, index) => ({
							id: `row-${index}`,
							name: `Row ${index}`,
						})),
						hasMore: true,
					});
				}
				return Promise.resolve({
					rows: [{ id: 'row-50', name: 'Row 50' }],
					hasMore: false,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getKnownRowCount()).toBeNull();
		expect(controller.getRowCountKind()).toBe('estimated');
		expect(controller.getVisualRowCount()).toBe(100);
		expect(controller.getVisualRow(49)?.kind).toBe('data');
		expect(controller.getRowLoadState(50)).toEqual({ kind: 'loading', reason: 'infinite-block' });

		controller.ensureRange(50, 50, 'test');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(50)?.kind).toBe('data');
		expect(controller.getKnownRowCount()).toBe(51);
		expect(controller.getVisualRowCount()).toBe(51);

		controller.dispose();
		store.destroy();
	});

	it('rejects hasMore false when totalCount contradicts the loaded infinite range', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let contradictoryTerminalObserved = false;
		let callCount = 0;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.resolve({
						rows: [{ id: '1', name: 'Alice v1' }],
						totalCount: 1,
					});
				}
				return Promise.resolve({
					rows: [{ id: '1', name: 'Alice v2' }],
					totalCount: 3,
					hasMore: false,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('hasMore false but totalCount 3')) {
				contradictoryTerminalObserved = true;
			}
		});

		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(contradictoryTerminalObserved).toBe(true);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		controller.dispose();
		store.destroy();
	});

	it('rejects hasMore true when lastRow leaves no rows beyond the loaded infinite range', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let contradictoryHasMoreObserved = false;
		let callCount = 0;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.resolve({
						rows: [{ id: '1', name: 'Alice v1' }],
						totalCount: 1,
					});
				}
				return Promise.resolve({
					rows: [{ id: '1', name: 'Alice v2' }],
					lastRow: 1,
					hasMore: true,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('hasMore true but lastRow 1')) {
				contradictoryHasMoreObserved = true;
			}
		});

		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(contradictoryHasMoreObserved).toBe(true);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		controller.dispose();
		store.destroy();
	});

	it('rejects a negative lastRow without partially mutating the committed infinite rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let negativeLastRowObserved = false;
		let callCount = 0;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.resolve({
						rows: [{ id: '1', name: 'Alice v1' }],
						totalCount: 1,
					});
				}
				return Promise.resolve({
					rows: [{ id: '1', name: 'Alice v2' }],
					lastRow: -1,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('negative lastRow -1')) {
				negativeLastRowObserved = true;
			}
		});

		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(negativeLastRowObserved).toBe(true);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		controller.dispose();
		store.destroy();
	});

	it('rejects conflicting totalCount and lastRow values without partially mutating the committed infinite rows', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let conflictingCountsObserved = false;
		let callCount = 0;
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.resolve({
						rows: [{ id: '1', name: 'Alice v1' }],
						totalCount: 1,
					});
				}
				return Promise.resolve({
					rows: [{ id: '1', name: 'Alice v2' }],
					totalCount: 3,
					lastRow: 4,
				});
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		store.addEventListener(GridEventName.infiniteBlockLoadFailed, (event) => {
			if (event.payload.message.includes('conflicting totalCount 3 and lastRow 4')) {
				conflictingCountsObserved = true;
			}
		});

		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(conflictingCountsObserved).toBe(true);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		controller.dispose();
		store.destroy();
	});
});

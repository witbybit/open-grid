import { describe, it, expect, vi } from 'vitest';
import { GridEventName, GridStore } from './store.js';
import { InfiniteRowModelController, type InfiniteDatasource } from './infiniteRowModel.js';
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

	it('force reload aborts an in-flight initial infinite block load and starts a replacement request', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const signals: AbortSignal[] = [];
		const getRows = vi.fn().mockImplementation((_params, context: { signal?: AbortSignal }) => {
			if (context.signal) signals.push(context.signal);
			return new Promise(() => {
				/* keep request in-flight until the controller aborts it */
			});
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		expect(getRows).toHaveBeenCalledTimes(1);
		expect(signals[0]?.aborted).toBe(false);
		expect(controller.getBlockSnapshots()).toEqual([
			expect.objectContaining({
				blockIndex: 0,
				state: 'loadingInitial',
				requestId: 1,
			}),
		]);

		controller.ensureRange(0, 0, 'force-reload');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(signals[0]?.aborted).toBe(true);
		expect(getRows).toHaveBeenCalledTimes(2);
		expect(signals[1]?.aborted).toBe(false);
		expect(controller.getBlockSnapshots()).toEqual([
			expect.objectContaining({
				blockIndex: 0,
				state: 'loadingInitial',
				requestId: 2,
			}),
		]);

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

	it('never returns unexplained null visual rows for represented infinite indexes', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: vi.fn().mockImplementation((params) => {
				if (params.startRow === 0) {
					return Promise.resolve({
						rows: Array.from({ length: 10 }, (_, index) => ({
							id: `row-${index}`,
							name: `Row ${index}`,
						})),
						totalCount: 40,
					});
				}
				if (params.startRow === 10) {
					return Promise.reject(new Error('block 1 failed'));
				}
				if (params.startRow === 20) {
					return new Promise(() => {
						/* keep block 2 represented but loading */
					});
				}
				throw new Error(`Unexpected request ${params.startRow}-${params.endRow}`);
			}),
		};

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 10,
			prefetchBlockCount: 0,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.loadVisibleBlocks(10, 29);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(40);
		expect(controller.getBlockSnapshots()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ blockIndex: 0, state: 'loaded', committedRowCount: 10 }),
				expect.objectContaining({ blockIndex: 1, state: 'failedInitial', committedRowCount: 0 }),
				expect.objectContaining({ blockIndex: 2, state: 'loadingInitial', committedRowCount: 0 }),
			])
		);

		for (let index = 0; index < controller.getVisualRowCount(); index++) {
			const visualRow = controller.getVisualRow(index);
			const loadState = controller.getRowLoadState(index);
			expect(visualRow, `index ${index} should resolve to a deliberate visual row`).not.toBeNull();
			expect(loadState.kind, `index ${index} should not be terminal missing inside represented range`).not.toBe('missing');
			if (loadState.kind === 'loaded') expect(visualRow?.kind).toBe('data');
			if (loadState.kind === 'failed') expect(visualRow?.kind).toBe('failed');
			if (loadState.kind === 'loading') expect(visualRow?.kind).toBe('loading');
		}
		expect(controller.getVisualRow(40)).toBeNull();
		expect(controller.getRowLoadState(40)).toEqual({ kind: 'missing' });

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
		const applyRefreshInvalidation = vi.spyOn(store.engine, 'applyRowModelRefreshInvalidation');

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
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 0,
				nextRowCount: 100,
				changedStartIndex: 0,
				changedEndIndex: 49,
			}),
			expect.objectContaining({
				invalidationReason: 'viewport',
				requestRenderReason: 'rows:infinite-block-loaded',
			})
		);
		expect(controller.getRowLoadState(50)).toEqual({ kind: 'loading', reason: 'infinite-block' });

		applyRefreshInvalidation.mockClear();
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
		expect(controller.getVisualRowCount()).toBe(150);
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 100,
				nextRowCount: 150,
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

	it('treats a short infinite block without totalCount as the terminal known row count', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});
		const applyRefreshInvalidation = vi.spyOn(store.engine, 'applyRowModelRefreshInvalidation');

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
		applyRefreshInvalidation.mockClear();
		controller.ensureRange(50, 50, 'test');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getKnownRowCount()).toBe(70);
		expect(controller.getRowCountKind()).toBe('known');
		expect(controller.getVisualRowCount()).toBe(70);
		expect(controller.getVisualRow(69)?.kind).toBe('data');
		expect(getRowNode(controller, 69)?.data.name).toBe('Row 69');
		expect(controller.getRowLoadState(70)).toEqual({ kind: 'missing' });
		expect(controller.getVisualRow(70)).toBeNull();
		expect(applyRefreshInvalidation).toHaveBeenCalledWith(
			expect.objectContaining({
				changed: true,
				previousRowCount: 100,
				nextRowCount: 70,
				changedStartIndex: 50,
				changedEndIndex: 69,
			}),
			expect.objectContaining({
				invalidationReason: 'viewport',
				requestRenderReason: 'rows:infinite-block-loaded',
			})
		);

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

	it('re-requests an infinite block after stale queued prefetch work is dropped', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let resolveBlock10!: (value: { rows: TestRow[]; totalCount: number }) => void;
		let resolveBlock20!: (value: { rows: TestRow[]; totalCount: number }) => void;
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
			if (params.startRow === 20) {
				return new Promise((resolve) => {
					resolveBlock20 = resolve as typeof resolveBlock20;
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
		expect(controller.getBlockSnapshots()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ blockIndex: 1, state: 'loadingInitial' }),
				expect.objectContaining({ blockIndex: 2, state: 'queued' }),
			])
		);

		controller.loadVisibleBlocks(50, 59);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getBlockSnapshots()).not.toEqual(expect.arrayContaining([expect.objectContaining({ blockIndex: 2, state: 'queued' })]));

		controller.loadVisibleBlocks(20, 29);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(controller.getBlockSnapshots()).toEqual(expect.arrayContaining([expect.objectContaining({ blockIndex: 2, state: 'queued' })]));

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

		expect(controller.getVisualRow(20)?.kind).toBe('data');
		expect(getRowNode(controller, 20)?.data.name).toBe('Row 20');

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
				(params.sortModel as Array<{ sort: string }>)[0]!.sort = 'desc';
			}).toThrow();
			expect(() => {
				(params.filterModel as Record<string, { value: string }>).name.value = 'mutated';
			}).toThrow();
			expect(() => {
				(params.quickFilterModel as { text: string }).text = 'mutated';
			}).toThrow();
			expect(() => {
				((params.queryModel as GridQueryModel).root.children as Array<{ value?: unknown }>)[0]!.value = 'mutated';
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
});

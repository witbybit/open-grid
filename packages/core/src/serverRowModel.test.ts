import { describe, it, expect, vi } from 'vitest';
import { GridEventName, GridStore } from './store.js';
import { InfiniteRowModelController, type InfiniteDatasource } from './infiniteRowModel.js';
import { ServerPageRowModelController } from './serverPageRowModel.js';

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

		expect(controller.getVisualRow(50)).toEqual(
			expect.objectContaining({ kind: 'failed', id: 'failed:50', rowIndex: 50, error: 'block failed' })
		);
		expect(controller.getRowLoadState(50)).toEqual({ kind: 'failed', error: 'block failed', retryable: true });
		expect(controller.isRowFailed(50)).toBe(true);
		expect(controller.getRangeLoadState(49, 51)).toEqual({
			loaded: 0,
			loading: 0,
			failed: 2,
			placeholder: 0,
			missing: 1,
		});
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
			rows: [{ id: '2', name: 'New Block Winner' }],
			totalCount: 4,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		resolveFirst({
			rows: [{ id: '1', name: 'Stale Block Loser' }],
			totalCount: 4,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('New Block Winner');
		expect(store.getRawRowById('1')).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('does not treat a partially populated block as fully loaded', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: {
				getRows: vi.fn().mockResolvedValue({
					rows: [
						{ id: '1', name: 'Alice' },
						{ id: '2', name: 'Bob' },
					],
					totalCount: 4,
				}),
			},
			blockSize: 4,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getVisualRowCount()).toBe(4);
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.getRowLoadState(1)).toEqual({ kind: 'loaded', rowId: '2' });
		expect(controller.getRowLoadState(2)).toEqual({ kind: 'missing' });
		expect(controller.getRowLoadState(3)).toEqual({ kind: 'missing' });
		expect(controller.isRangeLoaded(0, 3)).toBe(false);
		expect(controller.getRangeLoadState(0, 3)).toEqual({
			loaded: 2,
			loading: 0,
			failed: 0,
			placeholder: 0,
			missing: 2,
		});

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
			})
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
						rows: [{ id: '1', name: 'Alice' }],
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
		expect(controller.getRowCountKind()).toBe('unknown');
		expect(controller.getRowLoadState(50)).toEqual({ kind: 'missing' });
		expect(mockDatasource.getRows).toHaveBeenLastCalledWith(expect.objectContaining({ startRow: 0, endRow: 50 }));

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
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loading', reason: 'infinite-block' });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');

		rejectRefresh!(new Error('refresh failed'));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.getRowLoadState(0)).toEqual({ kind: 'failed', error: 'refresh failed', retryable: true });
		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(getRowNode(controller, 0)?.data.name).toBe('Alice v1');
		expect(controller.getVisualIndexByRowId('1')).toBe(0);

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
		expect(controller.getRowLoadState(0)).toEqual({
			kind: 'failed',
			error: 'Infinite datasource returned 2 rows for block size 1',
			retryable: true,
		});
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
		expect(controller.getRowLoadState(0)).toEqual({
			kind: 'failed',
			error: 'Infinite datasource returned duplicate row id "1" within one block',
			retryable: true,
		});
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
						rows: [{ id: '1', name: 'Alice v1' }],
						totalCount: 100,
					});
				}
				return Promise.resolve({
					rows: [{ id: '1', name: 'Alice duplicated elsewhere' }],
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
		expect(controller.getRowLoadState(0)).toEqual({
			kind: 'failed',
			error: 'Infinite datasource returned negative totalCount -1',
			retryable: true,
		});
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
});

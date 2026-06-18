/**
 * Adversarial tests for ServerRowModelController generation handling.
 *
 * Invariant: out-of-order or stale async server responses must never overwrite
 * a newer generation after purge-triggering actions such as sort/filter/page
 * changes or datasource replacement.
 *
 * All sequences are generated with a seeded deterministic LCG. Each seed
 * produces a reproducible request/resolve/reject trace.
 */
import { describe, it, expect, vi } from 'vitest';
import { GridStore } from './store.js';
import { type GetRowsParams, type IGridDatasource, ServerRowModelController } from './serverRowModel.js';

interface TestRow {
	id: string;
	name: string;
}

interface PendingRequest {
	source: string;
	token: string;
	params: GetRowsParams;
	resolve: (value: { rows: TestRow[]; totalCount: number }) => void;
	reject: (error: Error) => void;
}

function makeLcg(seed: number): () => number {
	let s = seed >>> 0;
	return (): number => {
		s = Math.imul(1664525, s) + 1013904223;
		s = s >>> 0;
		return s / 0x100000000;
	};
}

function lcgInt(rng: () => number, max: number): number {
	return Math.floor(rng() * max);
}

function flushAsync(): Promise<void> {
	return Promise.resolve()
		.then(() => undefined)
		.then(() => undefined);
}

function createDeferredDatasource(source: string, getToken: () => string, pending: PendingRequest[]): IGridDatasource<TestRow> {
	return {
		getRows: vi.fn().mockImplementation((params: GetRowsParams) => {
			return new Promise<{ rows: TestRow[]; totalCount: number }>((resolve, reject) => {
				pending.push({
					source,
					token: getToken(),
					params,
					resolve,
					reject,
				});
			});
		}),
	};
}

function loadedNames(controller: ServerRowModelController<TestRow>): string[] {
	const names: string[] = [];
	for (let i = 0; i < controller.getVisualRowCount(); i++) {
		const row = controller.getVisualRow(i);
		if (row?.kind === 'data') {
			names.push(row.node.data.name);
		}
	}
	return names;
}

describe('ServerRowModelController — adversarial generation invariants', () => {
	it('stale responses and stale failures are ignored after sort/filter/datasource/page churn', async () => {
		const rng = makeLcg(0x5eed1234);
		const pending: PendingRequest[] = [];
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let source = 'A';
		let page = 0;
		let sequence = 0;
		let currentToken = `${source}|page=${page}|seq=${sequence}|init`;
		const getToken = () => currentToken;
		const datasourceA = createDeferredDatasource('A', getToken, pending);
		const datasourceB = createDeferredDatasource('B', getToken, pending);
		let activeDatasource = datasourceA;

		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource: activeDatasource,
			blockSize: 4,
			columns: store.getState().columns,
			pagination: { pageSize: 8, initialPage: 0 },
		});

		function bump(reason: string): void {
			sequence++;
			currentToken = `${source}|page=${page}|seq=${sequence}|${reason}`;
		}

		async function resolveRequest(request: PendingRequest): Promise<void> {
			const start = request.params.startRow;
			request.resolve({
				rows: Array.from({ length: 4 }, (_, index) => ({
					id: `${request.token}:${start + index}`,
					name: request.token,
				})),
				totalCount: 18,
			});
			await flushAsync();
		}

		async function rejectRequest(request: PendingRequest): Promise<void> {
			request.reject(new Error(`reject:${request.token}`));
			await flushAsync();
		}

		const initialRequest = pending.shift();
		expect(initialRequest?.token).toBe(currentToken);
		await resolveRequest(initialRequest!);
		expect(store.getState().serverPagination?.pageCount).toBeGreaterThan(1);

		for (let step = 0; step < 40; step++) {
			const op = lcgInt(rng, 6);
			const label = `seed=0x5eed1234,step=${step},op=${op}`;

			if (op === 0) {
				bump('sort');
				const sortMode = sequence % 3;
				store.setSortModel(sortMode === 0 ? null : [{ colId: 'name', sort: sortMode === 1 ? 'asc' : 'desc' }]);
				expect(store.getState().loading, `[${label}] new generation should enter loading`).toBe(true);
				continue;
			}

			if (op === 1) {
				bump('filter');
				store.setFilterModel(
					sequence % 2 === 0
						? null
						: {
								name: {
									type: 'text',
									operator: 'contains',
									value: sequence % 4 === 0 ? 'A' : 'B',
								},
							}
				);
				expect(store.getState().loading, `[${label}] filter purge should enter loading`).toBe(true);
				continue;
			}

			if (op === 2) {
				source = source === 'A' ? 'B' : 'A';
				activeDatasource = source === 'A' ? datasourceA : datasourceB;
				bump('datasource');
				controller.setDatasource(activeDatasource);
				expect(store.getState().loading, `[${label}] datasource switch should enter loading`).toBe(true);
				continue;
			}

			if (op === 3) {
				page = (page + 1) % 3;
				bump('page');
				controller.goToPage(page);
				continue;
			}

			if (pending.length === 0) {
				continue;
			}

			const request = pending.splice(lcgInt(rng, pending.length), 1)[0];
			const faultsBefore = store.getRuntimeFaults().length;
			const isCurrent = request.token === currentToken;

			if (op === 4) {
				await resolveRequest(request);
				const names = loadedNames(controller);

				if (isCurrent) {
					expect(names.length, `[${label}] current response should populate rows`).toBeGreaterThan(0);
					expect(new Set(names), `[${label}] only current generation rows may be visible`).toEqual(new Set([request.token]));
					expect(store.getState().loading, `[${label}] settled current response should clear loading`).toBe(false);
				} else {
					expect(names, `[${label}] stale response must not become visible`).not.toContain(request.token);
					expect(store.getRuntimeFaults().length, `[${label}] stale success must not report faults`).toBe(faultsBefore);
				}
				continue;
			}

			await rejectRequest(request);
			const names = loadedNames(controller);

			if (isCurrent) {
				expect(names, `[${label}] current rejection must not leave stale rows behind`).not.toContain(request.token);
				expect(store.getRuntimeFaults().length, `[${label}] current rejection should report exactly one fault`).toBe(faultsBefore + 1);
			} else {
				expect(names, `[${label}] stale rejection must not mutate visible rows`).not.toContain(request.token);
				expect(store.getRuntimeFaults().length, `[${label}] stale rejection must not report faults`).toBe(faultsBefore);
			}
		}

		bump('final-sort');
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);
		const finalRequest = pending.splice(
			pending.findIndex((request) => request.token === currentToken),
			1
		)[0];
		expect(finalRequest?.token).toBe(currentToken);
		await resolveRequest(finalRequest);

		const finalNames = loadedNames(controller);
		expect(finalNames.length).toBeGreaterThan(0);
		expect(new Set(finalNames)).toEqual(new Set([currentToken]));

		controller.dispose();
		store.destroy();
	});

	it('out-of-order page responses cannot overwrite a newer page generation', async () => {
		const pending: PendingRequest[] = [];
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let currentToken = 'page=0|seq=0|init';
		const datasource = createDeferredDatasource('A', () => currentToken, pending);
		const controller = new ServerRowModelController(store.getServerRowModelRuntime(), {
			datasource,
			blockSize: 3,
			columns: store.getState().columns,
			pagination: { pageSize: 6, initialPage: 0 },
		});

		const initialRequest = pending.shift();
		expect(initialRequest?.token).toBe('page=0|seq=0|init');
		initialRequest!.resolve({
			rows: [
				{ id: 'init-0', name: initialRequest!.token },
				{ id: 'init-1', name: initialRequest!.token },
				{ id: 'init-2', name: initialRequest!.token },
			],
			totalCount: 12,
		});
		await flushAsync();

		currentToken = 'page=1|seq=1|goToPage';
		controller.goToPage(1);

		const stalePage0 = initialRequest;
		const currentPage1 = pending.find((request) => request.token === 'page=1|seq=1|goToPage');
		expect(stalePage0).toBeDefined();
		expect(currentPage1).toBeDefined();

		stalePage0!.resolve({
			rows: [
				{ id: 'stale-0', name: stalePage0!.token },
				{ id: 'stale-1', name: stalePage0!.token },
				{ id: 'stale-2', name: stalePage0!.token },
			],
			totalCount: 12,
		});
		await flushAsync();
		expect(loadedNames(controller)).not.toContain(stalePage0!.token);

		currentPage1!.resolve({
			rows: [
				{ id: 'current-0', name: currentPage1!.token },
				{ id: 'current-1', name: currentPage1!.token },
				{ id: 'current-2', name: currentPage1!.token },
			],
			totalCount: 12,
		});
		await flushAsync();

		expect(new Set(loadedNames(controller))).toEqual(new Set([currentPage1!.token]));
		expect(store.getState().serverPagination?.page).toBe(1);

		controller.dispose();
		store.destroy();
	});
});

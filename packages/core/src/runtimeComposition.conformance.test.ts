// @vitest-environment jsdom
/**
 * Cross-mode runtime-composition conformance matrix.
 *
 * These tests deliberately create the public GridApi first and then mount the
 * real renderer through the private host composition.  Row-model unit tests
 * prove controller state; this suite proves that state reaches the visible
 * pooled slot that users actually see.  The latter is the regression boundary
 * exposed by aa83bdb7.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientGrid, createInfiniteGrid, createServerSideGrid } from './createGrid.js';
import type { GridApi } from './api/GridApi.js';
import { resolveGridRuntimeComposition } from './internal/apiInternalBridge.js';
import { RenderEngine } from './renderer/renderEngine.js';
import type { InfiniteGetRowsParams } from './infiniteRowModel.js';
import type { ServerSideGetRowsRequest } from './serverSideRowModel.js';

interface Row {
	id: string;
	name: string;
}

const COLUMNS = [{ field: 'name', header: 'Name', width: 160 }];

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
	for (let index = 0; index < 5; index++) await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	for (let index = 0; index < 3; index++) await Promise.resolve();
}

type RemoteMode = 'infinite' | 'server';

interface RemoteRequest {
	readonly source: string;
	readonly startRow: number;
	readonly deferred: Deferred<{ rows: Row[]; totalCount?: number; rowCount?: number }>;
}

interface MountedGrid {
	readonly api: GridApi<Row>;
	readonly renderer: RenderEngine<Row>;
	readonly container: HTMLDivElement;
	readonly runtime: {
		ensureRange(startRow: number, endRow: number, reason?: string): void;
		getVisualRow(index: number): { kind: string; id: string } | null;
	};
	destroy(): void;
}

function mount(api: GridApi<Row>): MountedGrid {
	const composition = resolveGridRuntimeComposition(api);
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 480,
		bottom: 240,
		width: 480,
		height: 240,
		toJSON: () => ({}),
	} as DOMRect);
	document.body.appendChild(container);
	const renderer = new RenderEngine<Row>(composition.host.engine, composition.host.api, composition.interactionController);
	renderer.mount(container);
	return {
		api,
		renderer,
		container,
		runtime: composition.host.engine.getRowModel() as unknown as MountedGrid['runtime'],
		destroy: () => {
			renderer.unmount();
			api.destroy();
		},
	};
}

function visibleRowId(grid: MountedGrid, index = 0): string | undefined {
	grid.renderer.fullPaint();
	return grid.container.querySelector<HTMLElement>(`.og-row[data-row-index="${index}"]`)?.dataset.rowId;
}

function visibleCellText(grid: MountedGrid, index = 0): string | undefined {
	grid.renderer.fullPaint();
	return grid.container.querySelector<HTMLElement>(`.og-cell[data-row-index="${index}"][data-col-field="name"]`)?.textContent ?? undefined;
}

function showRow(grid: MountedGrid, index: number): void {
	const viewport = grid.container.querySelector<HTMLDivElement>('.og-scroll-viewport');
	if (viewport) {
		viewport.scrollTop = index * 40;
		viewport.dispatchEvent(new Event('scroll'));
	}
	grid.renderer.fullPaint();
}

function latestRequest(requests: readonly RemoteRequest[], source: string, startRow: number): RemoteRequest {
	const request = [...requests].reverse().find((candidate) => candidate.source === source && candidate.startRow === startRow);
	if (!request) throw new Error(`Missing ${source} request for row ${startRow}`);
	return request;
}

async function stageRepresentedRemoteBlock(grid: MountedGrid, requests: readonly RemoteRequest[], mode: RemoteMode): Promise<RemoteRequest> {
	latestRequest(requests, 'A', 0).deferred.resolve(response(`${mode}-base`, 'base', 4));
	await flushAsync();
	grid.runtime.ensureRange(2, 2, 'conformance-represented-block');
	showRow(grid, 2);
	return latestRequest(requests, 'A', 2);
}

function makeRemote(
	mode: RemoteMode,
	options?: { maxBlocksInCache?: number }
): {
	grid: MountedGrid;
	requests: RemoteRequest[];
	setSource(source: string): void;
} {
	const requests: RemoteRequest[] = [];
	const datasource = (source: string) => ({
		getRows: (request: InfiniteGetRowsParams | ServerSideGetRowsRequest) => {
			const next = deferred<{ rows: Row[]; totalCount?: number; rowCount?: number }>();
			requests.push({ source, startRow: request.startRow, deferred: next });
			return next.promise;
		},
	});
	let source = 'A';
	const first = datasource(source);
	const api =
		mode === 'infinite'
			? createInfiniteGrid<Row>({
					columns: COLUMNS,
					getRowId: (row) => row.id,
					datasource: first,
					blockSize: 2,
					maxConcurrentRequests: 1,
					maxBlocksInCache: options?.maxBlocksInCache,
				})
			: createServerSideGrid<Row>({
					columns: COLUMNS,
					getRowId: (row) => row.id,
					datasource: first,
					blockSize: 2,
					maxConcurrentRequests: 1,
					maxBlocksInCache: options?.maxBlocksInCache,
				});
	return {
		grid: mount(api),
		requests,
		setSource(nextSource: string) {
			source = nextSource;
			const next = datasource(source);
			if (mode === 'infinite') api.setInfiniteDatasource(next, 2);
			else api.setServerSideDatasource(next);
		},
	};
}

function response(id: string, name: string, total = 2): { rows: Row[]; totalCount: number; rowCount: number } {
	return {
		rows: [
			{ id, name },
			{ id: `${id}-next`, name: `${name} next` },
		],
		totalCount: total,
		rowCount: total,
	};
}

const CAPABILITY_NON_PARITY = {
	client: {
		asyncLoading: false,
		initialLoadingSlot: false,
		failureRetry: false,
		hotDatasourceRebind: false,
		cacheEviction: false,
		generationRejection: false,
	},
	infinite: {
		asyncLoading: true,
		// Infinite starts with an unknown row count. A loading slot appears only
		// after a range is represented by a known/estimated count.
		initialLoadingSlot: false,
		failureRetry: true,
		hotDatasourceRebind: true,
		cacheEviction: true,
		generationRejection: true,
	},
	server: {
		asyncLoading: true,
		// SSRM represents its initial root block immediately.
		initialLoadingSlot: true,
		failureRetry: true,
		hotDatasourceRebind: true,
		cacheEviction: true,
		generationRejection: true,
	},
} as const;

describe('runtime composition conformance matrix', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
	});

	it('documents intentional client versus remote capability non-parity at the public boundary', () => {
		const client = createClientGrid<Row>({ columns: COLUMNS, rows: [], getRowId: (row) => row.id });
		for (const [mode, expected] of Object.entries(CAPABILITY_NON_PARITY)) {
			if (mode === 'client') {
				expect(client.getRowModelCapabilities().blockLoading).toBe(expected.asyncLoading);
				continue;
			}
			const remote = makeRemote(mode as RemoteMode);
			expect(remote.grid.api.getRowModelCapabilities().blockLoading).toBe(expected.asyncLoading);
			expect(expected.failureRetry && expected.hotDatasourceRebind && expected.cacheEviction && expected.generationRejection).toBe(true);
			remote.grid.destroy();
		}
		// Client changes are synchronous structural publication, not a fake datasource/cache API.
		expect(CAPABILITY_NON_PARITY.client).toEqual({
			asyncLoading: false,
			initialLoadingSlot: false,
			failureRetry: false,
			hotDatasourceRebind: false,
			cacheEviction: false,
			generationRejection: false,
		});
		client.destroy();
	});

	it('keeps zero-count infinite startup distinct from SSRM initial-block representation', () => {
		const infinite = makeRemote('infinite');
		const server = makeRemote('server');
		expect(infinite.grid.runtime.getVisualRow(0)).toBeNull();
		expect(server.grid.runtime.getVisualRow(0)?.kind).toBe('loading');
		expect(CAPABILITY_NON_PARITY.infinite.initialLoadingSlot).toBe(false);
		expect(CAPABILITY_NON_PARITY.server.initialLoadingSlot).toBe(true);
		infinite.grid.destroy();
		server.grid.destroy();
	});

	it('publishes client structural identity changes through the mounted visible slot', () => {
		const grid = mount(createClientGrid<Row>({ columns: COLUMNS, rows: [{ id: 'client-a', name: 'Client A' }], getRowId: (row) => row.id }));
		expect(visibleRowId(grid)).toBe('row:client-a');
		grid.api.setRows([{ id: 'client-b', name: 'Client B' }]);
		expect(visibleRowId(grid)).toBe('row:client-b');
		expect(visibleCellText(grid)).toContain('Client B');
		grid.destroy();
	});

	it.each(['infinite', 'server'] as const)('%s replaces a visible loading slot with committed data', async (mode) => {
		const { grid, requests } = makeRemote(mode);
		const pending = await stageRepresentedRemoteBlock(grid, requests, mode);
		expect(visibleRowId(grid, 2)).toBe('loading:2');
		expect(grid.runtime.getVisualRow(2)?.kind).toBe('loading');
		pending.deferred.resolve(response(`${mode}-a`, `${mode} A`, 4));
		await flushAsync();
		expect(visibleRowId(grid, 2)).toBe(`row:${mode}-a`);
		expect(visibleCellText(grid, 2)).toContain(`${mode} A`);
		grid.destroy();
	});

	it.each(['infinite', 'server'] as const)('%s preserves a failed visible slot until an explicit retry through the composition', async (mode) => {
		const { grid, requests } = makeRemote(mode);
		const pending = await stageRepresentedRemoteBlock(grid, requests, mode);
		pending.deferred.reject(new Error(`${mode} unavailable`));
		await flushAsync();
		expect(visibleRowId(grid, 2)).toBe('failed:2');
		expect(grid.runtime.getVisualRow(2)?.kind).toBe('failed');
		// This is the same explicit retry authority used by the row-node facade;
		// viewport-render must never be treated as a retry request.
		grid.runtime.ensureRange(2, 2, 'row-node-retry-load');
		latestRequest(requests, 'A', 2).deferred.resolve(response(`${mode}-retry`, `${mode} retry`, 4));
		await flushAsync();
		expect(visibleRowId(grid, 2)).toBe(`row:${mode}-retry`);
		grid.destroy();
	});

	it.each(['infinite', 'server'] as const)(
		'%s drops stale generations during hot datasource rebind and paints only the new source',
		async (mode) => {
			const { grid, requests, setSource } = makeRemote(mode);
			setSource('B');
			latestRequest(requests, 'A', 0).deferred.resolve(response(`${mode}-stale`, 'STALE'));
			await flushAsync();
			expect(visibleRowId(grid)).not.toBe(`row:${mode}-stale`);
			latestRequest(requests, 'B', 0).deferred.resolve(response(`${mode}-fresh`, 'FRESH'));
			await flushAsync();
			expect(visibleRowId(grid)).toBe(`row:${mode}-fresh`);
			expect(visibleCellText(grid)).toContain('FRESH');
			grid.destroy();
		}
	);

	it.each(['infinite', 'server'] as const)('%s evicts then reloads a visible block without leaving a blank slot', async (mode) => {
		const { grid, requests } = makeRemote(mode, { maxBlocksInCache: 1 });
		latestRequest(requests, 'A', 0).deferred.resolve(response(`${mode}-zero`, 'zero', 6));
		await flushAsync();
		grid.runtime.ensureRange(2, 2, 'conformance-evict');
		latestRequest(requests, 'A', 2).deferred.resolve(response(`${mode}-two`, 'two', 6));
		await flushAsync();
		grid.runtime.ensureRange(0, 0, 'conformance-reload');
		expect(visibleRowId(grid)).toBe('loading:0');
		latestRequest(requests, 'A', 0).deferred.resolve(response(`${mode}-zero-reloaded`, 'zero reloaded', 6));
		await flushAsync();
		expect(visibleRowId(grid)).toBe(`row:${mode}-zero-reloaded`);
		grid.destroy();
	});

	it.each(['infinite', 'server'] as const)(
		'%s clears stale selection, focus, and editing identity when async data replaces a row',
		async (mode) => {
			const { grid, requests } = makeRemote(mode);
			requests[0].deferred.resolve(response(`${mode}-before`, 'before'));
			await flushAsync();
			grid.api.selectRows([`${mode}-before`]);
			grid.api.selectCell({ rowId: `${mode}-before`, colField: 'name' });
			grid.api.startEditing(`${mode}-before`, 'name');
			grid.api.setSortModel([{ colId: 'name', sort: 'asc' }]);
			latestRequest(requests, 'A', 0).deferred.resolve(response(`${mode}-after`, 'after'));
			await flushAsync();
			const snapshot = grid.api.getStateSnapshot();
			expect(snapshot.activeEdit).toBeNull();
			expect(snapshot.focusedCell?.rowId).not.toBe(`${mode}-before`);
			expect(grid.api.getSelectedRowIds()).not.toContain(`${mode}-before`);
			expect(visibleRowId(grid)).toBe(`row:${mode}-after`);
			grid.destroy();
		}
	);

	it.each(['client', 'infinite', 'server'] as const)('%s keeps duplicate field columns as distinct renderer identities', async (mode) => {
		const columns = [
			{ field: 'name', colId: 'name-primary', header: 'Primary', width: 120 },
			{ field: 'name', colId: 'name-secondary', header: 'Secondary', width: 120 },
		];
		if (mode === 'client') {
			const grid = mount(createClientGrid<Row>({ columns, rows: [{ id: 'duplicate', name: 'same' }], getRowId: (row) => row.id }));
			expect(grid.container.querySelectorAll('.og-cell[data-row-id="duplicate"][data-col-field="name"]')).toHaveLength(2);
			grid.destroy();
			return;
		}
		const remote = makeRemote(mode);
		remote.grid.api.setColumns(columns);
		remote.requests[0].deferred.resolve(response('duplicate', 'same'));
		await flushAsync();
		remote.grid.renderer.fullPaint();
		expect(remote.grid.container.querySelectorAll('.og-cell[data-row-id="duplicate"][data-col-field="name"]')).toHaveLength(2);
		remote.grid.destroy();
	});

	it.each(['infinite', 'server'] as const)('%s ignores pending request, persistence, and validation work after destroy', async (mode) => {
		const persistence = deferred<null>();
		const { grid, requests } = (() => {
			const pending: RemoteRequest[] = [];
			const datasource = {
				getRows: (request: InfiniteGetRowsParams | ServerSideGetRowsRequest) => {
					const next = deferred<{ rows: Row[]; totalCount?: number; rowCount?: number }>();
					pending.push({ source: 'destroy', startRow: request.startRow, deferred: next });
					return next.promise;
				},
			};
			const options = {
				columns: COLUMNS,
				getRowId: (row: Row) => row.id,
				datasource,
				blockSize: 2,
				persistence: { load: () => persistence.promise, save: () => {}, clear: () => {} },
			};
			const api = mode === 'infinite' ? createInfiniteGrid<Row>(options) : createServerSideGrid<Row>(options);
			return { grid: mount(api), requests: pending };
		})();
		const renderSpy = vi.spyOn(grid.renderer, 'fullPaint');
		grid.destroy();
		requests[0].deferred.resolve(response(`${mode}-late`, 'late'));
		persistence.resolve(null);
		await flushAsync();
		expect(grid.container.querySelector('[data-row-id]')).toBeNull();
		expect(renderSpy).not.toHaveBeenCalled();
	});
});

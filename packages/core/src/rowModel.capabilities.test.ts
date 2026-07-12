/**
 * Adversarial row-model capability tests.
 *
 * Verifies:
 * - Each row model reports correct capabilities
 * - Unsupported public API operations throw UnsupportedRowModelOperationError
 * - Server page loading state is published immediately on fetch start
 * - Infinite block reload clears stale row IDs before inserting new ones
 * - Fast scroll defers visible block loading; scroll settle flushes pending load
 */
import { describe, it, expect, vi } from 'vitest';
import { GridStore } from './store.js';
import { createClientGrid, createInfiniteGrid, createServerPageGrid } from './createGrid.js';
import { UnsupportedRowModelOperationError } from './rowModel.js';
import { InfiniteRowModelController, type InfiniteDatasource } from './infiniteRowModel.js';
import { ServerPageRowModelController, type ServerDatasource } from './serverPageRowModel.js';
import type { ServerSideDatasource } from './serverSideRowModel.js';
import type { ColumnDef } from './columnDef.js';

// ── Shared types ──────────────────────────────────────────────────────────────

interface TestRow {
	id: string;
	name: string;
	amount: number;
}

const COLUMNS: ColumnDef<TestRow>[] = [
	{ field: 'id', header: 'ID' },
	{ field: 'name', header: 'Name' },
	{ field: 'amount', header: 'Amount' },
];

// ── Capability correctness ────────────────────────────────────────────────────

describe('Row model capabilities', () => {
	it('client grid reports correct capabilities', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		const caps = api.getRowModelCapabilities();

		expect(caps.fullDataset).toBe(true);
		expect(caps.clientMutation).toBe(true);
		expect(caps.transactions).toBe(true);
		expect(caps.rowOrder).toBe(true);
		expect(caps.clientSort).toBe(true);
		expect(caps.clientFilter).toBe(true);
		expect(caps.clientGrouping).toBe(true);
		expect(caps.allRowSelection).toBe(true);

		expect(caps.blockLoading).toBe(false);
		expect(caps.serverPagination).toBe(false);
		expect(caps.loadedDataset).toBe(false);
		expect(caps.pagedDataset).toBe(false);
		expect(caps.serverSort).toBe(false);
		expect(caps.serverFilter).toBe(false);

		expect(api.supportsRowModelCapability('clientMutation')).toBe(true);
		expect(api.supportsRowModelCapability('blockLoading')).toBe(false);
		expect(api.supportsRowModelCapability('serverPagination')).toBe(false);

		api.destroy();
	});

	it('infinite grid reports correct capabilities', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		const caps = api.getRowModelCapabilities();

		expect(caps.blockLoading).toBe(true);
		expect(caps.loadedDataset).toBe(true);
		expect(caps.loadedRowSelection).toBe(true);
		expect(caps.serverSort).toBe(true);
		expect(caps.serverFilter).toBe(true);

		expect(caps.fullDataset).toBe(false);
		expect(caps.clientMutation).toBe(false);
		expect(caps.transactions).toBe(false);
		expect(caps.serverPagination).toBe(false);
		expect(caps.allRowSelection).toBe(false);
		expect(caps.pagedDataset).toBe(false);

		expect(api.supportsRowModelCapability('blockLoading')).toBe(true);
		expect(api.supportsRowModelCapability('transactions')).toBe(false);
		expect(api.supportsRowModelCapability('serverPagination')).toBe(false);

		api.destroy();
	});

	it('server grid reports correct capabilities', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		const caps = api.getRowModelCapabilities();

		expect(caps.serverPagination).toBe(true);
		expect(caps.pagedDataset).toBe(true);
		expect(caps.pageRowSelection).toBe(true);
		expect(caps.serverSort).toBe(true);
		expect(caps.serverFilter).toBe(true);

		expect(caps.fullDataset).toBe(false);
		expect(caps.clientMutation).toBe(false);
		expect(caps.transactions).toBe(false);
		expect(caps.blockLoading).toBe(false);
		expect(caps.allRowSelection).toBe(false);
		expect(caps.loadedDataset).toBe(false);

		expect(api.supportsRowModelCapability('serverPagination')).toBe(true);
		expect(api.supportsRowModelCapability('blockLoading')).toBe(false);
		expect(api.supportsRowModelCapability('clientMutation')).toBe(false);

		api.destroy();
	});

	it('supportsRowModelCapability is consistent with getRowModelCapabilities', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		const caps = api.getRowModelCapabilities();
		for (const [key, val] of Object.entries(caps)) {
			expect(api.supportsRowModelCapability(key as Parameters<typeof api.supportsRowModelCapability>[0])).toBe(val);
		}
		api.destroy();
	});

	it('client integrity capabilities are authoritative for dataset-backed scopes', () => {
		const api = createClientGrid({
			rows: [{ id: '1', name: 'Alpha', amount: 1 }],
			columns: COLUMNS,
			getRowId: (r) => r.id,
			dataIntegrity: { validation: true },
		});

		expect(api.integrity.getScopeCapability('allRows')).toMatchObject({ level: 'authoritative', complete: true });
		expect(api.integrity.getScopeCapability('filteredRows')).toMatchObject({ level: 'authoritative', complete: true });
		expect(api.integrity.getScopeCapability('visibleRows')).toMatchObject({ level: 'partial', complete: false });

		api.destroy();
	});

	it('infinite integrity capabilities reject dishonest full-dataset scopes', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
			dataIntegrity: { validation: true },
		});

		expect(api.integrity.getScopeCapability('allRows')).toMatchObject({ level: 'unsupported' });
		expect(api.integrity.getScopeCapability('filteredRows')).toMatchObject({ level: 'unsupported' });
		expect(api.integrity.getScopeCapability('loadedRows')).toMatchObject({ level: 'partial', complete: false });

		api.destroy();
	});

	it('server-page integrity capabilities make currentPage explicit and partial', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
			dataIntegrity: { validation: true },
		});

		expect(api.integrity.getScopeCapability('currentPage')).toMatchObject({ level: 'partial', complete: false });
		expect(api.integrity.getScopeCapability('allRows')).toMatchObject({ level: 'unsupported' });
		expect(api.integrity.getScopeCapability('filteredRows')).toMatchObject({ level: 'unsupported' });

		api.destroy();
	});

	it('infinite row selection scopes are honest about loaded-only selection', async () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			rowSelection: { mode: 'multiple', selectAllScope: 'page' },
			datasource: {
				getRows: vi.fn().mockResolvedValue({
					rows: Array.from({ length: 20 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'Alpha' : index === 1 ? 'Beta' : `Row ${index + 1}`,
						amount: index + 1,
					})),
					totalCount: 20,
				}),
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		api.selectAllRows({ scope: 'page' });
		expect(api.rows().getCheckedIds()).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));

		api.clearRowSelection();
		api.selectAllRows({ scope: 'loaded' });
		expect(api.rows().getCheckedIds()).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));

		api.clearRowSelection();
		api.selectAllRows({ scope: 'all' });
		expect(api.rows().getCheckedIds()).toEqual([]);

		api.selectAllRows({ scope: 'filtered' });
		expect(api.rows().getCheckedIds()).toEqual([]);

		api.destroy();
	});

	it('server-page row selection scopes are honest about current-page-only selection', async () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			rowSelection: { mode: 'multiple', selectAllScope: 'page' },
			datasource: {
				getPage: vi.fn().mockResolvedValue({
					rows: Array.from({ length: 10 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'Alpha' : index === 1 ? 'Beta' : `Row ${index + 1}`,
						amount: index + 1,
					})),
					totalRowCount: 20,
				}),
			},
			pagination: { pageSize: 10 },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		api.selectAllRows({ scope: 'page' });
		expect(api.rows().getCheckedIds()).toEqual(Array.from({ length: 10 }, (_, index) => String(index + 1)));

		api.clearRowSelection();
		api.selectAllRows({ scope: 'loaded' });
		expect(api.rows().getCheckedIds()).toEqual(Array.from({ length: 10 }, (_, index) => String(index + 1)));

		api.clearRowSelection();
		api.selectAllRows({ scope: 'all' });
		expect(api.rows().getCheckedIds()).toEqual([]);

		api.selectAllRows({ scope: 'filtered' });
		expect(api.rows().getCheckedIds()).toEqual([]);

		api.destroy();
	});
});

// ── Unsupported operation errors ──────────────────────────────────────────────

describe('Unsupported row model operations — client grid', () => {
	it('purgeCache throws UnsupportedRowModelOperationError', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.purgeCache()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('goToServerPage throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.goToServerPage(1)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('nextServerPage throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.nextServerPage()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('previousServerPage throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.previousServerPage()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setServerPageSize throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.setServerPageSize(20)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('refreshServerPage throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.refreshServerPage()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setInfiniteDatasource throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		const ds: InfiniteDatasource<TestRow> = { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) };
		expect(() => api.setInfiniteDatasource(ds)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setServerPageDatasource throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		const ds: ServerDatasource<TestRow> = { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) };
		expect(() => api.setServerPageDatasource(ds)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setServerSideDatasource throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		const ds: ServerSideDatasource<TestRow> = { getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
		expect(() => api.setServerSideDatasource(ds)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('refreshServerSide throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.refreshServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('purgeServerSide throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.purgeServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('getServerSideStoreState throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.getServerSideStoreState()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setRows on client succeeds (baseline)', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.setRows([{ id: '1', name: 'Alice', amount: 1 }])).not.toThrow();
		api.destroy();
	});
});

describe('Unsupported row model operations — infinite grid', () => {
	it('goToServerPage throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.goToServerPage(1)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('nextServerPage throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.nextServerPage()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setServerPageDatasource throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		const ds: ServerDatasource<TestRow> = { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) };
		expect(() => api.setServerPageDatasource(ds)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setServerSideDatasource throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		const ds: ServerSideDatasource<TestRow> = { getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
		expect(() => api.setServerSideDatasource(ds)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('refreshServerSide throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.refreshServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('purgeServerSide throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.purgeServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('getServerSideStoreState throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.getServerSideStoreState()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setRows throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.setRows([{ id: '1', name: 'x', amount: 0 }])).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('updateRows throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.updateRows((r) => r)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});
});

describe('Unsupported row model operations — server grid', () => {
	it('purgeCache throws', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		expect(() => api.purgeCache()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setInfiniteDatasource throws', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		const ds: InfiniteDatasource<TestRow> = { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) };
		expect(() => api.setInfiniteDatasource(ds)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setServerSideDatasource throws', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		const ds: ServerSideDatasource<TestRow> = { getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
		expect(() => api.setServerSideDatasource(ds)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('refreshServerSide throws', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		expect(() => api.refreshServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('purgeServerSide throws', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		expect(() => api.purgeServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('getServerSideStoreState throws', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		expect(() => api.getServerSideStoreState()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setRows throws', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		expect(() => api.setRows([{ id: '1', name: 'x', amount: 0 }])).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('updateRows throws', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		expect(() => api.updateRows((r) => r)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});
});

describe('UnsupportedRowModelOperationError shape', () => {
	it('carries operation name, rowModelType, and supportedRowModels', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		let caught: unknown;
		try {
			api.purgeCache();
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(UnsupportedRowModelOperationError);
		const err = caught as UnsupportedRowModelOperationError;
		expect(err.operation).toBe('purgeCache');
		expect(err.rowModelType).toBe('client');
		expect(Array.isArray(err.supportedRowModels)).toBe(true);
		expect(err.supportedRowModels).toContain('infinite');
		expect(err.message).toMatch(/purgeCache/);
		expect(err.message).toMatch(/client/);
		api.destroy();
	});

	it('goToServerPage error names correct supported models', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		let caught: unknown;
		try {
			api.goToServerPage(2);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(UnsupportedRowModelOperationError);
		const err = caught as UnsupportedRowModelOperationError;
		expect(err.operation).toBe('goToServerPage');
		expect(err.rowModelType).toBe('infinite');
		expect(err.supportedRowModels).toContain('server');
		api.destroy();
	});

	it('is instanceof Error', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		let caught: unknown;
		try {
			api.purgeCache();
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(Error);
		api.destroy();
	});

	it('setServerSideDatasource error names SSRM support honestly', () => {
		const api = createServerPageGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getPage: vi.fn().mockResolvedValue({ rows: [], totalRowCount: 0 }) },
			pagination: { pageSize: 10 },
		});
		let caught: unknown;
		try {
			api.setServerSideDatasource({ getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) });
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(UnsupportedRowModelOperationError);
		const err = caught as UnsupportedRowModelOperationError;
		expect(err.operation).toBe('setServerSideDatasource');
		expect(err.rowModelType).toBe('server');
		expect(err.supportedRowModels).toEqual(['server (SSRM)']);
		api.destroy();
	});
});

// ── Server page loading state ─────────────────────────────────────────────────

describe('Server page loading state publication', () => {
	it('loading is true immediately after fetch starts, false after success', async () => {
		let resolveGetPage!: (v: { rows: TestRow[]; totalRowCount: number }) => void;
		const blockedGetPage = vi.fn(
			() =>
				new Promise<{ rows: TestRow[]; totalRowCount: number }>((res) => {
					resolveGetPage = res;
				})
		);

		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage: blockedGetPage },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		// loading: true must be published synchronously before any await
		const loadingState = store.getServerPageState();
		expect(loadingState).not.toBeNull();
		expect(loadingState!.loading).toBe(true);

		resolveGetPage({ rows: [{ id: '1', name: 'Alice', amount: 100 }], totalRowCount: 1 });
		await new Promise((res) => setTimeout(res, 0));

		const completedState = store.getServerPageState();
		expect(completedState!.loading).toBe(false);
		expect(completedState!.error).toBeNull();
		expect(completedState!.totalRowCount).toBe(1);

		ctrl.dispose();
	});

	it('loading is false and error is populated after fetch failure', async () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage: vi.fn().mockRejectedValue(new Error('network failure')) },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		expect(store.getServerPageState()!.loading).toBe(true);

		await new Promise((res) => setTimeout(res, 0));

		const failedState = store.getServerPageState();
		expect(failedState!.loading).toBe(false);
		expect(failedState!.error).toBe('network failure');

		ctrl.dispose();
	});

	it('page navigation sets loading: true immediately', async () => {
		let resolveSecond!: (v: { rows: TestRow[]; totalRowCount: number }) => void;
		let callCount = 0;
		const getPage = vi.fn(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: Array.from({ length: 5 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'A' : `Row ${index + 1}`,
						amount: index,
					})),
					totalRowCount: 10,
				});
			}
			return new Promise<{ rows: TestRow[]; totalRowCount: number }>((res) => {
				resolveSecond = res;
			});
		});

		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		await new Promise((res) => setTimeout(res, 0));
		expect(store.getServerPageState()!.loading).toBe(false);

		ctrl.goToPage(2);

		// loading must be true before the second fetch completes
		expect(store.getServerPageState()!.loading).toBe(true);

		resolveSecond!({
			rows: Array.from({ length: 5 }, (_, index) => ({
				id: String(index + 6),
				name: index === 0 ? 'B' : `Page Two ${index + 6}`,
				amount: index,
			})),
			totalRowCount: 10,
		});
		await new Promise((res) => setTimeout(res, 0));
		expect(store.getServerPageState()!.loading).toBe(false);

		ctrl.dispose();
	});

	it('page navigation clears stale page rows immediately and exposes loading placeholders until the new page resolves', async () => {
		let resolveSecond!: (v: { rows: TestRow[]; totalRowCount: number }) => void;
		let callCount = 0;
		const getPage = vi.fn(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: Array.from({ length: 5 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'Alice' : index === 1 ? 'Bob' : `Row ${index + 1}`,
						amount: (index + 1) * 100,
					})),
					totalRowCount: 10,
				});
			}
			return new Promise<{ rows: TestRow[]; totalRowCount: number }>((res) => {
				resolveSecond = res;
			});
		});

		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		await new Promise((res) => setTimeout(res, 0));
		expect(ctrl.getVisualRow(0)?.kind).toBe('data');
		expect(ctrl.getVisualIndexByRowId('1')).toBe(0);

		ctrl.goToPage(1);

		expect(store.getServerPageState()!.loading).toBe(true);
		expect(ctrl.getVisualIndexByRowId('1')).toBe(-1);
		expect(ctrl.getVisualRowCount()).toBe(5);
		expect(ctrl.getVisualRow(0)).toEqual(
			expect.objectContaining({
				kind: 'loading',
				id: 'loading:0',
				rowIndex: 0,
			})
		);

		resolveSecond!({
			rows: Array.from({ length: 5 }, (_, index) => ({
				id: String(index + 6),
				name: index === 0 ? 'Page Two' : `Page Two ${index + 6}`,
				amount: (index + 6) * 100,
			})),
			totalRowCount: 10,
		});
		await new Promise((res) => setTimeout(res, 0));

		expect(store.getServerPageState()!.loading).toBe(false);
		expect(ctrl.getVisualIndexByRowId('6')).toBe(0);
		expect(ctrl.getVisualRow(0)?.kind).toBe('data');

		ctrl.dispose();
	});

	it('implements the viewport/load-state contract for server-page rows', async () => {
		let rejectReload!: (error: unknown) => void;
		let callCount = 0;
		const getPage = vi.fn(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: Array.from({ length: 5 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'Alice' : `Row ${index + 1}`,
						amount: (index + 1) * 100,
					})),
					totalRowCount: 10,
				});
			}
			return new Promise((_, reject) => {
				rejectReload = reject;
			});
		});

		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		await new Promise((res) => setTimeout(res, 0));

		expect(ctrl.getKnownRowCount()).toBe(5);
		expect(ctrl.getEstimatedRowCount()).toBe(5);
		expect(ctrl.getRowCountKind()).toBe('known');
		expect(ctrl.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(ctrl.isRangeLoaded(0, 0)).toBe(true);

		ctrl.goToPage(1);
		expect(ctrl.getRowCountKind()).toBe('estimated');
		expect(ctrl.getKnownRowCount()).toBeNull();
		expect(ctrl.getRowLoadState(0)).toEqual({ kind: 'loading', reason: 'server-page' });
		expect(ctrl.getRangeLoadState(0, 1)).toEqual({
			loaded: 0,
			loading: 2,
			failed: 0,
			placeholder: 0,
			missing: 0,
		});

		rejectReload!(new Error('page failed'));
		await new Promise((res) => setTimeout(res, 0));

		expect(ctrl.getVisualRow(0)).toEqual(expect.objectContaining({ kind: 'failed', id: 'failed:0', rowIndex: 0, error: 'page failed' }));
		expect(ctrl.getRowLoadState(0)).toEqual({ kind: 'failed', error: 'page failed', retryable: true });
		expect(ctrl.isRowFailed(0)).toBe(true);
		expect(ctrl.getRangeLoadState(0, 1)).toEqual({
			loaded: 0,
			loading: 0,
			failed: 2,
			placeholder: 0,
			missing: 0,
		});

		ctrl.dispose();
	});

	it('ignores a stale older server-page request when a newer same-page request wins by requestId', async () => {
		let resolveFirst!: (value: { rows: TestRow[]; totalRowCount: number }) => void;
		let resolveSecond!: (value: { rows: TestRow[]; totalRowCount: number }) => void;
		let callCount = 0;
		const getPage = vi.fn().mockImplementation(() => {
			callCount++;
			return new Promise((resolve) => {
				if (callCount === 1) resolveFirst = resolve as typeof resolveFirst;
				else resolveSecond = resolve as typeof resolveSecond;
			});
		});

		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		ctrl.reloadPage('retry');

		resolveSecond!({
			rows: Array.from({ length: 5 }, (_, index) => ({
				id: String(index + 6),
				name: index === 0 ? 'New Page Winner' : `Fresh Page ${index + 6}`,
				amount: (index + 6) * 100,
			})),
			totalRowCount: 5,
		});
		await new Promise((res) => setTimeout(res, 0));

		resolveFirst!({
			rows: Array.from({ length: 5 }, (_, index) => ({
				id: String(index + 1),
				name: index === 0 ? 'Stale Page Loser' : `Stale Page ${index + 1}`,
				amount: (index + 1) * 100,
			})),
			totalRowCount: 5,
		});
		await new Promise((res) => setTimeout(res, 0));

		expect(ctrl.getVisualRow(0)?.kind).toBe('data');
		expect(ctrl.getVisualRow(0)?.kind === 'data' ? ctrl.getVisualRow(0)?.node.data.name : null).toBe('New Page Winner');
		expect(store.getRawRowById('1')).toBeNull();

		ctrl.dispose();
	});

	it('server-page ensureRange does not reload the current loaded page on viewport-render checks', async () => {
		const getPage = vi.fn().mockResolvedValue({
			rows: Array.from({ length: 5 }, (_, index) => ({
				id: String(index + 1),
				name: index === 0 ? 'Alice' : `Row ${index + 1}`,
				amount: (index + 1) * 100,
			})),
			totalRowCount: 5,
		});

		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		await new Promise((res) => setTimeout(res, 0));
		expect(getPage).toHaveBeenCalledTimes(1);

		ctrl.ensureRange(0, 0, 'viewport-render');
		ctrl.ensureRange(0, 0, 'viewport-render');
		ctrl.ensureRange(0, 0, 'viewport-render');

		expect(getPage).toHaveBeenCalledTimes(1);

		ctrl.dispose();
	});

	it('page navigation clears stale focus, range, and active edit state when the edited row leaves the active page', async () => {
		let resolveSecond!: (v: { rows: TestRow[]; totalRowCount: number }) => void;
		let callCount = 0;
		const getPage = vi.fn(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: Array.from({ length: 5 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'Alice' : index === 1 ? 'Bob' : `Row ${index + 1}`,
						amount: (index + 1) * 100,
					})),
					totalRowCount: 10,
				});
			}
			return new Promise<{ rows: TestRow[]; totalRowCount: number }>((res) => {
				resolveSecond = res;
			});
		});

		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		await new Promise((res) => setTimeout(res, 0));

		store.selectRange({ rowId: '1', colField: 'name' }, { rowId: '2', colField: 'amount' });
		store.startEditing('1', 'name');
		expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: '2', colField: 'amount' }));
		expect(store.getState().selection.anchor).toEqual(expect.objectContaining({ rowId: '1', colField: 'name' }));
		expect(store.getState().activeEdit).toEqual(expect.objectContaining({ rowId: '1', colField: 'name' }));

		ctrl.goToPage(1);

		expect(store.getState().selection.focus).toBeNull();
		expect(store.getState().selection.anchor).toBeNull();
		expect(store.getState().selection.range).toBeNull();
		expect(store.getState().selection.bounds).toBeNull();
		expect(store.getState().activeEdit).toBeNull();

		resolveSecond!({
			rows: Array.from({ length: 5 }, (_, index) => ({
				id: String(index + 6),
				name: index === 0 ? 'Page Two' : `Page Two ${index + 6}`,
				amount: (index + 6) * 100,
			})),
			totalRowCount: 10,
		});
		await new Promise((res) => setTimeout(res, 0));

		ctrl.dispose();
	});

	it('page navigation prunes selectedRowIds to the active page scope immediately', async () => {
		let resolveSecond!: (v: { rows: TestRow[]; totalRowCount: number }) => void;
		let callCount = 0;
		const getPage = vi.fn(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: Array.from({ length: 5 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'Alice' : index === 1 ? 'Bob' : `Row ${index + 1}`,
						amount: (index + 1) * 100,
					})),
					totalRowCount: 10,
				});
			}
			return new Promise<{ rows: TestRow[]; totalRowCount: number }>((res) => {
				resolveSecond = res;
			});
		});

		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		await new Promise((res) => setTimeout(res, 0));

		store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1', '2'], source: 'api' });
		expect(store.getState().selectedRowIds).toEqual(['1', '2']);

		ctrl.goToPage(1);

		expect(store.getState().selectedRowIds).toEqual([]);

		resolveSecond!({
			rows: Array.from({ length: 5 }, (_, index) => ({
				id: String(index + 6),
				name: index === 0 ? 'Page Two' : `Page Two ${index + 6}`,
				amount: (index + 6) * 100,
			})),
			totalRowCount: 10,
		});
		await new Promise((res) => setTimeout(res, 0));

		ctrl.dispose();
	});

	it('rejects stale server-page writes consistently after the target row leaves the active page', async () => {
		let resolveSecond!: (v: { rows: TestRow[]; totalRowCount: number }) => void;
		let callCount = 0;
		const getPage = vi.fn(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					rows: Array.from({ length: 5 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'Alice' : `Row ${index + 1}`,
						amount: (index + 1) * 100,
					})),
					totalRowCount: 10,
				});
			}
			return new Promise<{ rows: TestRow[]; totalRowCount: number }>((res) => {
				resolveSecond = res;
			});
		});

		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const ctrl = new ServerPageRowModelController(store.getServerPageRowModelRuntime(), {
			datasource: { getPage },
			columns: COLUMNS,
			pagination: { pageSize: 5 },
		});

		await new Promise((res) => setTimeout(res, 0));
		ctrl.goToPage(1);

		const single = store.setCellValue('1', 'name', 'Gone');
		expect(single).toEqual({
			status: 'rejected',
			reason: 'row unavailable',
			rejections: [{ mutationKind: 'cell-value', reason: 'row unavailable', index: undefined }],
		});

		const batch = store.batchCellValues([
			{ rowId: '1', colField: 'name', value: 'Gone' },
			{ rowId: '2', colField: 'amount', value: 200 },
		]);
		expect(batch).toEqual({
			status: 'rejected',
			reason: 'row unavailable',
			rejections: [{ mutationKind: 'batch-cell', reason: 'row unavailable', index: 0 }],
		});

		resolveSecond!({
			rows: Array.from({ length: 5 }, (_, index) => ({
				id: String(index + 6),
				name: index === 0 ? 'Page Two' : `Page Two ${index + 6}`,
				amount: (index + 6) * 100,
			})),
			totalRowCount: 10,
		});
		await new Promise((res) => setTimeout(res, 0));

		ctrl.dispose();
	});
});

// ── Infinite block stale row map cleanup ──────────────────────────────────────

describe('Infinite block reload — stale row map cleanup', () => {
	it('setDatasource clears old row IDs before inserting new ones', async () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

		const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: {
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [
						{ id: 'A', name: 'Alice', amount: 1 },
						{ id: 'B', name: 'Bob', amount: 2 },
					],
					totalCount: 2,
				}),
			},
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((res) => setTimeout(res, 0));

		expect(ctrl.getRowNodeById('A')).not.toBeNull();
		expect(ctrl.getRowNodeById('B')).not.toBeNull();
		expect(ctrl.getVisualIndexByRowId('A')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('B')).toBe(1);

		// Replace datasource with different row IDs — triggers purgeCache internally
		ctrl.setDatasource({
			getRows: vi.fn().mockResolvedValueOnce({
				rows: [
					{ id: 'C', name: 'Carol', amount: 3 },
					{ id: 'D', name: 'Dave', amount: 4 },
				],
				totalCount: 2,
			}),
		});

		await new Promise((res) => setTimeout(res, 0));

		// Stale IDs must be absent
		expect(ctrl.getRowNodeById('A')).toBeNull();
		expect(ctrl.getRowNodeById('B')).toBeNull();
		expect(ctrl.getVisualIndexByRowId('A')).toBe(-1);
		expect(ctrl.getVisualIndexByRowId('B')).toBe(-1);

		// New IDs must be present at correct indices
		expect(ctrl.getRowNodeById('C')).not.toBeNull();
		expect(ctrl.getRowNodeById('D')).not.toBeNull();
		expect(ctrl.getVisualIndexByRowId('C')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('D')).toBe(1);

		ctrl.dispose();
	});

	it('reload with same row IDs does not produce duplicate entries', async () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

		const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: {
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [
						{ id: 'X', name: 'Xavier', amount: 10 },
						{ id: 'Y', name: 'Yara', amount: 20 },
					],
					totalCount: 2,
				}),
			},
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((res) => setTimeout(res, 0));

		// Reload same IDs with updated data
		ctrl.setDatasource({
			getRows: vi.fn().mockResolvedValueOnce({
				rows: [
					{ id: 'X', name: 'Xavier Updated', amount: 10 },
					{ id: 'Y', name: 'Yara Updated', amount: 20 },
				],
				totalCount: 2,
			}),
		});

		await new Promise((res) => setTimeout(res, 0));

		// Each ID maps to exactly one canonical index
		expect(ctrl.getVisualIndexByRowId('X')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('Y')).toBe(1);

		const nodeX = ctrl.getRowNodeById('X');
		expect(nodeX?.data.name).toBe('Xavier Updated');

		ctrl.dispose();
	});

	it('setDatasource clears stale focus, range, and active edit state when loaded rows disappear', async () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

		const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: {
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [
						{ id: 'A', name: 'Alice', amount: 1 },
						{ id: 'B', name: 'Bob', amount: 2 },
					],
					totalCount: 2,
				}),
			},
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((res) => setTimeout(res, 0));

		store.selectRange({ rowId: 'A', colField: 'name' }, { rowId: 'B', colField: 'amount' });
		store.startEditing('A', 'name');
		expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: 'B', colField: 'amount' }));
		expect(store.getState().selection.anchor).toEqual(expect.objectContaining({ rowId: 'A', colField: 'name' }));
		expect(store.getState().activeEdit).toEqual(expect.objectContaining({ rowId: 'A', colField: 'name' }));

		ctrl.setDatasource({
			getRows: vi.fn().mockResolvedValueOnce({
				rows: [{ id: 'C', name: 'Carol', amount: 3 }],
				totalCount: 1,
			}),
		});

		expect(store.getState().selection.focus).toBeNull();
		expect(store.getState().selection.anchor).toBeNull();
		expect(store.getState().selection.range).toBeNull();
		expect(store.getState().selection.bounds).toBeNull();
		expect(store.getState().activeEdit).toBeNull();

		await new Promise((res) => setTimeout(res, 0));
		ctrl.dispose();
	});

	it('setDatasource prunes selectedRowIds to loaded-row scope immediately', async () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

		const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: {
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [
						{ id: 'A', name: 'Alice', amount: 1 },
						{ id: 'B', name: 'Bob', amount: 2 },
					],
					totalCount: 2,
				}),
			},
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((res) => setTimeout(res, 0));

		store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['A', 'B'], source: 'api' });
		expect(store.getState().selectedRowIds).toEqual(['A', 'B']);

		ctrl.setDatasource({
			getRows: vi.fn().mockResolvedValueOnce({
				rows: [{ id: 'C', name: 'Carol', amount: 3 }],
				totalCount: 1,
			}),
		});

		expect(store.getState().selectedRowIds).toEqual([]);

		await new Promise((res) => setTimeout(res, 0));
		ctrl.dispose();
	});

	it('rejects stale infinite writes consistently after loaded rows are purged', async () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

		const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: {
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [{ id: 'A', name: 'Alice', amount: 1 }],
					totalCount: 1,
				}),
			},
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((res) => setTimeout(res, 0));

		ctrl.setDatasource({
			getRows: vi.fn().mockResolvedValueOnce({
				rows: [{ id: 'C', name: 'Carol', amount: 3 }],
				totalCount: 1,
			}),
		});

		const single = store.setCellValue('A', 'name', 'Gone');
		expect(single).toEqual({
			status: 'rejected',
			reason: 'row unavailable',
			rejections: [{ mutationKind: 'cell-value', reason: 'row unavailable', index: undefined }],
		});

		const batch = store.batchCellValues([
			{ rowId: 'A', colField: 'name', value: 'Gone' },
			{ rowId: 'B', colField: 'amount', value: 2 },
		]);
		expect(batch).toEqual({
			status: 'rejected',
			reason: 'row unavailable',
			rejections: [{ mutationKind: 'batch-cell', reason: 'row unavailable', index: 0 }],
		});

		await new Promise((res) => setTimeout(res, 0));
		ctrl.dispose();
	});
});

// ── Fast scroll deferred visible block loading ────────────────────────────────

describe('Fast scroll deferred block loading', () => {
	it('does not fetch during fast scroll, fetches after scroll settles (210ms)', async () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const getRows = vi.fn().mockResolvedValue({ rows: [], totalCount: 100 });
		const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		// Let constructor auto-fetch block 0 complete
		await new Promise((res) => setTimeout(res, 0));
		getRows.mockClear();

		// Simulate fast scroll: 600px displacement in 100ms = 6 px/ms (threshold is 5).
		// The first call must differ from the default (0,0) so it isn't a no-op; only
		// the second call computes velocity (first call has no prior timestamp).
		const t0 = performance.now();
		store.engine.viewport.setScrollPosition(100, 0, t0 - 100);
		store.engine.viewport.setScrollPosition(700, 0, t0);
		expect(store.engine.viewport.isScrollingFast).toBe(true);

		// loadVisibleBlocks during fast scroll — must defer, not fetch
		ctrl.loadVisibleBlocks(20, 29);
		await new Promise((res) => setTimeout(res, 0));
		expect(getRows).not.toHaveBeenCalled();

		// Wait for time-based velocity decay (>200ms since last scroll event)
		await new Promise((res) => setTimeout(res, 210));
		expect(store.engine.viewport.isScrollingFast).toBe(false);

		// Next loadVisibleBlocks call flushes the pending deferred range
		ctrl.loadVisibleBlocks(20, 29);
		await new Promise((res) => setTimeout(res, 0));
		expect(getRows).toHaveBeenCalledWith(
			expect.objectContaining({ startRow: 20, endRow: 30 }),
			expect.objectContaining({ signal: expect.any(Object) })
		);

		ctrl.dispose();
	});

	it('flush-time range merges with the deferred pending range', async () => {
		// pendingVisibleLoad stores only the LAST deferred range (last-write-wins during
		// fast scroll). At flush time, effectiveRange = union(pending, flushRange), so the
		// current viewport AND the last deferred position are both covered.
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
		const getRows = vi.fn().mockResolvedValue({ rows: [], totalCount: 100 });
		const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows },
			blockSize: 10,
			columns: store.getState().columns,
		});

		await new Promise((res) => setTimeout(res, 0));
		getRows.mockClear();

		// Fast scroll (non-zero start so first call isn't a no-op)
		const t0 = performance.now();
		store.engine.viewport.setScrollPosition(100, 0, t0 - 100);
		store.engine.viewport.setScrollPosition(700, 0, t0);

		// Defer ONE range (10–19) while fast-scrolling — this becomes pendingVisibleLoad
		ctrl.loadVisibleBlocks(10, 19);
		await new Promise((res) => setTimeout(res, 0));
		expect(getRows).not.toHaveBeenCalled();

		// Settle, then flush with the NEW viewport position (30–39)
		// effectiveStart = min(30, 10) = 10, effectiveEnd = max(39, 19) = 39
		await new Promise((res) => setTimeout(res, 210));
		ctrl.loadVisibleBlocks(30, 39);
		await new Promise((res) => setTimeout(res, 0));

		// The merged flush must span rows 10–39
		const requested = getRows.mock.calls.map((c) => c[0] as { startRow: number; endRow: number });
		const minStart = Math.min(...requested.map((r) => r.startRow));
		const maxEnd = Math.max(...requested.map((r) => r.endRow));
		expect(minStart).toBeLessThanOrEqual(10);
		expect(maxEnd).toBeGreaterThanOrEqual(39);

		ctrl.dispose();
	});
});

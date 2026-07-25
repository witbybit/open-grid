import { describe, expect, it } from 'vitest';
import { createServerSideGetRowsRequest, resolveServerSideRowCountState } from './serverSideRowModel.js';
import type { ServerSideRowGroupColumn, ServerSideValueColumn } from './serverSideRowModel.js';

describe('serverSideRowModel request factory', () => {
	it('creates immutable root request defaults', () => {
		const request = createServerSideGetRowsRequest({
			startRow: 0,
			endRow: 100,
		});

		expect(request).toEqual({
			startRow: 0,
			endRow: 100,
			route: [],
			groupKeys: [],
			rowGroupColumns: [],
			valueColumns: [],
			sortModel: null,
			filterModel: null,
			quickFilterModel: null,
			queryModel: null,
		});
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(request.route)).toBe(true);
		expect(Object.isFrozen(request.groupKeys)).toBe(true);
		expect(Object.isFrozen(request.rowGroupColumns)).toBe(true);
		expect(Object.isFrozen(request.valueColumns)).toBe(true);
		expect(() => (request.route as string[]).push('region')).toThrow();
	});

	it('clones route, group keys, and column metadata before datasource ownership', () => {
		const route = ['emea'];
		const groupKeys = ['emea'];
		const rowGroupColumns: ServerSideRowGroupColumn[] = [{ colId: 'region', field: 'region' }];
		const valueColumns: ServerSideValueColumn[] = [{ colId: 'amount', field: 'amount', aggFunc: 'sum' }];

		const request = createServerSideGetRowsRequest({
			startRow: 25,
			endRow: 50,
			route,
			groupKeys,
			rowGroupColumns,
			valueColumns,
		});

		route.push('mutated');
		groupKeys.push('mutated');
		rowGroupColumns[0] = { colId: 'customer' };
		valueColumns[0] = { colId: 'quantity' };

		expect(request.route).toEqual(['emea']);
		expect(request.groupKeys).toEqual(['emea']);
		expect(request.rowGroupColumns).toEqual([{ colId: 'region', field: 'region' }]);
		expect(request.valueColumns).toEqual([{ colId: 'amount', field: 'amount', aggFunc: 'sum' }]);
		expect(Object.isFrozen(request.rowGroupColumns[0])).toBe(true);
		expect(Object.isFrozen(request.valueColumns[0])).toBe(true);
		expect(() => ((request.rowGroupColumns[0] as { colId: string }).colId = 'mutated')).toThrow();
	});

	it('uses the route as default group keys for child-store requests', () => {
		const request = createServerSideGetRowsRequest({
			startRow: 0,
			endRow: 10,
			route: ['region', 'EMEA'],
		});

		expect(request.route).toEqual(['region', 'EMEA']);
		expect(request.groupKeys).toEqual(['region', 'EMEA']);
		expect(request.groupKeys).not.toBe(request.route);
	});

	it('rejects invalid block ranges', () => {
		expect(() => createServerSideGetRowsRequest({ startRow: -1, endRow: 10 })).toThrow(
			'Invalid server-side request startRow: -1'
		);
		expect(() => createServerSideGetRowsRequest({ startRow: 10.5, endRow: 20 })).toThrow(
			'Invalid server-side request startRow: 10.5'
		);
		expect(() => createServerSideGetRowsRequest({ startRow: 20, endRow: 10 })).toThrow(
			'Invalid server-side request endRow: 10'
		);
		expect(() => createServerSideGetRowsRequest({ startRow: 0, endRow: 10.5 })).toThrow(
			'Invalid server-side request endRow: 10.5'
		);
	});
});

describe('serverSideRowModel row-count state', () => {
	it('returns known empty when the datasource returns a zero-row short block', () => {
		expect(resolveServerSideRowCountState({ startRow: 0, endRow: 100, returnedRowCount: 0 })).toEqual({
			kind: 'known',
			count: 0,
		});
	});

	it('returns estimated while full blocks imply more rows may exist', () => {
		expect(resolveServerSideRowCountState({ startRow: 0, endRow: 100, returnedRowCount: 100 })).toEqual({
			kind: 'estimated',
			count: 100,
		});
		expect(resolveServerSideRowCountState({ startRow: 100, endRow: 200, returnedRowCount: 100, hasMore: true })).toEqual({
			kind: 'estimated',
			count: 201,
		});
	});

	it('returns known counts from rowCount, lastRow, hasMore false, and short blocks', () => {
		expect(resolveServerSideRowCountState({ startRow: 0, endRow: 100, returnedRowCount: 100, rowCount: 350 })).toEqual({
			kind: 'known',
			count: 350,
		});
		expect(resolveServerSideRowCountState({ startRow: 100, endRow: 200, returnedRowCount: 100, lastRow: 225 })).toEqual({
			kind: 'known',
			count: 225,
		});
		expect(resolveServerSideRowCountState({ startRow: 200, endRow: 300, returnedRowCount: 25, hasMore: false })).toEqual({
			kind: 'known',
			count: 225,
		});
		expect(resolveServerSideRowCountState({ startRow: 200, endRow: 300, returnedRowCount: 25 })).toEqual({
			kind: 'known',
			count: 225,
		});
	});

	it('rejects contradictory terminal metadata', () => {
		expect(() =>
			resolveServerSideRowCountState({ startRow: 0, endRow: 100, returnedRowCount: 100, rowCount: 150, lastRow: 151 })
		).toThrow('Server-side datasource returned conflicting rowCount 150 and lastRow 151');
		expect(() =>
			resolveServerSideRowCountState({ startRow: 200, endRow: 300, returnedRowCount: 25, hasMore: false, rowCount: 300 })
		).toThrow(
			'Server-side datasource returned hasMore false but rowCount 300 does not match the loaded range ending at 224'
		);
		expect(() =>
			resolveServerSideRowCountState({ startRow: 200, endRow: 300, returnedRowCount: 25, hasMore: true })
		).toThrow(
			'Server-side datasource returned 25 rows for range 200-299 but hasMore true still requires rows within that range'
		);
	});

	it('rejects impossible ranges and counts', () => {
		expect(() => resolveServerSideRowCountState({ startRow: -1, endRow: 100, returnedRowCount: 10 })).toThrow(
			'Invalid server-side request startRow: -1'
		);
		expect(() => resolveServerSideRowCountState({ startRow: 100, endRow: 99, returnedRowCount: 0 })).toThrow(
			'Invalid server-side request endRow: 99'
		);
		expect(() => resolveServerSideRowCountState({ startRow: 0, endRow: 10, returnedRowCount: 11 })).toThrow(
			'Server-side datasource returned 11 rows for requested range 0-9'
		);
		expect(() =>
			resolveServerSideRowCountState({ startRow: 10, endRow: 20, returnedRowCount: 5, rowCount: 14 })
		).toThrow('Server-side datasource returned rowCount 14, which is smaller than the loaded range ending at 14');
	});
});

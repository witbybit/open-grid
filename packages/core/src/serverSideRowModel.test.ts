import { describe, expect, it } from 'vitest';
import { createServerSideGetRowsRequest } from './serverSideRowModel.js';
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

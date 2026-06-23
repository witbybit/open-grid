import { describe, expect, it } from 'vitest';
import { ClientRowModel } from './client/ClientRowModel.js';
import { InfiniteRowModel } from './infinite/InfiniteRowModel.js';
import { ServerRowModel } from './server/ServerRowModel.js';
import { UnsupportedRowModelOperationError } from './RowModelError.js';

describe('RowModelCapabilities — honest, authoritative (ARCHITECTURE.md §3 R4)', () => {
	it('client is fully mutable with a full dataset', () => {
		const caps = new ClientRowModel<unknown>().capabilities;
		expect(caps.fullDataset).toBe(true);
		expect(caps.replaceRows).toBe(true);
		expect(caps.updateRows).toBe(true);
		expect(caps.transactions).toBe(true);
		expect(caps.rowOrder).toBe(true);
		expect(caps.cellMutation).toBe(true);
		expect(caps.clientSort).toBe(true);
		expect(caps.clientFilter).toBe(true);
		expect(caps.allRowSelection).toBe(true);
	});

	it('infinite owns loaded blocks only and does not lie about writes', () => {
		const caps = new InfiniteRowModel<unknown>().capabilities;
		expect(caps.loadedDataset).toBe(true);
		expect(caps.blockLoading).toBe(true);
		expect(caps.fullDataset).toBe(false);
		expect(caps.transactions).toBe(false);
		expect(caps.rowOrder).toBe(false);
		expect(caps.cellMutation).toBe(false);
		expect(caps.allRowSelection).toBe(false);
	});

	it('server owns the current page only and does not lie about writes', () => {
		const caps = new ServerRowModel<unknown>().capabilities;
		expect(caps.pagedDataset).toBe(true);
		expect(caps.serverPagination).toBe(true);
		expect(caps.fullDataset).toBe(false);
		expect(caps.transactions).toBe(false);
		expect(caps.rowOrder).toBe(false);
		expect(caps.cellMutation).toBe(false);
		expect(caps.allRowSelection).toBe(false);
	});

	it('unsupported handlers throw the loud backstop error rather than no-oping', () => {
		const infinite = new InfiniteRowModel<unknown>();
		expect(() => infinite.commands.applyTransaction({})).toThrow(UnsupportedRowModelOperationError);
		const server = new ServerRowModel<unknown>();
		expect(() => server.commands.replaceRows([])).toThrow(UnsupportedRowModelOperationError);
	});
});

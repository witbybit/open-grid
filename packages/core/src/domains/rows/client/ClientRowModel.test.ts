import { describe, expect, it } from 'vitest';
import { asColumnId } from '../../columns/ColumnId.js';
import { asRowId } from '../RowId.js';
import { ClientRowModel } from './ClientRowModel.js';

interface Person {
	id: string;
	name: string;
	age: number;
}

const getRowId = (row: Person) => row.id;

const seed: Person[] = [
	{ id: 'a', name: 'Ann', age: 30 },
	{ id: 'b', name: 'Bob', age: 25 },
	{ id: 'c', name: 'Cyd', age: 40 },
];

describe('ClientRowModel — structural writes (ARCHITECTURE.md §3 R3)', () => {
	it('replaceRows stores nodes with stable branded ids and reports a full refresh', () => {
		const model = new ClientRowModel<Person>(getRowId);
		const result = model.commands.replaceRows(seed);

		expect(result.status).toBe('applied');
		expect(result.requiredPipelineRefresh).toBe('full');
		expect(model.query.getRowCount()).toBe(3);
		expect(model.query.getRowById(asRowId('b'))?.data.name).toBe('Bob');
		expect(model.query.getRowByIndex(2)?.id).toBe('c');
	});

	it('updateRows reports a field-only change with changedFieldsByRow and no pipeline refresh', () => {
		const model = new ClientRowModel<Person>(getRowId);
		model.commands.replaceRows(seed);

		const result = model.commands.updateRows((rows) => rows.map((r) => (r.id === 'b' ? { ...r, age: 26 } : r)));

		expect(result.status).toBe('applied');
		expect(result.requiredPipelineRefresh).toBe('none');
		expect(result.rowChanges.updated.map((n) => n.id)).toEqual(['b']);
		const changed = result.rowChanges.changedFieldsByRow.get(asRowId('b'));
		expect(changed?.has(asColumnId('age'))).toBe(true);
		expect(changed?.has(asColumnId('name'))).toBe(false);
		expect(model.query.getRowById(asRowId('b'))?.data.age).toBe(26);
	});

	it('applyTransaction add/update/remove produces a correct structural change set', () => {
		const model = new ClientRowModel<Person>(getRowId);
		model.commands.replaceRows(seed);

		const result = model.commands.applyTransaction({
			add: [{ id: 'd', name: 'Dee', age: 22 }],
			update: [{ id: 'a', name: 'Ann', age: 31 }],
			remove: [asRowId('c')],
		});

		expect(result.status).toBe('applied');
		expect(result.requiredPipelineRefresh).toBe('full');
		expect(result.rowChanges.added.map((n) => n.id)).toEqual(['d']);
		expect(result.rowChanges.removed.map((n) => n.id)).toEqual(['c']);
		expect(result.rowChanges.updated.map((n) => n.id)).toEqual(['a']);
		expect(model.query.getRowCount()).toBe(3);
		expect(model.query.hasRow(asRowId('c'))).toBe(false);
		expect(model.query.getRowById(asRowId('a'))?.data.age).toBe(31);
	});

	it('writeCellValue sets a single field immutably and reports it as a changed field', () => {
		const model = new ClientRowModel<Person>(getRowId);
		model.commands.replaceRows(seed);
		const before = model.query.getRowById(asRowId('a'));

		const result = model.commands.writeCellValue(asRowId('a'), asColumnId('name'), 'name', 'Anna');

		expect(result.status).toBe('applied');
		expect(result.requiredPipelineRefresh).toBe('none');
		expect(model.query.getRowById(asRowId('a'))?.data.name).toBe('Anna');
		// immutability: original node object was not mutated
		expect(before?.data.name).toBe('Ann');
	});

	it('rejects duplicate row ids loudly', () => {
		const model = new ClientRowModel<Person>(getRowId);
		expect(() =>
			model.commands.replaceRows([
				{ id: 'x', name: 'X', age: 1 },
				{ id: 'x', name: 'Y', age: 2 },
			]),
		).toThrow(/duplicate row id/);
	});
});

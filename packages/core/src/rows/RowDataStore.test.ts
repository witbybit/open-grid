import { describe, it, expect } from 'vitest';
import { RowDataStore } from './RowDataStore.js';

function makeStore() {
	return new RowDataStore<{ id: string; name: string }>((row) => row.id);
}

describe('RowDataStore.setRows — row ID validation', () => {
	it('accepts valid unique rows', () => {
		const store = makeStore();
		expect(() =>
			store.setRows([
				{ id: 'a', name: 'Alice' },
				{ id: 'b', name: 'Bob' },
			])
		).not.toThrow();
	});

	it('throws when a row is null', () => {
		const store = makeStore();
		expect(() => store.setRows([null as unknown as { id: string; name: string }])).toThrow('row at index 0 is null or undefined');
	});

	it('throws when a row is undefined', () => {
		const store = makeStore();
		expect(() => store.setRows([undefined as unknown as { id: string; name: string }])).toThrow('row at index 0 is null or undefined');
	});

	it('throws when getRowId returns an empty string', () => {
		const store = new RowDataStore<{ id: string }>((row) => row.id);
		expect(() => store.setRows([{ id: '' }])).toThrow('invalid id for row at index 0');
	});

	it('throws when getRowId returns a non-string', () => {
		const store = new RowDataStore<object>((_row) => null as unknown as string);
		expect(() => store.setRows([{}])).toThrow('invalid id for row at index 0');
	});

	it('throws on duplicate row IDs', () => {
		const store = makeStore();
		expect(() =>
			store.setRows([
				{ id: 'x', name: 'first' },
				{ id: 'x', name: 'duplicate' },
			])
		).toThrow('duplicate row ID');
	});

	it('does not mutate existing state on a bad setRows call', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		expect(() => store.setRows([null as unknown as { id: string; name: string }])).toThrow();
		// State unchanged after the failed call
		expect(store.getAllNodes().length).toBe(1);
		expect(store.getNode('a')?.data.name).toBe('Alice');
	});

	it('updates existing nodes on valid setRows', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		store.setRows([{ id: 'a', name: 'Alice Updated' }]);
		expect(store.getNode('a')?.data.name).toBe('Alice Updated');
	});
});

describe('RowDataStore.updateRows', () => {
	it('returns changed nodes when fields differ', () => {
		const store = makeStore();
		store.setRows([
			{ id: 'a', name: 'Alice' },
			{ id: 'b', name: 'Bob' },
		]);
		const result = store.updateRows((rows) => [{ id: 'a', name: 'Alice 2' }, rows[1]]);
		expect(result.mismatch).toBe(false);
		expect(result.changedNodes).toHaveLength(1);
		expect(result.changedNodes[0].id).toBe('a');
		expect(result.changedFieldsByRow.get('a')?.has('name')).toBe(true);
		expect(store.getNode('a')?.data.name).toBe('Alice 2');
	});

	it('returns mismatch when updater returns a different row count', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		const result = store.updateRows(() => []);
		expect(result.mismatch).toBe(true);
		expect(result.changedNodes).toHaveLength(0);
		// State must not be mutated
		expect(store.getNode('a')?.data.name).toBe('Alice');
	});

	it('returns mismatch when updater changes a row ID', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		const result = store.updateRows(() => [{ id: 'z', name: 'Alice' }]);
		expect(result.mismatch).toBe(true);
	});

	it('returns mismatch when updater returns null at a position', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		const result = store.updateRows(() => [null as unknown as { id: string; name: string }]);
		expect(result.mismatch).toBe(true);
	});

	it('returns empty changedNodes when no fields differ', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		const result = store.updateRows((rows) => [...rows]);
		expect(result.mismatch).toBe(false);
		expect(result.changedNodes).toHaveLength(0);
	});
});

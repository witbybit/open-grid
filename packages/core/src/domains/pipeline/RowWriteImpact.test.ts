import { describe, expect, it } from 'vitest';
import { asColumnId } from '../columns/ColumnId.js';
import type { ColumnId } from '../columns/ColumnId.js';
import { asRowId } from '../rows/RowId.js';
import type { RowId } from '../rows/RowId.js';
import { classifyChangedFields, classifyWriteImpact } from './RowWriteImpact.js';
import type { RowWriteImpactContext } from './RowWriteImpact.js';

const ctx: RowWriteImpactContext = {
	filterColumns: new Set([asColumnId('status')]),
	sortColumns: new Set([asColumnId('age')]),
	groupColumns: new Set([asColumnId('team')]),
};

function changed(...cols: string[]): ReadonlySet<ColumnId> {
	return new Set(cols.map(asColumnId));
}

function byRow(cols: string[]): ReadonlyMap<RowId, ReadonlySet<ColumnId>> {
	return new Map([[asRowId('r1'), changed(...cols)]]);
}

describe('classifyWriteImpact — the single shared classifier (ARCHITECTURE.md §3 R7)', () => {
	it('empty change → none', () => {
		expect(classifyWriteImpact(new Map(), ctx)).toBe('none');
	});

	it('a plain column → plain-cell-value', () => {
		expect(classifyWriteImpact(byRow(['name']), ctx)).toBe('plain-cell-value');
	});

	it('a sort-key column → sort-key', () => {
		expect(classifyWriteImpact(byRow(['age']), ctx)).toBe('sort-key');
	});

	it('a filter-key column → filter-key', () => {
		expect(classifyWriteImpact(byRow(['status']), ctx)).toBe('filter-key');
	});

	it('a group-key column → group-key', () => {
		expect(classifyWriteImpact(byRow(['team']), ctx)).toBe('group-key');
	});

	it('membership-affecting concerns outrank order: filter beats sort when both change', () => {
		expect(classifyChangedFields(changed('age', 'status'), ctx)).toBe('filter-key');
	});
});

import { describe, it, expect } from 'vitest';
import { compileStyleRules } from './styleRules.js';
import type { StyleRule } from './styleRules.js';

interface Row {
	id: string;
	change: string;
	price: number;
	risk: string;
}

const makeRowParams = (overrides: Record<string, unknown> = {}) =>
	({
		rowId: 'r1',
		rowIndex: 0,
		isFocused: false,
		isSelected: false,
		isLoading: false,
		selection: { focus: null, range: null, selectedRowIds: new Set<string>() },
		...overrides,
	}) as any;

const makeCellParams = (field: string, value: unknown, overrides: Record<string, unknown> = {}) =>
	({
		rowId: 'r1',
		rowIndex: 0,
		col: { field, header: field },
		colField: field,
		colIndex: 0,
		isFocused: false,
		isRowFocused: false,
		isRowSelected: false,
		isSelected: false,
		isEditing: false,
		value,
		rawValue: value,
		isLoading: false,
		selection: { focus: null, range: null, selectedRowIds: new Set<string>() },
		...overrides,
	}) as any;

const makeCol = (field: string) => ({ field, header: field }) as any;

const row: Row = { id: 'r1', change: '5', price: 100, risk: 'High' };

describe('compileStyleRules', () => {
	it('returns empty object for empty rules array', () => {
		expect(compileStyleRules([])).toEqual({});
	});

	it('row rule returns class when when() is true', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'row', when: () => true, rowClass: 'bg-green-500' }];
		const slots = compileStyleRules(rules);
		expect(slots.rowClass?.(row, makeRowParams())).toBe('bg-green-500');
	});

	it('row rule returns empty string when when() is false', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'row', when: () => false, rowClass: 'bg-green-500' }];
		const slots = compileStyleRules(rules);
		expect(slots.rowClass?.(row, makeRowParams())).toBe('');
	});

	it('multiple matching row rules are joined with space', () => {
		const rules: StyleRule<Row>[] = [
			{ kind: 'row', when: () => true, rowClass: 'border-l-2' },
			{ kind: 'row', when: () => true, rowClass: 'text-white' },
			{ kind: 'row', when: () => false, rowClass: 'hidden' },
		];
		const slots = compileStyleRules(rules);
		expect(slots.rowClass?.(row, makeRowParams())).toBe('border-l-2 text-white');
	});

	it('cell rule without field applies to any column when when() is true', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'cell', when: () => true, cellClass: 'font-bold' }];
		const slots = compileStyleRules(rules);
		expect(slots.cellClass?.(makeCol('anything'), row, makeCellParams('anything', null))).toBe('font-bold');
	});

	it('cell rule with field applies only to that column', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'cell', field: 'change', when: () => true, cellClass: 'text-green' }];
		const slots = compileStyleRules(rules);
		expect(slots.cellClass?.(makeCol('change'), row, makeCellParams('change', '5'))).toBe('text-green');
	});

	it('cell rule with field does NOT apply to other columns', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'cell', field: 'change', when: () => true, cellClass: 'text-green' }];
		const slots = compileStyleRules(rules);
		expect(slots.cellClass?.(makeCol('price'), row, makeCellParams('price', 100))).toBe('');
	});

	it('multiple cell rules — all matching classes are joined', () => {
		const rules: StyleRule<Row>[] = [
			{ kind: 'cell', field: 'price', when: () => true, cellClass: 'font-mono' },
			{ kind: 'cell', field: 'price', when: () => true, cellClass: 'font-bold' },
			{ kind: 'cell', field: 'price', when: () => false, cellClass: 'hidden' },
		];
		const slots = compileStyleRules(rules);
		expect(slots.cellClass?.(makeCol('price'), row, makeCellParams('price', 100))).toBe('font-mono font-bold');
	});

	it('mixed rules compile to styleSlots with both rowClass and cellClass', () => {
		const rules: StyleRule<Row>[] = [
			{ kind: 'row', when: () => true, rowClass: 'row-class' },
			{ kind: 'cell', when: () => true, cellClass: 'cell-class' },
		];
		const slots = compileStyleRules(rules);
		expect(slots.rowClass).toBeDefined();
		expect(slots.cellClass).toBeDefined();
	});

	it('row-only rules produce no cellClass in output', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'row', when: () => true, rowClass: 'x' }];
		const slots = compileStyleRules(rules);
		expect(slots.cellClass).toBeUndefined();
	});

	it('cell-only rules produce no rowClass in output', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'cell', when: () => true, cellClass: 'x' }];
		const slots = compileStyleRules(rules);
		expect(slots.rowClass).toBeUndefined();
	});

	it('compileStyleRules is a pure function — calling it twice yields equivalent slot functions', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'row', when: (r) => r.risk === 'High', rowClass: 'danger' }];
		const slots1 = compileStyleRules(rules);
		const slots2 = compileStyleRules(rules);
		const params = makeRowParams();
		expect(slots1.rowClass?.(row, params)).toBe(slots2.rowClass?.(row, params));
	});

	it('when() receives the row data and params', () => {
		let capturedRow: Row | null = null;
		const rules: StyleRule<Row>[] = [
			{
				kind: 'row',
				when: (r, _p) => {
					capturedRow = r;
					return false;
				},
				rowClass: 'x',
			},
		];
		const slots = compileStyleRules(rules);
		slots.rowClass?.(row, makeRowParams());
		expect(capturedRow).toBe(row);
	});

	// ── HeaderCellStyleRule ───────────────────────────────────────────────────

	it('headerCell rule returns class when when() is true', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'headerCell', when: () => true, headerCellClass: 'font-bold' }];
		const slots = compileStyleRules(rules);
		expect(slots.headerCellClass?.(makeCol('price'))).toBe('font-bold');
	});

	it('headerCell rule returns empty string when when() is false', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'headerCell', when: () => false, headerCellClass: 'font-bold' }];
		const slots = compileStyleRules(rules);
		expect(slots.headerCellClass?.(makeCol('price'))).toBe('');
	});

	it('headerCell rule with field applies only to that column header', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'headerCell', field: 'change', when: () => true, headerCellClass: 'text-emerald' }];
		const slots = compileStyleRules(rules);
		expect(slots.headerCellClass?.(makeCol('change'))).toBe('text-emerald');
		expect(slots.headerCellClass?.(makeCol('price'))).toBe('');
	});

	it('multiple headerCell rules — matching classes are joined', () => {
		const rules: StyleRule<Row>[] = [
			{ kind: 'headerCell', when: () => true, headerCellClass: 'font-bold' },
			{ kind: 'headerCell', when: () => true, headerCellClass: 'text-slate-400' },
			{ kind: 'headerCell', when: () => false, headerCellClass: 'hidden' },
		];
		const slots = compileStyleRules(rules);
		expect(slots.headerCellClass?.(makeCol('price'))).toBe('font-bold text-slate-400');
	});

	it('headerCell-only rules produce no rowClass or cellClass in output', () => {
		const rules: StyleRule<Row>[] = [{ kind: 'headerCell', when: () => true, headerCellClass: 'x' }];
		const slots = compileStyleRules(rules);
		expect(slots.rowClass).toBeUndefined();
		expect(slots.cellClass).toBeUndefined();
		expect(slots.headerCellClass).toBeDefined();
	});

	it('when() for headerCell receives the ColumnDef', () => {
		let capturedField: string | null = null;
		const rules: StyleRule<Row>[] = [
			{
				kind: 'headerCell',
				when: (col) => {
					capturedField = col.field;
					return false;
				},
				headerCellClass: 'x',
			},
		];
		const slots = compileStyleRules(rules);
		slots.headerCellClass?.(makeCol('change'));
		expect(capturedField).toBe('change');
	});
});

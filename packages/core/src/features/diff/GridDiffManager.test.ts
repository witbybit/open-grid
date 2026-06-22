import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GridDiffManager } from './GridDiffManager.js';
import type { GridDiffModel } from './GridDiffManager.js';

type Row = { id: string; name: string; amount: number; status?: string };

const getRowId = (r: Row) => r.id;

function makeManager(columns: string[] = ['name', 'amount', 'status']) {
	const repaint = vi.fn();
	const manager = new GridDiffManager<Row>({
		getState: () => ({ columns: columns.map((f) => ({ field: f })) }),
		requestInsightRepaint: repaint,
	});
	return { manager, repaint };
}

function makeModel(base: Row[], compare: Row[], options?: GridDiffModel<Row>['options']): GridDiffModel<Row> {
	return {
		id: 'test-diff',
		mode: 'inline',
		base: { id: 'base', label: 'Base', rows: base, getRowId },
		compare: { id: 'compare', label: 'Compare', rows: compare, getRowId },
		options,
	};
}

const BASE_ROWS: Row[] = [
	{ id: 'r1', name: 'Alice', amount: 100, status: 'open' },
	{ id: 'r2', name: 'Bob', amount: 200, status: 'closed' },
	{ id: 'r3', name: 'Carol', amount: 300, status: 'open' },
];

describe('GridDiffManager', () => {
	it('registers as insight layer with id "diff"', () => {
		const { manager } = makeManager();
		expect(manager.id).toBe('diff');
	});

	it('detects added rows', () => {
		const { manager } = makeManager();
		const compare = [...BASE_ROWS, { id: 'r4', name: 'Dave', amount: 400, status: 'new' }];
		manager.setDiffModel(makeModel(BASE_ROWS, compare));
		expect(manager.getDiffResult()?.addedRows).toContain('r4');
		expect(manager.getDiffResult()?.addedRows).toHaveLength(1);
	});

	it('detects removed rows', () => {
		const { manager } = makeManager();
		const compare = BASE_ROWS.filter((r) => r.id !== 'r2');
		manager.setDiffModel(makeModel(BASE_ROWS, compare));
		expect(manager.getDiffResult()?.removedRows).toContain('r2');
		expect(manager.getDiffResult()?.removedRows).toHaveLength(1);
	});

	it('detects changed cells', () => {
		const { manager } = makeManager();
		const compare = BASE_ROWS.map((r) => (r.id === 'r1' ? { ...r, amount: 999 } : r));
		manager.setDiffModel(makeModel(BASE_ROWS, compare));
		const result = manager.getDiffResult()!;
		expect(result.changedRows).toContain('r1');
		expect(result.changedCells).toHaveLength(1);
		expect(result.changedCells[0]).toMatchObject({ rowId: 'r1', colField: 'amount', oldValue: 100, newValue: 999 });
	});

	it('respects compareFields option — only specified fields compared', () => {
		const { manager } = makeManager();
		const compare = BASE_ROWS.map((r) => (r.id === 'r1' ? { ...r, amount: 999, name: 'CHANGED' } : r));
		manager.setDiffModel(makeModel(BASE_ROWS, compare, { compareFields: ['amount'] }));
		const result = manager.getDiffResult()!;
		const fields = result.changedCells.map((c) => c.colField);
		expect(fields).toContain('amount');
		expect(fields).not.toContain('name');
	});

	it('respects ignoreFields option — ignored fields skipped', () => {
		const { manager } = makeManager();
		const compare = BASE_ROWS.map((r) => (r.id === 'r1' ? { ...r, amount: 999, name: 'CHANGED' } : r));
		manager.setDiffModel(makeModel(BASE_ROWS, compare, { ignoreFields: ['name'] }));
		const result = manager.getDiffResult()!;
		const fields = result.changedCells.map((c) => c.colField);
		expect(fields).toContain('amount');
		expect(fields).not.toContain('name');
	});

	it('does not mutate base rows', () => {
		const { manager } = makeManager();
		const frozen = BASE_ROWS.map((r) => Object.freeze({ ...r }));
		const compare = frozen.map((r) => ({ ...r, amount: r.amount + 1 }));
		expect(() => manager.setDiffModel(makeModel(frozen, compare))).not.toThrow();
		expect(frozen[0].amount).toBe(100);
	});

	it('does not mutate compare rows', () => {
		const { manager } = makeManager();
		const compare = BASE_ROWS.map((r) => Object.freeze({ ...r, amount: r.amount + 1 }));
		expect(() => manager.setDiffModel(makeModel(BASE_ROWS, compare))).not.toThrow();
	});

	it('provides cell decorations for changed cells', () => {
		const { manager } = makeManager();
		const compare = BASE_ROWS.map((r) => (r.id === 'r1' ? { ...r, amount: 999 } : r));
		manager.setDiffModel(makeModel(BASE_ROWS, compare));
		const decs = manager.getCellDecorations('r1', 'amount');
		expect(decs).toHaveLength(1);
		expect(decs[0].className).toBe('og-cell-diff-changed');
		expect(decs[0].title).toContain('Old: 100');
		expect(decs[0].title).toContain('New: 999');
	});

	it('provides row decorations for added rows', () => {
		const { manager } = makeManager();
		const compare = [...BASE_ROWS, { id: 'r4', name: 'Dave', amount: 400, status: 'new' }];
		manager.setDiffModel(makeModel(BASE_ROWS, compare));
		const rowDecs = manager.getRowDecorations('r4');
		expect(rowDecs).toHaveLength(1);
		expect(rowDecs[0].className).toBe('og-row-diff-added');
	});

	it('removed rows are in result but not decorated as rows (not injected)', () => {
		const { manager } = makeManager();
		const compare = BASE_ROWS.filter((r) => r.id !== 'r3');
		manager.setDiffModel(makeModel(BASE_ROWS, compare));
		expect(manager.getDiffResult()?.removedRows).toContain('r3');
		// No row decoration for r3 since it's not in the current grid
		const rowDecs = manager.getRowDecorations('r3');
		expect(rowDecs).toHaveLength(0);
	});

	it('clearing diff clears decorations and result', () => {
		const { manager, repaint } = makeManager();
		const compare = BASE_ROWS.map((r) => (r.id === 'r1' ? { ...r, amount: 999 } : r));
		manager.setDiffModel(makeModel(BASE_ROWS, compare));
		expect(manager.getDiffResult()).not.toBeNull();
		manager.clear();
		expect(manager.getDiffResult()).toBeNull();
		expect(manager.getCellDecorations('r1', 'amount')).toHaveLength(0);
		expect(repaint).toHaveBeenCalledTimes(2); // once for set, once for clear
	});

	it('setDiffModel(null) clears the diff', () => {
		const { manager } = makeManager();
		manager.setDiffModel(makeModel(BASE_ROWS, BASE_ROWS));
		manager.setDiffModel(null);
		expect(manager.getDiffModel()).toBeNull();
		expect(manager.getDiffResult()).toBeNull();
	});

	it('getCellDiff returns diff for changed cells', () => {
		const { manager } = makeManager();
		const compare = BASE_ROWS.map((r) => (r.id === 'r2' ? { ...r, name: 'Robert' } : r));
		manager.setDiffModel(makeModel(BASE_ROWS, compare));
		const diff = manager.getCellDiff('r2', 'name');
		expect(diff).not.toBeNull();
		expect(diff?.oldValue).toBe('Bob');
		expect(diff?.newValue).toBe('Robert');
		expect(diff?.status).toBe('changed');
	});

	it('getDiagnostics reports diff stats', () => {
		const { manager } = makeManager();
		const compare = [...BASE_ROWS.filter((r) => r.id !== 'r3'), { id: 'r4', name: 'Dave', amount: 400, status: 'new' }, BASE_ROWS[0]];
		const compareWithChange = compare.map((r) => (r.id === 'r2' ? { ...r, amount: 999 } : r));
		manager.setDiffModel(makeModel(BASE_ROWS, compareWithChange));
		const diag = manager.getDiagnostics();
		expect(diag.active).toBe(true);
		expect(diag.addedRows).toBe(1);
		expect(diag.removedRows).toBe(1);
		expect(diag.changedRows).toBe(1);
		expect(diag.changedCells).toBe(1);
		expect(diag.lastComputedAt).not.toBeNull();
	});

	it('destroy clears all state', () => {
		const { manager } = makeManager();
		manager.setDiffModel(makeModel(BASE_ROWS, BASE_ROWS));
		manager.destroy();
		expect(manager.getDiffResult()).toBeNull();
		expect(manager.getDiffModel()).toBeNull();
	});
});

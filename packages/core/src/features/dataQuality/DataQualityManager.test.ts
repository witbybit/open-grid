import { describe, it, expect, vi } from 'vitest';
import { GridDataQualityManager } from './DataQualityManager.js';
import { createDuplicateValueRule } from './builtInRules.js';
import { GridInsightRegistry } from '../../insights/GridInsightRegistry.js';
import type { DataQualityRule } from './dataQualityTypes.js';

interface TestRow {
	id: string;
	name: string;
	email: string;
	amount: number;
}

const TEST_COLUMNS = [
	{ field: 'id', header: 'ID', required: true },
	{ field: 'name', header: 'Name', required: true },
	{ field: 'email', header: 'Email' },
	{ field: 'amount', header: 'Amount' },
] as any[];

const CLEAN_ROWS: TestRow[] = [
	{ id: 'r1', name: 'Alice', email: 'alice@example.com', amount: 100 },
	{ id: 'r2', name: 'Bob', email: 'bob@example.com', amount: 200 },
];

const DIRTY_ROWS: TestRow[] = [
	{ id: 'r1', name: '', email: 'alice@example.com', amount: 100 },  // missing name
	{ id: 'r2', name: 'Bob', email: 'bob@example.com', amount: 200 },
];

function makeVisualRow(row: TestRow, index: number) {
	return { kind: 'data' as const, rowId: row.id, node: { id: row.id, data: row }, visualRowIndex: index };
}

function makeRowModel(rows: TestRow[]) {
	return {
		type: 'client',
		getVisualRowCount: () => rows.length,
		getVisualRow: (i: number) => (i < rows.length ? makeVisualRow(rows[i], i) : null),
	} as any;
}

function makeDeps(rows: TestRow[], validationErrors: Record<string, string> = {}) {
	const requestInsightRepaint = vi.fn();
	return {
		deps: {
			getState: () => ({
				columns: TEST_COLUMNS,
				validationErrors,
				getRowId: (row: TestRow) => row.id,
			}),
			getRowModel: () => makeRowModel(rows),
			requestInsightRepaint,
		} as any,
		requestInsightRepaint,
	};
}

describe('GridDataQualityManager', () => {
	it('registers as insight layer with id "dataQuality"', () => {
		const { deps } = makeDeps(CLEAN_ROWS);
		const manager = new GridDataQualityManager(deps);
		const registry = new GridInsightRegistry();
		registry.register(manager);
		expect(registry.size).toBe(1);
		expect(registry.getDiagnostics()['dataQuality']).toBeTruthy();
	});

	it('returns null report before any run', () => {
		const { deps } = makeDeps(CLEAN_ROWS);
		const manager = new GridDataQualityManager(deps);
		expect(manager.getReport()).toBeNull();
	});

	it('aggregates existing validation errors into report', async () => {
		const { deps } = makeDeps(CLEAN_ROWS, { 'r1:amount': 'Amount cannot be negative' });
		const manager = new GridDataQualityManager(deps);
		const report = await manager.run();
		const validationIssues = report.issues.filter((i) => i.type === 'validation');
		expect(validationIssues).toHaveLength(1);
		expect(validationIssues[0].rowId).toBe('r1');
		expect(validationIssues[0].colField).toBe('amount');
		expect(validationIssues[0].message).toBe('Amount cannot be negative');
	});

	it('detects missing required values', async () => {
		const { deps } = makeDeps(DIRTY_ROWS);
		const manager = new GridDataQualityManager(deps);
		const report = await manager.run();
		const missingIssues = report.issues.filter((i) => i.type === 'missing');
		expect(missingIssues.length).toBeGreaterThan(0);
		const nameIssue = missingIssues.find((i) => i.colField === 'name' && i.rowId === 'r1');
		expect(nameIssue).toBeDefined();
	});

	it('counts summary correctly', async () => {
		const { deps } = makeDeps(DIRTY_ROWS, { 'r2:email': 'Invalid email' });
		const manager = new GridDataQualityManager(deps);
		const report = await manager.run();
		expect(report.summary.totalIssues).toBe(report.issues.length);
		expect(report.summary.errors).toBe(report.issues.filter((i) => i.severity === 'error').length);
		expect(report.summary.warnings).toBe(report.issues.filter((i) => i.severity === 'warning').length);
	});

	it('registers and runs a custom rule', async () => {
		const { deps } = makeDeps(CLEAN_ROWS);
		const manager = new GridDataQualityManager(deps);
		const customRule: DataQualityRule<TestRow> = {
			id: 'my-custom-rule',
			label: 'Custom',
			run: ({ rows }) =>
				rows.map((r) => ({
					id: 'x',
					type: 'custom' as const,
					severity: 'info' as const,
					rowId: r.id,
					message: 'Custom issue',
				})),
		};
		manager.registerRule(customRule as any);
		const report = await manager.run();
		const customIssues = report.issues.filter((i) => i.type === 'custom');
		expect(customIssues).toHaveLength(CLEAN_ROWS.length);
	});

	it('unregistering a rule removes it from subsequent runs', async () => {
		const { deps } = makeDeps(CLEAN_ROWS);
		const manager = new GridDataQualityManager(deps);
		const rule: DataQualityRule<TestRow> = {
			id: 'temp-rule',
			label: 'Temp',
			run: () => [{ id: 'x', type: 'custom', severity: 'info', message: 'tmp' }] as any,
		};
		manager.registerRule(rule as any);
		manager.unregisterRule('temp-rule');
		const report = await manager.run();
		expect(report.issues.filter((i) => i.type === 'custom')).toHaveLength(0);
	});

	it('duplicate value rule flags duplicate cells', async () => {
		const rows: TestRow[] = [
			{ id: 'r1', name: 'Alice', email: 'dup@x.com', amount: 100 },
			{ id: 'r2', name: 'Bob', email: 'dup@x.com', amount: 200 },
			{ id: 'r3', name: 'Carol', email: 'unique@x.com', amount: 300 },
		];
		const { deps } = makeDeps(rows);
		const manager = new GridDataQualityManager(deps);
		manager.registerRule(createDuplicateValueRule('email') as any);
		const report = await manager.run();
		const dupIssues = report.issues.filter((i) => i.type === 'duplicate');
		expect(dupIssues).toHaveLength(2); // both r1 and r2
	});

	it('cell decorations appear for issue cells', async () => {
		const { deps } = makeDeps(DIRTY_ROWS);
		const manager = new GridDataQualityManager(deps);
		await manager.run();
		const decs = manager.getCellDecorations('r1', 'name');
		expect(decs.length).toBeGreaterThan(0);
		expect(decs[0].className).toContain('og-cell-quality');
	});

	it('multiple issues on same cell aggregate into multiple decorations', async () => {
		const { deps } = makeDeps(DIRTY_ROWS, { 'r1:name': 'Also a validation error' });
		const manager = new GridDataQualityManager(deps);
		await manager.run();
		const decs = manager.getCellDecorations('r1', 'name');
		// Both the validation error and the missing-required issue appear
		expect(decs.length).toBeGreaterThanOrEqual(2);
	});

	it('clearing the report clears decorations and triggers repaint', async () => {
		const { deps, requestInsightRepaint } = makeDeps(DIRTY_ROWS);
		const manager = new GridDataQualityManager(deps);
		await manager.run();
		requestInsightRepaint.mockClear();
		manager.clear();
		expect(manager.getReport()).toBeNull();
		expect(manager.getCellDecorations('r1', 'name')).toHaveLength(0);
		expect(requestInsightRepaint).toHaveBeenCalledOnce();
	});

	it('returns loadedRows scope for non-client row models', async () => {
		const { deps } = makeDeps(CLEAN_ROWS);
		(deps.getRowModel as any) = () => ({ type: 'server', getVisualRowCount: () => 0, getVisualRow: () => null });
		const manager = new GridDataQualityManager(deps);
		const report = await manager.run();
		expect(report.scope).toBe('loadedRows');
	});

	it('returns allClientRows scope for client row model by default', async () => {
		const { deps } = makeDeps(CLEAN_ROWS);
		const manager = new GridDataQualityManager(deps);
		const report = await manager.run();
		expect(report.scope).toBe('allClientRows');
	});

	it('diagnostics reflect active state correctly', async () => {
		const { deps } = makeDeps(DIRTY_ROWS);
		const manager = new GridDataQualityManager(deps);
		expect(manager.getDiagnostics().active).toBe(false);
		await manager.run();
		const diag = manager.getDiagnostics();
		expect(diag.active).toBe(true);
		expect(diag.totalIssues).toBeGreaterThan(0);
		expect(diag.lastRunAt).toBeGreaterThan(0);
	});

	it('no direct row mutation occurs during run', async () => {
		const rows: TestRow[] = [{ id: 'r1', name: '', email: 'a@b.com', amount: -5 }];
		const original = JSON.stringify(rows[0]);
		const { deps } = makeDeps(rows);
		const manager = new GridDataQualityManager(deps);
		await manager.run();
		expect(JSON.stringify(rows[0])).toBe(original);
	});
});

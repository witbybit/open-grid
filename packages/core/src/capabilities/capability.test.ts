import { describe, it, expect, vi } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { GridCapabilityManager } from './GridCapabilityManager.js';
import { normalizeCapabilityResult, CAPABILITY_ALLOWED, type GridCapabilitiesConfig, type GridCapabilityResult } from './capabilityTypes.js';
import type { ColumnDef } from '../columnDef.js';

// ── Shared types ───────────────────────────────────────────────────────────────

interface TestRow {
	id: string;
	name: string;
	salary: number;
	dept: string;
}

const BASE_COLUMNS: ColumnDef<TestRow>[] = [
	{ field: 'id', header: 'ID' },
	{ field: 'name', header: 'Name' },
	{ field: 'salary', header: 'Salary', sortable: true },
	{ field: 'dept', header: 'Dept', enableRowGroup: true },
];

const ROWS: TestRow[] = [
	{ id: '1', name: 'Alice', salary: 90000, dept: 'Eng' },
	{ id: '2', name: 'Bob', salary: 60000, dept: 'Sales' },
];

function makeStore(capabilities?: GridCapabilitiesConfig<TestRow>) {
	const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: BASE_COLUMNS }, { capabilities });
	const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: ROWS,
		columns: store.getState().columns,
	});
	return { store, controller };
}

function makeManager(config: GridCapabilitiesConfig<TestRow>, columns: ColumnDef<TestRow>[] = BASE_COLUMNS, rows: TestRow[] = ROWS) {
	return new GridCapabilityManager<TestRow>(
		config,
		() => columns,
		(rowId) => rows.find((r) => r.id === rowId) ?? null
	);
}

// ── normalizeCapabilityResult helper ──────────────────────────────────────────

describe('normalizeCapabilityResult', () => {
	it('converts true to allowed result', () => {
		expect(normalizeCapabilityResult(true)).toEqual({ allowed: true });
	});

	it('converts false to denied result', () => {
		expect(normalizeCapabilityResult(false)).toEqual({ allowed: false });
	});

	it('passes through GridCapabilityResult objects unchanged', () => {
		const result: GridCapabilityResult = { allowed: false, reason: 'Locked', mode: 'readonly' };
		expect(normalizeCapabilityResult(result)).toBe(result);
	});
});

// ── CAPABILITY_ALLOWED constant ───────────────────────────────────────────────

describe('CAPABILITY_ALLOWED', () => {
	it('is an allowed result', () => {
		expect(CAPABILITY_ALLOWED.allowed).toBe(true);
	});
});

// ── GridCapabilityManager.can — default allow ─────────────────────────────────

describe('GridCapabilityManager defaults', () => {
	it('allows any action when no config provided', () => {
		const mgr = makeManager({});
		expect(mgr.can('edit', { rowId: '1', colField: 'salary' }).allowed).toBe(true);
		expect(mgr.can('copy', {}).allowed).toBe(true);
		expect(mgr.can('export', {}).allowed).toBe(true);
	});
});

// ── Layer 2: boolean column prop checks (sortable, enableRowGroup only) ────────

describe('GridCapabilityManager — Layer 2 boolean column props', () => {
	it('denies sort when sortable=false on column', () => {
		const cols: ColumnDef<TestRow>[] = [{ field: 'salary', header: 'Salary', sortable: false }];
		const mgr = makeManager({}, cols);
		expect(mgr.can('sort', { colField: 'salary' }).allowed).toBe(false);
	});

	it('denies group when enableRowGroup=false on column', () => {
		const cols: ColumnDef<TestRow>[] = [{ field: 'dept', header: 'Dept', enableRowGroup: false }];
		const mgr = makeManager({}, cols);
		expect(mgr.can('group', { colField: 'dept' }).allowed).toBe(false);
	});
});

// ── Layer 3: column canX callbacks ───────────────────────────────────────────

describe('GridCapabilityManager — Layer 3 column canX callbacks', () => {
	it('denies when column canEdit returns false', () => {
		const cols: ColumnDef<TestRow>[] = [{ field: 'salary', header: 'Salary', canEdit: () => false }];
		const mgr = makeManager({}, cols);
		expect(mgr.can('edit', { colField: 'salary' }).allowed).toBe(false);
	});

	it('allows when column canEdit returns true', () => {
		const cols: ColumnDef<TestRow>[] = [{ field: 'salary', header: 'Salary', canEdit: () => true }];
		const mgr = makeManager({}, cols);
		expect(mgr.can('edit', { colField: 'salary' }).allowed).toBe(true);
	});

	it('returns reason from column canCopy returning result object', () => {
		const cols: ColumnDef<TestRow>[] = [
			{ field: 'salary', header: 'Salary', canCopy: () => ({ allowed: false, reason: 'Confidential', mode: 'hidden' as const }) },
		];
		const mgr = makeManager({}, cols);
		const result = mgr.can('copy', { colField: 'salary' });
		expect(result.allowed).toBe(false);
		expect(result.reason).toBe('Confidential');
		expect(result.mode).toBe('hidden');
	});
});

// ── Layer 4: grid-level canX callbacks ───────────────────────────────────────

describe('GridCapabilityManager — Layer 4 grid-level canX', () => {
	it('denies via canEdit grid callback', () => {
		const mgr = makeManager({ canEdit: () => false });
		expect(mgr.can('edit', { rowId: '1', colField: 'salary' }).allowed).toBe(false);
	});

	it('allows when grid canEdit returns true', () => {
		const mgr = makeManager({ canEdit: () => true });
		expect(mgr.can('edit', { rowId: '1', colField: 'salary' }).allowed).toBe(true);
	});

	it('denies via canSort grid callback', () => {
		const mgr = makeManager({ canSort: () => false });
		expect(mgr.can('sort', {}).allowed).toBe(false);
	});

	it('denies via canExport grid callback', () => {
		const mgr = makeManager({ canExport: () => ({ allowed: false, reason: 'Export disabled' }) });
		const result = mgr.can('export', {});
		expect(result.allowed).toBe(false);
		expect(result.reason).toBe('Export disabled');
	});
});

// ── Layer 5: canPerformAction fallback ────────────────────────────────────────

describe('GridCapabilityManager — Layer 5 canPerformAction', () => {
	it('denies via canPerformAction when no action-specific callback', () => {
		const mgr = makeManager({ canPerformAction: () => false });
		expect(mgr.can('delete', {}).allowed).toBe(false);
	});

	it('canPerformAction receives action in params', () => {
		const spy = vi.fn(() => true);
		const mgr = makeManager({ canPerformAction: spy });
		mgr.can('resize', { colField: 'salary' });
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({ action: 'resize', colField: 'salary' }));
	});
});

// ── Resolution order ──────────────────────────────────────────────────────────

describe('GridCapabilityManager — resolution order', () => {
	it('column canX denial takes precedence over permissive grid callback', () => {
		const cols: ColumnDef<TestRow>[] = [{ field: 'name', header: 'Name', canFilter: () => false }];
		const mgr = makeManager({ canFilter: () => true }, cols);
		expect(mgr.can('filter', { colField: 'name' }).allowed).toBe(false);
	});

	it('column canX denial takes precedence over permissive grid canX', () => {
		const cols: ColumnDef<TestRow>[] = [{ field: 'salary', header: 'Salary', canEdit: () => false }];
		const mgr = makeManager({ canEdit: () => true }, cols);
		expect(mgr.can('edit', { colField: 'salary' }).allowed).toBe(false);
	});
});

// ── Diagnostics ───────────────────────────────────────────────────────────────

describe('GridCapabilityManager diagnostics', () => {
	it('tracks denied action count', () => {
		const mgr = makeManager({ canEdit: () => false });
		mgr.can('edit', { rowId: '1' });
		mgr.can('edit', { rowId: '2' });
		expect(mgr.getDiagnostics().deniedActions).toBe(2);
	});

	it('tracks last denied action', () => {
		const mgr = makeManager({ canEdit: () => ({ allowed: false, reason: 'Locked row' }) });
		mgr.can('edit', { rowId: '1', colField: 'salary' });
		const diag = mgr.getDiagnostics();
		expect(diag.lastDeniedAction?.action).toBe('edit');
		expect(diag.lastDeniedAction?.rowId).toBe('1');
		expect(diag.lastDeniedAction?.reason).toBe('Locked row');
	});

	it('resetDiagnostics clears counts', () => {
		const mgr = makeManager({ canEdit: () => false });
		mgr.can('edit', {});
		mgr.resetDiagnostics();
		expect(mgr.getDiagnostics().deniedActions).toBe(0);
		expect(mgr.getDiagnostics().lastDeniedAction).toBeUndefined();
	});
});

// ── GridStore API integration ─────────────────────────────────────────────────

describe('GridStore capability API', () => {
	it('api.can() returns allowed when no capabilities configured', () => {
		const { store } = makeStore();
		expect(store.can('edit', { rowId: '1', colField: 'salary' }).allowed).toBe(true);
	});

	it('api.can() returns denied when capabilities block action', () => {
		const { store } = makeStore({ canEdit: () => false });
		expect(store.can('edit', { rowId: '1', colField: 'salary' }).allowed).toBe(false);
	});

	it('api.canEdit() returns boolean', () => {
		const { store } = makeStore({ canEdit: () => false });
		expect(store.canEdit('1', 'salary')).toBe(false);
	});

	it('api.canCopy() returns boolean', () => {
		const { store } = makeStore({ canCopy: () => true });
		expect(store.canCopy('1', 'name')).toBe(true);
	});

	it('api.canPaste() returns false when denied', () => {
		const { store } = makeStore({ canPaste: () => false });
		expect(store.canPaste('1', 'salary')).toBe(false);
	});

	it('api.canExport() returns false when denied', () => {
		const { store } = makeStore({ canExport: () => false });
		expect(store.canExport('salary')).toBe(false);
	});
});

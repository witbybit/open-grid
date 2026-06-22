import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GridConflictManager } from './GridConflictManager.js';
import { GridInsightRegistry } from '../../insights/GridInsightRegistry.js';
import type { GridCellConflict } from './conflictTypes.js';

function makeManager(overrides?: { setCellValue?: ReturnType<typeof vi.fn> }) {
	const setCellValue = overrides?.setCellValue ?? vi.fn();
	const requestInsightRepaint = vi.fn();
	const manager = new GridConflictManager({ setCellValue, requestInsightRepaint });
	return { manager, setCellValue, requestInsightRepaint };
}

function makeConflict(overrides: Partial<Omit<GridCellConflict, 'id' | 'createdAt'>> = {}): Omit<GridCellConflict, 'id' | 'createdAt'> {
	return {
		rowId: 'r1',
		colField: 'amount',
		baseValue: 100,
		localValue: 200,
		remoteValue: 300,
		source: 'liveStream',
		...overrides,
	};
}

describe('GridConflictManager', () => {
	it('registers as insight layer with id "conflict"', () => {
		const { manager } = makeManager();
		const registry = new GridInsightRegistry();
		registry.register(manager);
		expect(manager.id).toBe('conflict');
		expect(registry.size).toBe(1);
	});

	it('adding conflict decorates the cell', () => {
		const { manager } = makeManager();
		const conflict = manager.addConflict(makeConflict());
		const decs = manager.getCellDecorations('r1', 'amount');
		expect(decs).toHaveLength(1);
		expect(decs[0].className).toBe('og-cell-conflict');
		expect(decs[0].title).toContain('local 200');
		expect(decs[0].title).toContain('remote 300');
		expect(conflict.id).toBeTruthy();
	});

	it('conflict appears in diagnostics', () => {
		const { manager } = makeManager();
		manager.addConflict(makeConflict());
		const diag = manager.getDiagnostics();
		expect(diag.activeConflicts).toBe(1);
		expect(diag.lastConflictAt).not.toBeNull();
	});

	it('keep local removes conflict without mutation', () => {
		const { manager, setCellValue } = makeManager();
		const conflict = manager.addConflict(makeConflict());
		manager.resolveConflict(conflict.id, { strategy: 'local' });
		expect(setCellValue).not.toHaveBeenCalled();
		expect(manager.getConflicts()).toHaveLength(0);
		expect(manager.getDiagnostics().resolvedConflicts).toBe(1);
	});

	it('use remote commits through normal mutation API', () => {
		const { manager, setCellValue } = makeManager();
		const conflict = manager.addConflict(makeConflict({ remoteValue: 999 }));
		manager.resolveConflict(conflict.id, { strategy: 'remote' });
		expect(setCellValue).toHaveBeenCalledWith('r1', 'amount', 999);
		expect(manager.getConflicts()).toHaveLength(0);
	});

	it('custom value commits through normal mutation API', () => {
		const { manager, setCellValue } = makeManager();
		const conflict = manager.addConflict(makeConflict());
		manager.resolveConflict(conflict.id, { strategy: 'custom', value: 555 });
		expect(setCellValue).toHaveBeenCalledWith('r1', 'amount', 555);
		expect(manager.getConflicts()).toHaveLength(0);
	});

	it('clearing conflict removes decoration', () => {
		const { manager } = makeManager();
		const conflict = manager.addConflict(makeConflict());
		manager.clearConflict(conflict.id);
		expect(manager.getCellDecorations('r1', 'amount')).toHaveLength(0);
		expect(manager.getConflicts()).toHaveLength(0);
	});

	it('clearAllConflicts removes all decorations', () => {
		const { manager } = makeManager();
		manager.addConflict(makeConflict({ rowId: 'r1', colField: 'amount' }));
		manager.addConflict(makeConflict({ rowId: 'r2', colField: 'name', localValue: 'A', remoteValue: 'B' }));
		expect(manager.getConflicts()).toHaveLength(2);
		manager.clearAllConflicts();
		expect(manager.getConflicts()).toHaveLength(0);
		expect(manager.getCellDecorations('r1', 'amount')).toHaveLength(0);
	});

	it('getConflict returns conflict for a cell', () => {
		const { manager } = makeManager();
		manager.addConflict(makeConflict());
		const found = manager.getConflict('r1', 'amount');
		expect(found).not.toBeNull();
		expect(found?.rowId).toBe('r1');
	});

	it('adding second conflict for same cell replaces the first', () => {
		const { manager } = makeManager();
		manager.addConflict(makeConflict({ remoteValue: 100 }));
		manager.addConflict(makeConflict({ remoteValue: 200 }));
		expect(manager.getConflicts()).toHaveLength(1);
		expect(manager.getConflict('r1', 'amount')?.remoteValue).toBe(200);
	});

	it('source guards — setCellValue is only called on resolution, not on addConflict', () => {
		const { manager, setCellValue } = makeManager();
		manager.addConflict(makeConflict());
		expect(setCellValue).not.toHaveBeenCalled();
	});

	it('requestInsightRepaint called after addConflict and resolve', () => {
		const { manager, requestInsightRepaint } = makeManager();
		const c = manager.addConflict(makeConflict());
		expect(requestInsightRepaint).toHaveBeenCalledTimes(1);
		manager.resolveConflict(c.id, { strategy: 'local' });
		expect(requestInsightRepaint).toHaveBeenCalledTimes(2);
	});

	it('destroy clears all conflicts', () => {
		const { manager } = makeManager();
		manager.addConflict(makeConflict());
		manager.destroy();
		expect(manager.getConflicts()).toHaveLength(0);
	});

	it('resolved conflicts accumulate in diagnostics', () => {
		const { manager } = makeManager();
		const c1 = manager.addConflict(makeConflict({ rowId: 'r1', colField: 'amount' }));
		const c2 = manager.addConflict(makeConflict({ rowId: 'r2', colField: 'name', localValue: 'A', remoteValue: 'B' }));
		manager.resolveConflict(c1.id, { strategy: 'local' });
		manager.resolveConflict(c2.id, { strategy: 'remote' });
		expect(manager.getDiagnostics().resolvedConflicts).toBe(2);
		expect(manager.getDiagnostics().activeConflicts).toBe(0);
	});
});

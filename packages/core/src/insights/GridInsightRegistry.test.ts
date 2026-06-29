import { describe, it, expect, vi } from 'vitest';
import { GridInsightRegistry } from './GridInsightRegistry.js';
import type { GridInsightLayer, GridCellDecoration, GridRowDecoration } from './insightTypes.js';

function makeLayer(overrides: Partial<GridInsightLayer> = {}): GridInsightLayer {
	return {
		id: 'dataQuality',
		...overrides,
	};
}

describe('GridInsightRegistry', () => {
	it('can register an insight layer', () => {
		const reg = new GridInsightRegistry();
		expect(reg.getVersion()).toBe(0);
		reg.register(makeLayer({ id: 'dataQuality' }));
		expect(reg.size).toBe(1);
		expect(reg.getVersion()).toBe(1);
	});

	it('can unregister an insight layer', () => {
		const reg = new GridInsightRegistry();
		reg.register(makeLayer({ id: 'dataQuality' }));
		expect(reg.getVersion()).toBe(1);
		reg.unregister('dataQuality');
		expect(reg.size).toBe(0);
		expect(reg.getVersion()).toBe(2);
	});

	it('calls destroy() on unregister', () => {
		const reg = new GridInsightRegistry();
		const destroy = vi.fn();
		reg.register(makeLayer({ id: 'dataQuality', destroy }));
		reg.unregister('dataQuality');
		expect(destroy).toHaveBeenCalledOnce();
	});

	it('calls destroy() on replaced layer when registering same id', () => {
		const reg = new GridInsightRegistry();
		const destroy1 = vi.fn();
		reg.register(makeLayer({ id: 'dataQuality', destroy: destroy1 }));
		reg.register(makeLayer({ id: 'dataQuality' }));
		expect(destroy1).toHaveBeenCalledOnce();
		expect(reg.size).toBe(1);
		expect(reg.getVersion()).toBe(2);
	});

	it('clear() destroys all layers', () => {
		const reg = new GridInsightRegistry();
		const destroyA = vi.fn();
		const destroyB = vi.fn();
		reg.register(makeLayer({ id: 'dataQuality', destroy: destroyA }));
		reg.register(makeLayer({ id: 'diff', destroy: destroyB }));
		reg.clear();
		expect(destroyA).toHaveBeenCalledOnce();
		expect(destroyB).toHaveBeenCalledOnce();
		expect(reg.size).toBe(0);
		expect(reg.getVersion()).toBe(3);
	});

	it('aggregates cell decorations from multiple layers', () => {
		const reg = new GridInsightRegistry();
		const dec1: GridCellDecoration = { layerId: 'dataQuality', kind: 'missing', className: 'og-cell-insight-error' };
		const dec2: GridCellDecoration = { layerId: 'diff', kind: 'changed', className: 'og-cell-insight-info' };
		reg.register(makeLayer({ id: 'dataQuality', getCellDecorations: () => [dec1] }));
		reg.register(makeLayer({ id: 'diff', getCellDecorations: () => [dec2] }));
		const result = reg.getCellDecorations('row-1', 'amount');
		expect(result).toHaveLength(2);
		expect(result).toContain(dec1);
		expect(result).toContain(dec2);
	});

	it('aggregates row decorations from multiple layers', () => {
		const reg = new GridInsightRegistry();
		const dec1: GridRowDecoration = { layerId: 'dataQuality', kind: 'invalid-row', className: 'og-row-insight-error' };
		const dec2: GridRowDecoration = { layerId: 'conflict', kind: 'has-conflict', className: 'og-row-insight-warning' };
		reg.register(makeLayer({ id: 'dataQuality', getRowDecorations: () => [dec1] }));
		reg.register(makeLayer({ id: 'conflict', getRowDecorations: () => [dec2] }));
		const result = reg.getRowDecorations('row-1');
		expect(result).toHaveLength(2);
		expect(result).toContain(dec1);
		expect(result).toContain(dec2);
	});

	it('returns empty array when no layers registered', () => {
		const reg = new GridInsightRegistry();
		expect(reg.getCellDecorations('row-1', 'amount')).toHaveLength(0);
		expect(reg.getRowDecorations('row-1')).toHaveLength(0);
	});

	it('returns empty array for layers that do not implement getCellDecorations', () => {
		const reg = new GridInsightRegistry();
		reg.register(makeLayer({ id: 'dataQuality' })); // no getCellDecorations
		expect(reg.getCellDecorations('row-1', 'amount')).toHaveLength(0);
	});

	it('diagnostics include each registered layer', () => {
		const reg = new GridInsightRegistry();
		reg.register(makeLayer({ id: 'dataQuality', getDiagnostics: () => ({ issueCount: 3 }) }));
		reg.register(makeLayer({ id: 'diff', getDiagnostics: () => ({ changedCells: 7 }) }));
		const diag = reg.getDiagnostics();
		expect(diag['dataQuality']).toEqual({ issueCount: 3 });
		expect(diag['diff']).toEqual({ changedCells: 7 });
	});

	it('diagnostics return null for layers without getDiagnostics', () => {
		const reg = new GridInsightRegistry();
		reg.register(makeLayer({ id: 'dataQuality' }));
		const diag = reg.getDiagnostics();
		expect(diag['dataQuality']).toBeNull();
	});

	it('insight decorations do not mutate the returned snapshot on subsequent calls', () => {
		const reg = new GridInsightRegistry();
		const dec: GridCellDecoration = { layerId: 'dataQuality', kind: 'test', className: 'og-cell-insight-warning' };
		reg.register(makeLayer({ id: 'dataQuality', getCellDecorations: () => [dec] }));
		const first = reg.getCellDecorations('row-1', 'x');
		const second = reg.getCellDecorations('row-1', 'x');
		// Both are valid snapshots; each call returns an independent array
		expect(first).not.toBe(second);
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
	});

	it('unregistering a non-existent id is a no-op', () => {
		const reg = new GridInsightRegistry();
		expect(() => reg.unregister('dataQuality')).not.toThrow();
	});

	it('clearing an empty registry is a no-op', () => {
		const reg = new GridInsightRegistry();
		expect(() => reg.clear()).not.toThrow();
		expect(reg.getVersion()).toBe(0);
	});
});

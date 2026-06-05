import { describe, expect, it } from 'vitest';

import { InvalidationManager } from './invalidationManager.js';

describe('InvalidationManager', () => {
	it('coalesces repeated invalidations into one frame', () => {
		const manager = new InvalidationManager();

		manager.invalidateCell('row-1', 'name', 'edit');
		manager.invalidateCell('row-1', 'name', 'edit');
		manager.invalidateRow('row-1', 'focus');
		manager.invalidateHeaders('sort');

		const frame = manager.consume();

		expect(frame.full).toBe(false);
		expect(frame.cellsByRowId.size).toBe(1);
		expect(frame.cellsByRowId.get('row-1')).toEqual(new Set(['name']));
		expect(frame.rows.size).toBe(1);
		expect(frame.headers).toBe(true);
		expect(frame.reasons).toEqual(['edit', 'focus', 'sort']);

		const next = manager.consume();
		expect(next.cellsByRowId.size).toBe(0);
		expect(next.rows.size).toBe(0);
		expect(next.headers).toBe(false);
	});

	it('keeps row ids with colons structurally separate from column ids', () => {
		const manager = new InvalidationManager();

		manager.invalidateCell('row:0', 'name', 'edit');
		manager.invalidateCell('custom:id:abc', 'status', 'edit');
		manager.invalidateCell('group:status:Active', 'name', 'edit');
		manager.invalidateCell('row:0', 'status', 'edit');
		manager.invalidateCell('row:0', 'status', 'edit');

		const frame = manager.consume();

		expect(frame.cellsByRowId.get('row:0')).toEqual(new Set(['name', 'status']));
		expect(frame.cellsByRowId.get('custom:id:abc')).toEqual(new Set(['status']));
		expect(frame.cellsByRowId.get('group:status:Active')).toEqual(new Set(['name']));
		expect(frame.reasons).toEqual(['edit']);
	});

	it('lets full invalidation override granular paint work', () => {
		const manager = new InvalidationManager();

		manager.invalidateCell('row-1', 'name', 'edit');
		manager.invalidateGeometry('resize');
		manager.invalidateFull('columns');

		const frame = manager.consume();

		expect(frame.full).toBe(true);
		expect(frame.cellsByRowId.size).toBe(0);
		expect(frame.geometry).toBe(false);
		expect(frame.reasons).toEqual(['edit', 'resize', 'columns']);
	});
});

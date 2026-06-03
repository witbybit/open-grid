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
		expect(frame.cells.size).toBe(1);
		expect(frame.rows.size).toBe(1);
		expect(frame.headers).toBe(true);
		expect(frame.reasons).toEqual(['edit', 'focus', 'sort']);

		const next = manager.consume();
		expect(next.cells.size).toBe(0);
		expect(next.rows.size).toBe(0);
		expect(next.headers).toBe(false);
	});

	it('lets full invalidation override granular paint work', () => {
		const manager = new InvalidationManager();

		manager.invalidateCell('row-1', 'name', 'edit');
		manager.invalidateGeometry('resize');
		manager.invalidateFull('columns');

		const frame = manager.consume();

		expect(frame.full).toBe(true);
		expect(frame.cells.size).toBe(0);
		expect(frame.geometry).toBe(false);
		expect(frame.reasons).toEqual(['edit', 'resize', 'columns']);
	});
});

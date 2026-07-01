import { describe, expect, it, vi } from 'vitest';

import { RenderOrchestrator } from './renderOrchestrator.js';
import type { InvalidationFrame } from './invalidationManager.js';

function createFrame(overrides: Partial<InvalidationFrame> = {}): InvalidationFrame {
	return {
		full: false,
		cellsByRowId: new Map(),
		rows: new Set(),
		rowRanges: [],
		columns: new Set(),
		groups: new Set(),
		headers: false,
		overlay: false,
		geometry: false,
		viewport: false,
		reasons: [],
		invalidations: [],
		...overrides,
	};
}

describe('RenderOrchestrator', () => {
	it('treats row-range invalidations as viewport work instead of ignoring them', () => {
		const recomputeGeometry = vi.fn();
		const syncViewport = vi.fn();
		const syncHeaders = vi.fn();
		const syncOverlay = vi.fn();
		const syncRows = vi.fn();
		const syncCells = vi.fn();
		const fullPaint = vi.fn();
		const orchestrator = new RenderOrchestrator({
			recomputeGeometry,
			syncViewport,
			syncHeaders,
			syncOverlay,
			syncRows,
			syncCells,
			fullPaint,
		});

		orchestrator.flush(
			createFrame({
				rowRanges: [{ startIndex: 4, endIndex: 9, reason: 'data' }],
				reasons: ['data'],
				invalidations: [{ kind: 'row-range', startIndex: 4, endIndex: 9, reason: 'data' }],
			})
		);

		expect(syncViewport).toHaveBeenCalledTimes(1);
		expect(syncOverlay).toHaveBeenCalledTimes(1);
		expect(syncRows).not.toHaveBeenCalled();
		expect(syncCells).not.toHaveBeenCalled();
		expect(fullPaint).not.toHaveBeenCalled();
		expect(recomputeGeometry).not.toHaveBeenCalled();
		expect(syncHeaders).not.toHaveBeenCalled();
		expect(orchestrator.getStats().rowPaints).toBe(6);
	});

	it('treats group invalidations as viewport work instead of ignoring them', () => {
		const syncViewport = vi.fn();
		const syncOverlay = vi.fn();
		const orchestrator = new RenderOrchestrator({
			recomputeGeometry: vi.fn(),
			syncViewport,
			syncHeaders: vi.fn(),
			syncOverlay,
			syncRows: vi.fn(),
			syncCells: vi.fn(),
			fullPaint: vi.fn(),
		});

		orchestrator.flush(
			createFrame({
				groups: new Set(['group:region:Americas']),
				reasons: ['group expansion'],
				invalidations: [{ kind: 'group', groupId: 'group:region:Americas', reason: 'group expansion' }],
			})
		);

		expect(syncViewport).toHaveBeenCalledTimes(1);
		expect(syncOverlay).toHaveBeenCalledTimes(1);
	});
});

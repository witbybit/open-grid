// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CustomRendererManager, type AcquireRendererParams } from './customRendererManager.js';

interface Row {
	id: string;
}

function makeEngineStub(runtimeLimits?: { maxWarmCustomRenderers?: number }): any {
	return {
		isScrolling: false,
		customRendererMountsDuringScroll: 0,
		customRendererWarmHits: 0,
		customRendererWarmMisses: 0,
		stateManager: { getState: () => ({ runtimeLimits }) },
	};
}

function acquireParams(rowIndex: number, colIndex: number, parentContainer: HTMLElement): AcquireRendererParams<Row> {
	const rendererKey = `r${rowIndex}c${colIndex}`;
	return {
		rendererKey,
		cellKey: rendererKey,
		rowSlotId: `slot-${rowIndex % 20}`,
		slotGeneration: 0,
		cellRowBindingGeneration: 0,
		parentContainer,
		value: `v${rowIndex}-${colIndex}`,
		node: { id: `row-${rowIndex}`, data: { id: `row-${rowIndex}` } } as any,
		col: { field: `c${colIndex}` } as any,
		isEditing: false,
		isLoading: false,
		phase: 'scroll',
		isScrolling: false,
		isFocused: false,
		isSelected: false,
	};
}

/**
 * Simulates scrolling forward through `rowDepth` rows (each with `colsPerRow` custom-renderer
 * cells), releasing each row's cells as 'scrolled-out' as it exits, then scrolling all the way
 * back to row 0 and re-acquiring every cell again — the realistic "review rows, then scroll back
 * up" pattern. Returns the manager after the round trip so callers can inspect warm hit/miss stats.
 */
function scrollForwardThenBack<TRowData>(manager: CustomRendererManager<TRowData>, rowDepth: number, colsPerRow: number): void {
	const parent = document.createElement('div');
	// Forward pass: acquire then immediately release each row (simulating it scrolling out).
	for (let r = 0; r < rowDepth; r++) {
		for (let c = 0; c < colsPerRow; c++) {
			const instance = manager.acquire(acquireParams(r, c, parent) as any);
			manager.releaseByCellKey(instance.cellKey, 'scrolled-out');
		}
	}
	// Reverse pass: scroll back to the top, re-acquiring every cell scrolled past.
	for (let r = 0; r < rowDepth; r++) {
		for (let c = 0; c < colsPerRow; c++) {
			manager.acquire(acquireParams(r, c, parent) as any);
		}
	}
}

describe('CustomRendererManager warm cache sizing', () => {
	it('characterizes cold-mount thrashing when the warm cache is undersized relative to scroll-back depth', () => {
		// 10 custom-renderer columns x 12 rows scrolled past = 120 distinct cells, well over the
		// old hardcoded default of 50. Force that old behavior via an explicit override.
		const manager = new CustomRendererManager<Row>(makeEngineStub());
		manager.setLimits(50, 30_000);

		scrollForwardThenBack(manager, 12, 10);

		const stats = manager.getStats();
		// Reverse-pass total acquires = 120. Only the most-recently-exited ~50 could possibly
		// still be warm by LRU order; the rest were evicted before the user scrolled back.
		expect(stats.warmMisses).toBeGreaterThan(50);
		expect(stats.warmHits).toBeLessThan(70);
	});

	it('a warm cache sized for the actual scroll-back depth turns the same session into mostly warm hits', () => {
		const manager = new CustomRendererManager<Row>(makeEngineStub());
		manager.setLimits(200, 30_000); // sized comfortably above the 120 distinct cells below

		scrollForwardThenBack(manager, 12, 10);

		const stats = manager.getStats();
		// Every one of the 120 reverse-pass acquires should now hit the warm cache — nothing was
		// evicted before the user scrolled back to it.
		expect(stats.warmMisses).toBe(120); // the 120 forward-pass cold mounts (first time seen)
		expect(stats.warmHits).toBe(120); // the 120 reverse-pass reuses
	});

	it('honors maxWarmCustomRenderers from live runtimeLimits config with no explicit setLimits call', () => {
		const manager = new CustomRendererManager<Row>(makeEngineStub({ maxWarmCustomRenderers: 200 }));

		scrollForwardThenBack(manager, 12, 10);

		const stats = manager.getStats();
		expect(stats.warmHits).toBe(120);
		expect(stats.warmMisses).toBe(120);
	});

	it('defaults to 300 (not the old 50) when no engine and no explicit override are provided', () => {
		const manager = new CustomRendererManager<Row>();
		// 25 rows x 10 cols = 250 distinct cells — under the new default of 300, over the old 50.
		scrollForwardThenBack(manager, 25, 10);

		const stats = manager.getStats();
		expect(stats.warmHits).toBe(250);
		expect(stats.warmMisses).toBe(250);
	});

	it('an explicit setLimits() call still overrides the live runtimeLimits config', () => {
		const manager = new CustomRendererManager<Row>(makeEngineStub({ maxWarmCustomRenderers: 300 }));
		manager.setLimits(10, 30_000);

		scrollForwardThenBack(manager, 12, 10);

		const stats = manager.getStats();
		// Cache capped at 10 — virtually everything in the reverse pass is a cold remount.
		expect(stats.warmMisses).toBeGreaterThan(110);
	});
});

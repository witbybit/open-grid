import { describe, it, expect } from 'vitest';
import { GridMetric, NoopGridInstrumentation, RecordingGridInstrumentation, NOOP_INSTRUMENTATION } from './GridInstrumentation.js';

describe('NoopGridInstrumentation', () => {
	it('increment is a no-op — does not throw', () => {
		const inst = new NoopGridInstrumentation();
		expect(() => inst.increment(GridMetric.FULL_PAINTS)).not.toThrow();
		expect(() => inst.increment(GridMetric.SCROLL_FRAMES, 10)).not.toThrow();
	});

	it('recordFrame is a no-op — does not throw', () => {
		const inst = new NoopGridInstrumentation();
		expect(() => inst.recordFrame({ kind: 'scroll', durationMs: 5, rowsVisited: 10, cellsWritten: 20 })).not.toThrow();
	});

	it('recordFallback is a no-op — does not throw', () => {
		const inst = new NoopGridInstrumentation();
		expect(() => inst.recordFallback({ reason: 'test', component: 'renderer' })).not.toThrow();
	});

	it('snapshot returns a stable empty object', () => {
		const inst = new NoopGridInstrumentation();
		const a = inst.snapshot();
		const b = inst.snapshot();
		expect(a).toBe(b); // same reference — no allocation on every call
		expect(Object.keys(a.counters)).toHaveLength(0);
		expect(a.frames).toHaveLength(0);
		expect(a.fallbacks).toHaveLength(0);
	});

	it('reset is a no-op — does not throw', () => {
		const inst = new NoopGridInstrumentation();
		expect(() => inst.reset()).not.toThrow();
	});

	it('NOOP_INSTRUMENTATION shared instance reuses the same snapshot each call', () => {
		expect(NOOP_INSTRUMENTATION.snapshot()).toBe(NOOP_INSTRUMENTATION.snapshot());
	});
});

describe('RecordingGridInstrumentation', () => {
	it('increment accumulates a single counter', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.FULL_PAINTS);
		inst.increment(GridMetric.FULL_PAINTS);
		expect(inst.get(GridMetric.FULL_PAINTS)).toBe(2);
	});

	it('increment accepts a custom amount', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.SCROLL_FRAMES, 5);
		inst.increment(GridMetric.SCROLL_FRAMES, 3);
		expect(inst.get(GridMetric.SCROLL_FRAMES)).toBe(8);
	});

	it('get returns 0 for a metric that was never incremented', () => {
		const inst = new RecordingGridInstrumentation();
		expect(inst.get(GridMetric.CELL_PAINTS)).toBe(0);
	});

	it('different metrics are tracked independently', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.FULL_PAINTS, 3);
		inst.increment(GridMetric.SCROLL_FRAMES, 7);
		expect(inst.get(GridMetric.FULL_PAINTS)).toBe(3);
		expect(inst.get(GridMetric.SCROLL_FRAMES)).toBe(7);
	});

	it('recordFrame stores frame data accessible via snapshot', () => {
		const inst = new RecordingGridInstrumentation();
		inst.recordFrame({ kind: 'scroll', durationMs: 12, rowsVisited: 50, cellsWritten: 200 });
		inst.recordFrame({ kind: 'full', durationMs: 30, rowsVisited: 100, cellsWritten: 500 });
		const snap = inst.snapshot();
		expect(snap.frames).toHaveLength(2);
		expect(snap.frames[0].kind).toBe('scroll');
		expect(snap.frames[1].kind).toBe('full');
	});

	it('recordFallback stores fallback data accessible via snapshot', () => {
		const inst = new RecordingGridInstrumentation();
		inst.recordFallback({ reason: 'viewport overflow', component: 'rowRenderer' });
		const snap = inst.snapshot();
		expect(snap.fallbacks).toHaveLength(1);
		expect(snap.fallbacks[0].reason).toBe('viewport overflow');
	});

	it('snapshot returns a defensive copy — mutation does not affect internal state', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.FULL_PAINTS, 3);
		const snap = inst.snapshot();
		(snap.counters as Record<string, number>)[GridMetric.FULL_PAINTS] = 999;
		expect(inst.get(GridMetric.FULL_PAINTS)).toBe(3); // internal state unchanged
	});

	it('reset clears all counters, frames, and fallbacks', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.FULL_PAINTS, 5);
		inst.recordFrame({ kind: 'scroll', durationMs: 5, rowsVisited: 10, cellsWritten: 20 });
		inst.recordFallback({ reason: 'x', component: 'y' });
		inst.reset();
		expect(inst.get(GridMetric.FULL_PAINTS)).toBe(0);
		expect(inst.snapshot().frames).toHaveLength(0);
		expect(inst.snapshot().fallbacks).toHaveLength(0);
	});

	it('counters in snapshot reflect state at snapshot time — not live', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.FULL_PAINTS, 1);
		const snap = inst.snapshot();
		inst.increment(GridMetric.FULL_PAINTS, 99);
		// Snapshot was taken before the second increment
		expect(snap.counters[GridMetric.FULL_PAINTS]).toBe(1);
	});
});

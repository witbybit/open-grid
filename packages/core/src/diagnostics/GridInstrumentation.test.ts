import { describe, it, expect } from 'vitest';
import { GridMetric, NoopGridInstrumentation, RecordingGridInstrumentation, NOOP_INSTRUMENTATION } from './GridInstrumentation.js';

describe('NoopGridInstrumentation', () => {
	it('increment is a no-op and does not throw', () => {
		const inst = new NoopGridInstrumentation();
		expect(() => inst.increment(GridMetric.STATE_READS)).not.toThrow();
		expect(() => inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL, 10)).not.toThrow();
	});

	it('recordFrame is a no-op and does not throw', () => {
		const inst = new NoopGridInstrumentation();
		expect(() => inst.recordFrame({ kind: 'scroll', durationMs: 5, rowsVisited: 10, cellsWritten: 20 })).not.toThrow();
	});

	it('recordFallback is a no-op and does not throw', () => {
		const inst = new NoopGridInstrumentation();
		expect(() => inst.recordFallback({ reason: 'test', component: 'renderer' })).not.toThrow();
	});

	it('snapshot returns a stable empty object', () => {
		const inst = new NoopGridInstrumentation();
		const a = inst.snapshot();
		const b = inst.snapshot();
		expect(a).toBe(b);
		expect(Object.keys(a.counters)).toHaveLength(0);
		expect(a.frames).toHaveLength(0);
		expect(a.fallbacks).toHaveLength(0);
	});

	it('reset is a no-op and does not throw', () => {
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
		inst.increment(GridMetric.STATE_READS);
		inst.increment(GridMetric.STATE_READS);
		expect(inst.get(GridMetric.STATE_READS)).toBe(2);
	});

	it('increment accepts a custom amount', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL, 5);
		inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL, 3);
		expect(inst.get(GridMetric.ROW_MUTATION_INCREMENTAL)).toBe(8);
	});

	it('get returns 0 for a metric that was never incremented', () => {
		const inst = new RecordingGridInstrumentation();
		expect(inst.get(GridMetric.SLOT_REBINDS)).toBe(0);
	});

	it('different metrics are tracked independently', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.STATE_READS, 3);
		inst.increment(GridMetric.ROW_MUTATION_FULL_REBUILD, 7);
		expect(inst.get(GridMetric.STATE_READS)).toBe(3);
		expect(inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD)).toBe(7);
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

	it('snapshot returns a defensive copy and mutation does not affect internal state', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.STATE_READS, 3);
		const snap = inst.snapshot();
		(snap.counters as Record<string, number>)[GridMetric.STATE_READS] = 999;
		expect(inst.get(GridMetric.STATE_READS)).toBe(3);
	});

	it('reset clears all counters, frames, and fallbacks', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.STATE_READS, 5);
		inst.recordFrame({ kind: 'scroll', durationMs: 5, rowsVisited: 10, cellsWritten: 20 });
		inst.recordFallback({ reason: 'x', component: 'y' });
		inst.reset();
		expect(inst.get(GridMetric.STATE_READS)).toBe(0);
		expect(inst.snapshot().frames).toHaveLength(0);
		expect(inst.snapshot().fallbacks).toHaveLength(0);
	});

	it('counters in snapshot reflect state at snapshot time and are not live', () => {
		const inst = new RecordingGridInstrumentation();
		inst.increment(GridMetric.STATE_READS, 1);
		const snap = inst.snapshot();
		inst.increment(GridMetric.STATE_READS, 99);
		expect(snap.counters[GridMetric.STATE_READS]).toBe(1);
	});

	it('keeps bounded histories in oldest-to-newest order and reports dropped events', () => {
		const inst = new RecordingGridInstrumentation({ frameCapacity: 2, fallbackCapacity: 1 });
		for (let index = 0; index < 4; index++) {
			inst.recordFrame({ kind: 'scroll', durationMs: index, rowsVisited: index, cellsWritten: index });
		}
		inst.recordFallback({ reason: 'first', component: 'test' });
		inst.recordFallback({ reason: 'second', component: 'test' });

		const snapshot = inst.snapshot();
		expect(snapshot.frames.map((frame) => frame.durationMs)).toEqual([2, 3]);
		expect(snapshot.fallbacks.map((fallback) => fallback.reason)).toEqual(['second']);
		expect(snapshot.droppedFrames).toBe(2);
		expect(snapshot.droppedFallbacks).toBe(1);
	});

	it('supports disabled histories, resets ring state, and stays bounded over a long session', () => {
		const disabled = new RecordingGridInstrumentation({ frameCapacity: 0, fallbackCapacity: 0 });
		disabled.recordFrame({ kind: 'scroll', durationMs: 0, rowsVisited: 0, cellsWritten: 0 });
		disabled.recordFallback({ reason: 'ignored', component: 'test' });
		expect(disabled.snapshot()).toMatchObject({ frames: [], fallbacks: [], droppedFrames: 1, droppedFallbacks: 1 });

		const inst = new RecordingGridInstrumentation({ frameCapacity: 3, fallbackCapacity: 2 });
		for (let index = 0; index < 100_000; index++) {
			inst.recordFrame({ kind: 'scroll', durationMs: index, rowsVisited: index, cellsWritten: index });
		}
		expect(inst.snapshot().frames.map((frame) => frame.durationMs)).toEqual([99_997, 99_998, 99_999]);
		expect(inst.snapshot().droppedFrames).toBe(99_997);
		inst.reset();
		expect(inst.snapshot()).toMatchObject({ frames: [], fallbacks: [], droppedFrames: 0, droppedFallbacks: 0 });
	});
});

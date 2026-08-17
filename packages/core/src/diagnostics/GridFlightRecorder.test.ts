import { describe, expect, it, vi } from 'vitest';
import { GridFlightRecorder } from './GridFlightRecorder.js';

describe('GridFlightRecorder', () => {
	it('is disabled with a stable empty snapshot and does not invoke event factories', () => {
		const recorder = new GridFlightRecorder();
		const factory = vi.fn(() => ({
			type: 'fallback' as const,
			component: 'x',
			reason: 'y',
			changeIds: [],
			correlation: 'uncorrelated' as const,
		}));
		recorder.record(factory);
		expect(factory).not.toHaveBeenCalled();
		expect(recorder.snapshot()).toBe(recorder.snapshot());
		expect(recorder.snapshot().events).toEqual([]);
	});

	it('does not allocate attempt IDs while inactive', () => {
		const recorder = new GridFlightRecorder();
		expect(recorder.beginCommitAttempt('inactive')).toBeUndefined();
		recorder.finishCommitAttempt(undefined, 'validation-rejected');
		recorder.start();
		const attemptId = recorder.beginCommitAttempt('active', { rowId: 'r', colField: 'c' });
		recorder.finishCommitAttempt(attemptId, 'validation-rejected');
		expect(attemptId).toBe(1);
		expect(recorder.snapshot().events.map((entry) => entry.event.type)).toEqual(['commit-request', 'commit-outcome']);
	});

	it('does not read the frame clock while inactive', () => {
		const clock = vi.fn(() => 1);
		const recorder = new GridFlightRecorder(clock);
		const token = recorder.beginExecutingFrame([1]);
		recorder.finishExecutingFrame(token, 'full');
		expect(token).toBeUndefined();
		expect(clock).not.toHaveBeenCalled();
		expect(recorder.snapshot().events).toEqual([]);
	});

	it('records deterministic frame duration with the exact cause IDs', () => {
		const clock = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(13.5);
		const recorder = new GridFlightRecorder(clock);
		recorder.start();
		const changeIds = [4, 7] as const;
		const token = recorder.beginExecutingFrame(changeIds);
		recorder.finishExecutingFrame(token, 'full');
		expect(recorder.snapshot().events[0]?.event).toEqual({
			type: 'frame',
			changeIds,
			correlation: 'render-request',
			kind: 'full',
			durationMs: 3.5,
		});
	});

	it('emits an untimed frame when clock reads fail, are non-finite, or move backward', () => {
		for (const clock of [
			vi.fn(() => {
				throw new Error('clock');
			}),
			vi.fn(() => Number.NaN),
			vi.fn().mockReturnValueOnce(8).mockReturnValueOnce(7),
		]) {
			const recorder = new GridFlightRecorder(clock);
			recorder.start();
			expect(() => recorder.finishExecutingFrame(recorder.beginExecutingFrame([]), 'full')).not.toThrow();
			const event = recorder.snapshot().events[0]?.event;
			expect(event).toMatchObject({ type: 'frame', changeIds: [], correlation: 'uncorrelated', kind: 'full' });
			expect(event).not.toHaveProperty('durationMs');
		}
	});

	it('restores nested frame context and measures each frame independently', () => {
		const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(2).mockReturnValueOnce(5).mockReturnValueOnce(10);
		const recorder = new GridFlightRecorder(clock);
		recorder.start();
		const outer = recorder.beginExecutingFrame([1]);
		const inner = recorder.beginExecutingFrame([2]);
		recorder.recordObservedFallback('renderer', 'inner');
		recorder.finishExecutingFrame(inner, 'post-scroll');
		recorder.recordObservedFallback('renderer', 'outer');
		recorder.finishExecutingFrame(outer, 'full');

		const events = recorder.snapshot().events.map((entry) => entry.event);
		expect(events).toEqual([
			{ type: 'fallback', component: 'renderer', reason: 'inner', changeIds: [2], correlation: 'render-request' },
			{ type: 'frame', changeIds: [2], correlation: 'render-request', kind: 'post-scroll', durationMs: 3 },
			{ type: 'fallback', component: 'renderer', reason: 'outer', changeIds: [1], correlation: 'render-request' },
			{ type: 'frame', changeIds: [1], correlation: 'render-request', kind: 'full', durationMs: 10 },
		]);
	});

	it('restores context but does not read or emit across recorder sessions', () => {
		const clock = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);
		const recorder = new GridFlightRecorder(clock);
		recorder.start();
		const token = recorder.beginExecutingFrame([3]);
		recorder.stop();
		recorder.start();
		recorder.finishExecutingFrame(token, 'full');
		expect(recorder.getExecutingFrameChangeIds()).toEqual([]);
		expect(recorder.snapshot().events).toEqual([]);

		const current = recorder.beginExecutingFrame([9]);
		recorder.recordObservedFallback('renderer', 'current');
		recorder.finishExecutingFrame(current, 'full');
		expect(clock).toHaveBeenCalledTimes(3);
		expect(recorder.snapshot().events.map((entry) => entry.event)).toEqual([
			{ type: 'fallback', component: 'renderer', reason: 'current', changeIds: [9], correlation: 'render-request' },
			{ type: 'frame', changeIds: [9], correlation: 'render-request', kind: 'full', durationMs: 1 },
		]);
	});

	it('wraps at fixed capacity with monotonic sequence and drop accounting', () => {
		const recorder = new GridFlightRecorder();
		recorder.start({ capacity: 2 });
		for (let index = 0; index < 4; index++)
			recorder.record(() => ({ type: 'fallback', component: 'test', reason: String(index), changeIds: [], correlation: 'uncorrelated' }));
		const snapshot = recorder.snapshot();
		expect(snapshot.events.map((entry) => entry.sequence)).toEqual([3, 4]);
		expect(snapshot.dropped).toBe(2);
	});

	it('supports zero capacity without constructing or retaining payloads', () => {
		const recorder = new GridFlightRecorder();
		const factory = vi.fn(() => ({
			type: 'fallback' as const,
			component: 'x',
			reason: 'y',
			changeIds: [],
			correlation: 'uncorrelated' as const,
		}));
		recorder.start({ capacity: 0 });
		recorder.record(factory);
		expect(factory).not.toHaveBeenCalled();
		expect(recorder.snapshot()).toMatchObject({ active: true, dropped: 1, events: [] });
	});

	it('normalizes invalid, fractional, negative, and absurd recorder capacities', () => {
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			const recorder = new GridFlightRecorder();
			expect(() => recorder.start({ capacity: value })).not.toThrow();
			expect((recorder as unknown as { capacity: number }).capacity).toBe(256);
		}
		const fractional = new GridFlightRecorder();
		fractional.start({ capacity: 2.9 });
		expect((fractional as unknown as { capacity: number }).capacity).toBe(2);
		const negative = new GridFlightRecorder();
		negative.start({ capacity: -4 });
		expect((negative as unknown as { capacity: number }).capacity).toBe(0);
		const huge = new GridFlightRecorder();
		expect(() => huge.start({ capacity: Number.MAX_SAFE_INTEGER })).not.toThrow();
		expect((huge as unknown as { capacity: number }).capacity).toBe(100_000);
	});

	it('honors start, stop, clear, and destroy terminality', () => {
		const recorder = new GridFlightRecorder();
		recorder.start();
		recorder.record(() => ({ type: 'fallback', component: 'test', reason: 'one', changeIds: [], correlation: 'uncorrelated' }));
		recorder.stop();
		recorder.record(() => ({ type: 'fallback', component: 'test', reason: 'two', changeIds: [], correlation: 'uncorrelated' }));
		expect(recorder.snapshot().events).toHaveLength(1);
		recorder.clear();
		expect(recorder.snapshot().events).toHaveLength(0);
		recorder.destroy();
		recorder.start();
		expect(recorder.snapshot().active).toBe(false);
	});

	it('redacts before storage, isolates thrown redactors, and detaches snapshots', () => {
		const cell = { rowId: 'a:b\0雪', colField: 'c:d' };
		const recorder = new GridFlightRecorder();
		recorder.start({ captureValues: 'full', redactValue: () => ({ secret: 'masked' }) });
		const captured = recorder.captureValue({ secret: 'raw' }, cell);
		recorder.record(() => ({ type: 'cell-change', cell, value: captured }));
		const first = recorder.snapshot();
		expect(JSON.stringify(first)).not.toContain('raw');
		expect(() => (first.events as any[]).push('mutated')).toThrow();
		expect(() => ((first.events[0].event as any).value.mode = 'mutated')).toThrow();
		expect(recorder.snapshot().events).toHaveLength(1);

		const throwing = new GridFlightRecorder();
		throwing.start({
			captureValues: 'full',
			redactValue: () => {
				throw new Error('redactor');
			},
		});
		expect(throwing.captureValue('raw', cell)).toEqual({ mode: 'metadata', type: 'redaction-error', isNull: false });
	});

	it('does not invoke a redactor while inactive or after destruction', () => {
		const redactValue = vi.fn((value) => value);
		const recorder = new GridFlightRecorder();
		expect(recorder.captureValue('raw', { rowId: 'r', colField: 'c' })).toBeUndefined();
		recorder.start({ captureValues: 'full', redactValue });
		recorder.destroy();
		expect(recorder.captureValue('raw', { rowId: 'r', colField: 'c' })).toBeUndefined();
		expect(redactValue).not.toHaveBeenCalled();
	});

	it('explains only the exact cell and correlates its change ID', () => {
		const recorder = new GridFlightRecorder();
		recorder.start();
		recorder.record(() => ({ type: 'invalidation', changeId: 1, reason: 'cell', domains: ['rows'] }));
		recorder.record(() => ({ type: 'cell-change', changeId: 1, cell: { rowId: 'r:雪', colField: 'c\0x' } }));
		recorder.record(() => ({ type: 'commit-outcome', attemptId: 1, changeId: 1, outcome: 'accepted', domains: ['rows'] }));
		recorder.record(() => ({
			type: 'frame',
			changeIds: [1],
			correlation: 'render-request',
			frameEpoch: 1,
			kind: 'full',
			rowsVisited: 1,
			cellsWritten: 1,
		}));
		expect(recorder.explainCell('r:雪', 'c\0x').lastChange.status).toBe('known');
		expect(recorder.explainCell('r:雪', 'c\0x').commit.status).toBe('known');
		expect(recorder.explainCell('r:雪', 'c\0x').invalidation.status).toBe('known');
		expect(recorder.explainCell('r', '雪:c\0x').lastChange.status).toBe('unknown');
	});

	it('never associates a frame from another change', () => {
		const recorder = new GridFlightRecorder();
		recorder.start();
		recorder.record(() => ({ type: 'cell-change', changeId: 1, cell: { rowId: 'r1', colField: 'c' } }));
		recorder.record(() => ({
			type: 'frame',
			changeIds: [2],
			correlation: 'render-request',
			frameEpoch: 2,
			kind: 'full',
			rowsVisited: 1,
			cellsWritten: 1,
		}));
		recorder.record(() => ({ type: 'cell-change', changeId: 2, cell: { rowId: 'r2', colField: 'c' } }));
		recorder.record(() => ({
			type: 'frame',
			changeIds: [1],
			correlation: 'render-request',
			frameEpoch: 1,
			kind: 'full',
			rowsVisited: 1,
			cellsWritten: 1,
		}));
		const first = recorder.explainCell('r1', 'c');
		const second = recorder.explainCell('r2', 'c');
		expect(first.frame.status === 'known' && first.frame.value.event.type === 'frame' && first.frame.value.event.changeIds).toEqual([1]);
		expect(second.frame.status === 'known' && second.frame.value.event.type === 'frame' && second.frame.value.event.changeIds).toEqual([2]);
	});
});

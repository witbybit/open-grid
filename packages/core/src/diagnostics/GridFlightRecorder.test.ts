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

import { describe, expect, it, vi } from 'vitest';
import { RuntimeFaultReporter } from './RuntimeFaultReporter.js';

describe('RuntimeFaultReporter', () => {
	it('captures, emits, and snapshots runtime faults', () => {
		const emit = vi.fn();
		const log = vi.fn();
		const reporter = new RuntimeFaultReporter({ emit, log });

		const error = new Error('boom');
		const fault = reporter.report({
			source: 'event-bus',
			operation: 'selectionChanged',
			error,
			context: { key: 'selection' },
		});

		expect(fault.message).toBe('boom');
		expect(reporter.snapshot()).toEqual([fault]);
		expect(emit).toHaveBeenCalledWith(fault);
		expect(log).toHaveBeenCalledWith(fault);
	});

	it('respects the bounded fault capacity', () => {
		const reporter = new RuntimeFaultReporter({ capacity: 2, log: vi.fn() });

		reporter.report({ source: 'event-bus', operation: 'a', error: new Error('a') }, { emitEvent: false });
		reporter.report({ source: 'event-bus', operation: 'b', error: new Error('b') }, { emitEvent: false });
		reporter.report({ source: 'event-bus', operation: 'c', error: new Error('c') }, { emitEvent: false });

		expect(reporter.snapshot().map((fault) => fault.operation)).toEqual(['b', 'c']);
	});

	it('can clear captured faults', () => {
		const reporter = new RuntimeFaultReporter({ log: vi.fn() });
		reporter.report({ source: 'command-history', operation: 'undo', error: new Error('fail') }, { emitEvent: false });
		reporter.clear();
		expect(reporter.snapshot()).toEqual([]);
	});
});

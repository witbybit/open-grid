import { describe, it, expect } from 'vitest';
import { CommandHistory } from './CommandHistory.js';
import { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';

describe('CommandHistory', () => {
	it('reports rejected undo results through RuntimeFaultReporter', () => {
		const faultReporter = new RuntimeFaultReporter({ log: () => undefined });
		const history = new CommandHistory(faultReporter);

		history.add({
			undo: () => ({ status: 'rejected', reason: 'blocked' }),
			redo: () => undefined,
		});

		history.undo();

		expect(faultReporter.snapshot()).toHaveLength(1);
		expect(faultReporter.snapshot()[0]?.source).toBe('command-history');
		expect(faultReporter.snapshot()[0]?.operation).toBe('undo');
		expect(faultReporter.snapshot()[0]?.context).toMatchObject({ status: 'rejected', reason: 'blocked' });
	});

	it('reports faulted redo results through RuntimeFaultReporter', () => {
		const faultReporter = new RuntimeFaultReporter({ log: () => undefined });
		const history = new CommandHistory(faultReporter);

		history.add({
			undo: () => undefined,
			redo: () => ({
				status: 'faulted',
				changeId: 42,
				fault: {
					id: 7,
					timestamp: Date.now(),
					source: 'grid-change',
					operation: 'dispatch-events',
					message: 'boom',
					error: new Error('boom'),
				},
			}),
		});

		history.undo();
		faultReporter.clear();
		history.redo();

		expect(faultReporter.snapshot()).toHaveLength(1);
		expect(faultReporter.snapshot()[0]?.source).toBe('command-history');
		expect(faultReporter.snapshot()[0]?.operation).toBe('redo');
		expect(faultReporter.snapshot()[0]?.context).toMatchObject({
			status: 'faulted',
			changeId: 42,
			faultOperation: 'dispatch-events',
		});
	});
});

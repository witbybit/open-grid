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

	it('reports failed-before-commit redo results through RuntimeFaultReporter', () => {
		const faultReporter = new RuntimeFaultReporter({ log: () => undefined });
		const history = new CommandHistory(faultReporter);

		history.add({
			undo: () => undefined,
			redo: () => ({
				status: 'failed-before-commit',
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
			status: 'failed-before-commit',
			faultOperation: 'dispatch-events',
		});
	});

	it('keeps undo entries on the undo stack when undo is rejected', () => {
		const history = new CommandHistory();
		let undoCalls = 0;
		history.add({
			undo: () => {
				undoCalls++;
				return { status: 'rejected', reason: 'blocked' };
			},
			redo: () => ({ status: 'committed', changeId: 1, faults: [] }),
		});

		history.undo();

		expect(undoCalls).toBe(1);
		expect(history.canUndo()).toBe(true);
		expect(history.canRedo()).toBe(false);
	});

	it('moves redo entries back to undo when redo commits with faults', () => {
		const history = new CommandHistory();
		const fault = {
			id: 7,
			timestamp: Date.now(),
			source: 'grid-change' as const,
			operation: 'dispatch-events',
			message: 'boom',
			error: new Error('boom'),
		};
		history.add({
			undo: () => ({ status: 'committed', changeId: 1, faults: [] }),
			redo: () => ({ status: 'committed', changeId: 2, faults: [fault] }),
		});

		history.undo();
		expect(history.canRedo()).toBe(true);

		history.redo();

		expect(history.canUndo()).toBe(true);
		expect(history.canRedo()).toBe(false);
	});
});

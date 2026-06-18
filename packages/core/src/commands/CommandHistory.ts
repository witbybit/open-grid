import type { GridCommitResult } from '../engine/GridChangeApplier.js';

export interface CommandUndoEntry {
	undo(): unknown;
	redo(): unknown;
}

import type { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';

export class CommandHistory {
	private undoStack: CommandUndoEntry[] = [];
	private redoStack: CommandUndoEntry[] = [];
	private maxHistory = 100;

	constructor(private readonly faultReporter?: RuntimeFaultReporter) {}

	public add(entry: CommandUndoEntry): void {
		this.undoStack.push(entry);
		if (this.undoStack.length > this.maxHistory) {
			this.undoStack.shift();
		}
		this.redoStack = []; // clear redo stack on new action
	}

	public undo(): void {
		const entry = this.undoStack.pop();
		if (entry) {
			try {
				const result = entry.undo();
				this.reportCommitOutcome('undo', result);
				this.redoStack.push(entry);
			} catch (e) {
				this.faultReporter?.report({ source: 'command-history', operation: 'undo', error: e });
			}
		}
	}

	public redo(): void {
		const entry = this.redoStack.pop();
		if (entry) {
			try {
				const result = entry.redo();
				this.reportCommitOutcome('redo', result);
				this.undoStack.push(entry);
			} catch (e) {
				this.faultReporter?.report({ source: 'command-history', operation: 'redo', error: e });
			}
		}
	}

	public clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}

	public canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	public canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	private reportCommitOutcome(operation: 'undo' | 'redo', result: unknown): void {
		if (!this.isGridCommitResult(result) || result.status === 'committed' || result.status === 'noop') return;
		if (result.status === 'faulted') {
			this.faultReporter?.report({
				source: 'command-history',
				operation,
				error: result.fault.error,
				context: {
					status: result.status,
					changeId: result.changeId,
					faultOperation: result.fault.operation,
				},
			});
			return;
		}
		this.faultReporter?.report({
			source: 'command-history',
			operation,
			error: new Error(`Command history ${operation} rejected: ${result.reason}`),
			context: { status: result.status, reason: result.reason },
		});
	}

	private isGridCommitResult(result: unknown): result is GridCommitResult {
		if (!result || typeof result !== 'object' || !('status' in result)) return false;
		return result.status === 'committed' || result.status === 'noop' || result.status === 'rejected' || result.status === 'faulted';
	}
}

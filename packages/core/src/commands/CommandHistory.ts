export interface CommandUndoEntry {
	undo(): void;
	redo(): void;
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
				entry.undo();
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
				entry.redo();
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
}

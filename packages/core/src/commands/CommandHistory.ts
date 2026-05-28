export interface CommandUndoEntry {
	undo(): void;
	redo(): void;
}

export class CommandHistory {
	private undoStack: CommandUndoEntry[] = [];
	private redoStack: CommandUndoEntry[] = [];
	private maxHistory = 100;

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
				console.error('CommandHistory: Error executing undo', e);
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
				console.error('CommandHistory: Error executing redo', e);
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

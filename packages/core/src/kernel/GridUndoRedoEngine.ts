import type { GridCommand } from './GridCommand.js';
import type { GridCommit, GridUndoPatch } from './GridCommit.js';

export interface GridUndoEntry {
	readonly patch: GridUndoPatch;
	readonly commitId: string;
}

/**
 * Records undo patches produced by applied commits and produces the commands needed to undo or
 * redo them (ARCHITECTURE.md §3 R1, undo/redo foundation). The engine does not dispatch — it
 * returns the command for the kernel/API to dispatch, so undo/redo flow through the same single
 * write gateway as every other change.
 */
export class GridUndoRedoEngine {
	private readonly undoStack: GridUndoEntry[] = [];
	private readonly redoStack: GridUndoEntry[] = [];

	/** Record an applied commit. Commits without an undo patch clear nothing and add nothing. */
	record(commit: GridCommit): void {
		if (!commit.undoPatch) return;
		this.undoStack.push({ patch: commit.undoPatch, commitId: commit.id });
		// A fresh user action invalidates the redo branch.
		this.redoStack.length = 0;
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	/** Pop the next undo entry and return the command to dispatch, or null if nothing to undo. */
	takeUndo(): GridCommand | null {
		const entry = this.undoStack.pop();
		if (!entry) return null;
		this.redoStack.push(entry);
		return entry.patch.undo;
	}

	/** Pop the next redo entry and return the command to dispatch, or null if nothing to redo. */
	takeRedo(): GridCommand | null {
		const entry = this.redoStack.pop();
		if (!entry) return null;
		this.undoStack.push(entry);
		return entry.patch.redo;
	}

	clear(): void {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
	}
}

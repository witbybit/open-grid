import type { CellAddress } from '../cells/CellAddress.js';
import type { EditSession } from './EditSession.js';

/**
 * Holds the single active edit session (ARCHITECTURE.md §3 R10). Structural state only — it tracks
 * the session and its draft; it neither writes cell values nor publishes anything. The editing
 * commands drive it and delegate the actual write to the cell value engine on commit.
 *
 * One active session at a time for this skeleton; multi-edit / range editing extends from here.
 */
export class EditModel {
	private active: EditSession | null = null;

	getActive(): EditSession | null {
		return this.active;
	}

	isEditing(): boolean {
		return this.active !== null && this.active.status === 'active';
	}

	start(id: string, cell: CellAddress, initialValue: unknown): EditSession {
		this.active = { id, cell, initialValue, draftValue: initialValue, status: 'active' };
		return this.active;
	}

	updateDraft(value: unknown): EditSession | null {
		if (!this.active || this.active.status !== 'active') return null;
		this.active = { ...this.active, draftValue: value };
		return this.active;
	}

	/** Close the active session with a terminal status and return it (or null if none was active). */
	close(status: 'committed' | 'cancelled' | 'rejected'): EditSession | null {
		if (!this.active) return null;
		const closed: EditSession = { ...this.active, status };
		this.active = null;
		return closed;
	}
}

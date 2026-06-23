import type { CellAddress } from '../cells/CellAddress.js';

export type EditStatus = 'active' | 'committing' | 'committed' | 'cancelled' | 'rejected';

/**
 * One cell edit in flight (ARCHITECTURE.md §3 R10). Editing is a transaction system, not a bare
 * `setCellValue`: a session has an explicit lifecycle so validation, async validation, server
 * commit, rollback, AI proposals, paste, fill, and undo can hang off the same seam later.
 */
export interface EditSession {
	readonly id: string;
	readonly cell: CellAddress;
	readonly initialValue: unknown;
	readonly draftValue: unknown;
	readonly status: EditStatus;
}

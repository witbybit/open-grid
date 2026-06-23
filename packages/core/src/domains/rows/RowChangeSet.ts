import type { GridChangeSet } from '../../kernel/GridChangeSet.js';
import type { ColumnId } from '../columns/ColumnId.js';
import type { RowId } from './RowId.js';
import type { RowNode } from './RowNode.js';

/**
 * Typed description of what a row model changed (ARCHITECTURE.md §3 R2, "Change Set Contracts").
 * A change set carries facts only — no refresh, event, or render instructions. The kernel derives
 * effects from it; the pipeline derives its incremental update from `changedFieldsByRow`.
 */
export interface RowChangeSet<TRow = unknown> extends GridChangeSet {
	readonly domain: 'rows';
	readonly added: readonly RowNode<TRow>[];
	readonly removed: readonly RowNode<TRow>[];
	readonly updated: readonly RowNode<TRow>[];
	readonly moved: readonly { readonly rowId: RowId; readonly from: number; readonly to: number }[];
	/** Per-row set of columns whose value changed — the input to the shared impact classifier. */
	readonly changedFieldsByRow: ReadonlyMap<RowId, ReadonlySet<ColumnId>>;
}

export function emptyRowChangeSet<TRow>(): RowChangeSet<TRow> {
	return {
		domain: 'rows',
		added: [],
		removed: [],
		updated: [],
		moved: [],
		changedFieldsByRow: new Map(),
	};
}

export interface RowChangeSetParts<TRow> {
	added?: readonly RowNode<TRow>[];
	removed?: readonly RowNode<TRow>[];
	updated?: readonly RowNode<TRow>[];
	moved?: readonly { readonly rowId: RowId; readonly from: number; readonly to: number }[];
	changedFieldsByRow?: ReadonlyMap<RowId, ReadonlySet<ColumnId>>;
}

export function rowChangeSet<TRow>(parts: RowChangeSetParts<TRow>): RowChangeSet<TRow> {
	return {
		domain: 'rows',
		added: parts.added ?? [],
		removed: parts.removed ?? [],
		updated: parts.updated ?? [],
		moved: parts.moved ?? [],
		changedFieldsByRow: parts.changedFieldsByRow ?? new Map(),
	};
}

/** True when only cell values changed — no rows added, removed, or reordered. */
export function isFieldOnlyChange(changeSet: RowChangeSet): boolean {
	return changeSet.added.length === 0 && changeSet.removed.length === 0 && changeSet.moved.length === 0;
}

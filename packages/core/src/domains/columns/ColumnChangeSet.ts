import type { GridChangeSet } from '../../kernel/GridChangeSet.js';
import type { ColumnId } from './ColumnId.js';

/**
 * Typed description of a column-model change (ARCHITECTURE.md §3 R2). Facts only — the kernel
 * derives effects (version bump, `columns.changed` event, render invalidation) from it.
 */
export interface ColumnChangeSet extends GridChangeSet {
	readonly domain: 'columns';
	readonly added: readonly ColumnId[];
	readonly removed: readonly ColumnId[];
	readonly resized: readonly ColumnId[];
	readonly moved: readonly ColumnId[];
	readonly visibilityChanged: readonly ColumnId[];
	readonly pinnedChanged: readonly ColumnId[];
}

export interface ColumnChangeSetParts {
	added?: readonly ColumnId[];
	removed?: readonly ColumnId[];
	resized?: readonly ColumnId[];
	moved?: readonly ColumnId[];
	visibilityChanged?: readonly ColumnId[];
	pinnedChanged?: readonly ColumnId[];
}

export function columnChangeSet(parts: ColumnChangeSetParts): ColumnChangeSet {
	return {
		domain: 'columns',
		added: parts.added ?? [],
		removed: parts.removed ?? [],
		resized: parts.resized ?? [],
		moved: parts.moved ?? [],
		visibilityChanged: parts.visibilityChanged ?? [],
		pinnedChanged: parts.pinnedChanged ?? [],
	};
}

export function isEmptyColumnChange(changeSet: ColumnChangeSet): boolean {
	return (
		changeSet.added.length === 0 &&
		changeSet.removed.length === 0 &&
		changeSet.resized.length === 0 &&
		changeSet.moved.length === 0 &&
		changeSet.visibilityChanged.length === 0 &&
		changeSet.pinnedChanged.length === 0
	);
}

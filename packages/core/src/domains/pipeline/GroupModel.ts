import type { ColumnId } from '../columns/ColumnId.js';

export interface GroupByColumn {
	readonly columnId: ColumnId;
	readonly field: string;
}

/** Ordered grouping levels; index 0 is the outermost group. */
export type GroupByModel = readonly GroupByColumn[];

export const EMPTY_GROUP_BY: GroupByModel = [];

/**
 * Which group rows are expanded. Groups are expanded by default; collapsing records the group key.
 * Identity is the full group path (e.g. `Europe/France`), so a collapsed parent hides its subtree.
 */
export class GroupExpansionState {
	private readonly collapsed = new Set<string>();

	isExpanded(groupKey: string): boolean {
		return !this.collapsed.has(groupKey);
	}

	/** Toggle a group; returns the new expanded value. */
	toggle(groupKey: string): boolean {
		if (this.collapsed.has(groupKey)) {
			this.collapsed.delete(groupKey);
			return true;
		}
		this.collapsed.add(groupKey);
		return false;
	}

	setExpanded(groupKey: string, expanded: boolean): void {
		if (expanded) this.collapsed.delete(groupKey);
		else this.collapsed.add(groupKey);
	}

	expandAll(): void {
		this.collapsed.clear();
	}

	collapseAll(keys: Iterable<string>): void {
		for (const key of keys) this.collapsed.add(key);
	}
}

export function groupColumnIds(model: GroupByModel): Set<ColumnId> {
	return new Set(model.map((g) => g.columnId));
}

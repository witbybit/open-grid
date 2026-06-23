import type { ColumnId } from '../columns/ColumnId.js';
import type { RowId } from '../rows/RowId.js';

/**
 * How a write affects the pipeline (ARCHITECTURE.md §3 R7). The classification of a write happens
 * in exactly ONE place — {@link classifyWriteImpact} — and every write path feeds it the same
 * `changedFieldsByRow`. There is no per-path classifier.
 */
export type RowWriteImpact =
	| 'none'
	| 'plain-cell-value'
	| 'sort-key'
	| 'filter-key'
	| 'group-key'
	| 'tree-parent'
	| 'aggregation-input'
	| 'value-getter-dependency'
	| 'structural';

/**
 * Which columns currently participate in each pipeline concern. Built from the active sort/filter/
 * group models plus column metadata. A changed column is classified by the most impactful concern
 * it belongs to.
 */
export interface RowWriteImpactContext {
	readonly filterColumns: ReadonlySet<ColumnId>;
	readonly sortColumns: ReadonlySet<ColumnId>;
	readonly groupColumns?: ReadonlySet<ColumnId>;
	readonly treeParentColumns?: ReadonlySet<ColumnId>;
	readonly aggregationColumns?: ReadonlySet<ColumnId>;
	readonly valueGetterDependencyColumns?: ReadonlySet<ColumnId>;
}

/**
 * Classify a field-only write. Membership-affecting concerns rank above order-affecting ones,
 * which rank above pure value changes:
 *
 *   filter-key > group-key > tree-parent > aggregation-input > sort-key
 *     > value-getter-dependency > plain-cell-value > none
 *
 * Structural writes (add/remove/move) are NOT classified here — callers detect those from the
 * change set and pass `'structural'` directly. Use {@link classifyChangedFields} for a flat set.
 */
export function classifyWriteImpact(
	changedFieldsByRow: ReadonlyMap<RowId, ReadonlySet<ColumnId>>,
	ctx: RowWriteImpactContext,
): RowWriteImpact {
	const changed = new Set<ColumnId>();
	for (const fields of changedFieldsByRow.values()) {
		for (const c of fields) changed.add(c);
	}
	return classifyChangedFields(changed, ctx);
}

export function classifyChangedFields(changed: ReadonlySet<ColumnId>, ctx: RowWriteImpactContext): RowWriteImpact {
	if (changed.size === 0) return 'none';
	if (anyIn(changed, ctx.filterColumns)) return 'filter-key';
	if (anyIn(changed, ctx.groupColumns)) return 'group-key';
	if (anyIn(changed, ctx.treeParentColumns)) return 'tree-parent';
	if (anyIn(changed, ctx.aggregationColumns)) return 'aggregation-input';
	if (anyIn(changed, ctx.sortColumns)) return 'sort-key';
	if (anyIn(changed, ctx.valueGetterDependencyColumns)) return 'value-getter-dependency';
	return 'plain-cell-value';
}

/** True when the impact requires the visual model to be recomputed (membership or order changes). */
export function impactRequiresPipelineRebuild(impact: RowWriteImpact): boolean {
	return (
		impact === 'structural' ||
		impact === 'filter-key' ||
		impact === 'group-key' ||
		impact === 'tree-parent' ||
		impact === 'aggregation-input' ||
		impact === 'sort-key'
	);
}

function anyIn(changed: ReadonlySet<ColumnId>, group: ReadonlySet<ColumnId> | undefined): boolean {
	if (!group || group.size === 0) return false;
	for (const c of changed) {
		if (group.has(c)) return true;
	}
	return false;
}

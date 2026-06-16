import { getFieldRoot } from '../ids.js';
import type { ColumnDef } from '../columnDef.js';
import type { FilterModel } from '../filterModel.js';
import type { SortModel } from '../rowModel.js';
import type { AggregationDef } from './stages/aggregateStage.js';

/**
 * Describes the highest-impact consequence of mutating a set of row fields
 * given the current pipeline configuration. Used to select the cheapest
 * correct update path: full rebuild only when unavoidable, targeted cell
 * invalidation for value-only changes.
 *
 * Priority order (most to least structural):
 *   group-key > filter-key > sort-key > tree-parent > height >
 *   formula-dependent > value-only
 *
 * 'insert', 'remove', and 'full-rebuild' are caller-supplied for structural
 * mutations that bypass field-level classification entirely.
 */
export type RowMutationImpact =
	| 'value-only'
	| 'formula-dependent'
	| 'sort-key'
	| 'filter-key'
	| 'group-key'
	| 'tree-parent'
	| 'height'
	| 'insert'
	| 'remove'
	| 'full-rebuild';

export interface RowDependencyConfig<TData = unknown> {
	columns: ColumnDef<TData>[];
	sortModel: SortModel | null | undefined;
	filterModel: FilterModel | null | undefined;
	groupBy: string[] | undefined;
	aggDefs: AggregationDef<TData>[] | undefined;
	/** Whether a tree-parent resolver (getParentId) is configured for this grid. */
	hasTreeParent: boolean;
}

/**
 * Tracks which colIds/fields participate in each pipeline stage.
 * Must be rebuilt whenever sort, filter, group, aggregation, or column
 * configuration changes — call `update()` from each corresponding event handler.
 */
export class RowDependencyRegistry<TData = unknown> {
	/** colIds present in the active sort model. */
	readonly sortKeys = new Set<string>();
	/** colIds present in the active filter model. */
	readonly filterKeys = new Set<string>();
	/** colIds present in the active groupBy array. */
	readonly groupKeys = new Set<string>();
	/** Fields that feed aggregation functions (AggregationDef.field). */
	readonly aggregationFields = new Set<string>();
	/** Fields whose columns declare a valueGetter — computed/formula cells. */
	readonly formulaFields = new Set<string>();
	/** Whether tree-parent resolution is active for this grid. */
	hasTreeParent = false;

	update(config: RowDependencyConfig<TData>): void {
		const { columns, sortModel, filterModel, groupBy, aggDefs, hasTreeParent } = config;

		this.sortKeys.clear();
		for (const s of sortModel ?? []) this.sortKeys.add(s.colId);

		this.filterKeys.clear();
		for (const k of Object.keys(filterModel ?? {})) this.filterKeys.add(k);

		this.groupKeys.clear();
		for (const colId of groupBy ?? []) this.groupKeys.add(colId);

		this.aggregationFields.clear();
		for (const agg of aggDefs ?? []) this.aggregationFields.add(agg.field);

		this.formulaFields.clear();
		for (const col of columns) {
			if (col.valueGetter) this.formulaFields.add(col.field);
		}

		this.hasTreeParent = hasTreeParent;
	}
}

/**
 * Returns true when any field in `changedFields` could affect a pipeline key.
 * Handles both exact matches and dotted-path roots (e.g. 'address.city' matches 'address').
 */
function fieldMatchesKey(changedField: string, key: string): boolean {
	if (changedField === key) return true;
	const changedRoot = getFieldRoot(changedField);
	const keyRoot = getFieldRoot(key);
	return changedRoot === key || changedField === keyRoot || changedRoot === keyRoot;
}

function anyFieldMatchesSet(changedFields: ReadonlySet<string>, keys: ReadonlySet<string>): boolean {
	for (const field of changedFields) {
		for (const key of keys) {
			if (fieldMatchesKey(field, key)) return true;
		}
	}
	return false;
}

/**
 * Classify the highest-impact consequence of mutating the given set of fields.
 * Callers should supply 'insert' or 'remove' directly for structural row
 * additions/removals; those cases are not handled here.
 */
export function classifyMutation(
	changedFields: ReadonlySet<string>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	registry: RowDependencyRegistry<any>
): Exclude<RowMutationImpact, 'insert' | 'remove' | 'full-rebuild'> {
	if (changedFields.size === 0) return 'value-only';

	if (registry.groupKeys.size > 0 && anyFieldMatchesSet(changedFields, registry.groupKeys)) return 'group-key';
	if (registry.filterKeys.size > 0 && anyFieldMatchesSet(changedFields, registry.filterKeys)) return 'filter-key';
	if (registry.sortKeys.size > 0 && anyFieldMatchesSet(changedFields, registry.sortKeys)) return 'sort-key';
	// Any data change on a tree-parent grid may shift row parentage
	if (registry.hasTreeParent) return 'tree-parent';
	if (registry.formulaFields.size > 0 && anyFieldMatchesSet(changedFields, registry.formulaFields)) return 'formula-dependent';

	return 'value-only';
}

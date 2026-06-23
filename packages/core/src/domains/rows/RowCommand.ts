import type { RowChangeSet } from './RowChangeSet.js';
import type { RowId } from './RowId.js';

/**
 * How much of the pipeline a row write requires to be refreshed (ARCHITECTURE.md §3 R3, R7).
 * The row model REPORTS this; it does not perform the refresh — the pipeline domain consumes
 * it. `none` means the write was pure cell-value data that does not affect membership or order.
 */
export type PipelineRefreshKind = 'none' | 'sort' | 'filter' | 'group' | 'tree' | 'aggregation' | 'full';

/**
 * A structural transaction against a row model. `remove` accepts either a row object or a `RowId`.
 */
export interface RowTransaction<TRow = unknown> {
	readonly add?: readonly TRow[];
	readonly update?: readonly TRow[];
	readonly remove?: readonly (TRow | RowId)[];
	/** Insert position for `add` in source order; appends when omitted. */
	readonly addIndex?: number;
}

/**
 * The structural result a row model command handler returns (ARCHITECTURE.md §3 R3). It describes
 * what changed and what pipeline refresh is required — nothing else. The kernel executor turns
 * this into a commit and effects.
 */
export interface RowCommandResult<TRow = unknown> {
	readonly status: 'applied' | 'noop' | 'rejected';
	readonly reason?: string;
	readonly rowChanges: RowChangeSet<TRow>;
	readonly requiredPipelineRefresh: PipelineRefreshKind;
}

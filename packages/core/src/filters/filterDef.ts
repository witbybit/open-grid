/**
 * Rich column filter definition — supersedes the legacy filterType / filterValues on ColumnDef.
 *
 * Designed so that no consumer ever needs to write a custom filter component:
 *   - multi-select / single-select      static option lists
 *   - async-multi-select / async-single-select   server-fetched options with debounce + abort
 *   - infinite-multi-select             server-paginated virtually-scrolled list
 *   - custom                            escape hatch: pass any React component
 *
 * All built-in types render consistently across all three filter surfaces:
 *   sidebar panel, header 3-dot menu, and the floating filter row.
 */

import type { ColumnFilter } from '../filterModel.js';

// ── Option model ──────────────────────────────────────────────────────────────

export interface FilterSelectOption<TValue = unknown> {
	/** Display label shown in the filter list and chip bar. */
	label: string;
	/** The actual value stored in the filter condition. Must be serializable. */
	value: TValue;
	/** When true, the option is visible but cannot be selected. */
	disabled?: boolean;
	/** Group header label. Consecutive options sharing the same group render under one divider. */
	group?: string;
	/** Secondary text rendered below the label. */
	description?: string;
	/** Numeric badge (e.g. matching row count). */
	count?: number;
	/** Optional icon — URL, emoji, or icon-font class. */
	icon?: string;
}

// ── Async fetch params ────────────────────────────────────────────────────────

export interface FilterFetchParams<TRowData = unknown> {
	/** Current search query typed by the user. Empty string on initial load. */
	query: string;
	/** Values already selected — useful for prioritisation or exclusion hints. */
	selectedValues: unknown[];
	/** Static extra payload merged from `filterDef.fetchParams`. */
	params: Record<string, unknown>;
}

export interface FilterFetchResult<TValue = unknown> {
	options: FilterSelectOption<TValue>[];
	/** Server-side total count — displayed as "Showing X of Y". */
	totalCount?: number;
}

export interface FilterPageParams<TRowData = unknown> extends FilterFetchParams<TRowData> {
	/** 0-based page index. */
	page: number;
	/** Rows per page — controlled by `filterDef.pageSize` (default: 50). */
	pageSize: number;
}

export interface FilterPageResult<TValue = unknown> {
	options: FilterSelectOption<TValue>[];
	/** When false, no further pages exist. */
	hasMore: boolean;
	totalCount?: number;
}

// ── Custom filter renderer params ─────────────────────────────────────────────

export type FilterSurface = 'sidebar' | 'header-menu' | 'floating';

export interface CustomFilterRendererParams<TRowData = unknown> {
	/** Current filter value from FilterModel, or null when no filter is active. */
	value: ColumnFilter | null;
	/**
	 * Update the pending filter value without triggering the row pipeline.
	 * Use for live-preview while the user types. Call onCommit to apply.
	 */
	onChange: (filter: ColumnFilter | null) => void;
	/** Commit the filter immediately — triggers row pipeline re-evaluation. */
	onCommit: (filter: ColumnFilter | null) => void;
	/** The column field being filtered. */
	colField: string;
	/** The rendering surface — use this to render compact vs. full UI. */
	surface: FilterSurface;
}

// ── Filter def ────────────────────────────────────────────────────────────────

export type ColumnFilterType =
	// Legacy (preserved for backwards compat)
	| 'text'
	| 'number'
	| 'date'
	// New select types
	| 'multi-select'
	| 'single-select'
	| 'async-multi-select'
	| 'async-single-select'
	| 'infinite-multi-select'
	// Full custom React UI
	| 'custom'
	| 'none';

export interface ColumnFilterDef<TRowData = unknown, TValue = unknown> {
	// ── Type discriminant ──────────────────────────────────────────────────────
	type: ColumnFilterType;

	// ── Static options (multi-select, single-select) ───────────────────────────
	/**
	 * Static option list or a sync factory called once on mount.
	 * For dynamic options use fetchOptions / fetchPage.
	 */
	options?: FilterSelectOption<TValue>[] | ((distinctValues: (string | number | null)[]) => FilterSelectOption<TValue>[]);

	// ── Async options (async-multi-select, async-single-select) ───────────────
	/**
	 * Called on mount (empty query) and on each debounced query change.
	 * The grid manages AbortSignal cancellation — stale results are discarded.
	 */
	fetchOptions?: (params: FilterFetchParams<TRowData>, signal: AbortSignal) => Promise<FilterFetchResult<TValue>>;

	// ── Paginated options (infinite-multi-select) ──────────────────────────────
	/**
	 * Called for each page load. Page 0 on mount/query change; subsequent pages
	 * as the user scrolls to the bottom of the list.
	 */
	fetchPage?: (params: FilterPageParams<TRowData>, signal: AbortSignal) => Promise<FilterPageResult<TValue>>;

	// ── Custom filter renderer (type: 'custom') ────────────────────────────────
	/**
	 * Fully custom React filter component — rendered on all three surfaces unless
	 * renderFloatingFilter is also provided.
	 */
	renderFilter?: (params: CustomFilterRendererParams<TRowData>) => unknown;

	/**
	 * Compact custom React component for the floating filter row only.
	 * When omitted and renderFilter is set, renderFilter is used with surface='floating'.
	 */
	renderFloatingFilter?: (params: CustomFilterRendererParams<TRowData>) => unknown;

	// ── Shared UX options ──────────────────────────────────────────────────────
	/** Debounce ms before fetchOptions fires on query change. Default: 250. */
	debounceMs?: number;
	/** Minimum query length before fetchOptions fires. Default: 0 (fires on empty). */
	minQueryLength?: number;
	/** Maximum height of the option list in px. Default: 280. */
	maxHeight?: number;
	/** Rows per page for infinite scroll. Default: 50. */
	pageSize?: number;
	/** Placeholder in the search input. */
	placeholder?: string;
	/** Text shown when no options match. Default: "No options". */
	emptyLabel?: string;
	/** Text shown while loading. Default: "Loading…". */
	loadingLabel?: string;
	/**
	 * Whether to show the search input.
	 * Default: auto (shown when options.length > 8 or type is async).
	 */
	searchable?: boolean;
	/** Show "Select All / None" toggle at the top of multi-select lists. Default: true. */
	showSelectAll?: boolean;

	// ── Value mapping ──────────────────────────────────────────────────────────
	/**
	 * Derive the display label for a stored value (used by chip bar / floating badge).
	 * Default: String(value).
	 */
	getOptionLabel?: (value: TValue) => string;
	/**
	 * Extract a serializable key from an option value.
	 * Default: uses value directly when primitive, JSON.stringify otherwise.
	 */
	getOptionValue?: (value: TValue) => string | number;

	// ── Request enrichment ─────────────────────────────────────────────────────
	/** Static extra payload passed into every FilterFetchParams.params. */
	fetchParams?: Record<string, unknown>;

	// ── Chip bar ───────────────────────────────────────────────────────────────
	/** Override chip label for the filter chip bar. */
	getChipLabel?: (filter: ColumnFilter) => string;
}

// ── Normalization ─────────────────────────────────────────────────────────────

/**
 * Resolve a column's filter definition from its filterDef (preferred) or legacy
 * filterType / filterValues fields. Returns null for filterType='none'.
 */
export function resolveColumnFilterDef<TRowData>(
	filterDef: ColumnFilterDef<TRowData> | undefined,
	filterType: string | undefined,
	filterValues: (string | number | null)[] | undefined
): ColumnFilterDef<TRowData> | null {
	// Explicit filterDef always wins
	if (filterDef) {
		if (filterDef.type === 'none') return null;
		return filterDef;
	}

	// Normalize legacy filterType
	const legacyType = filterType ?? 'text';

	if (legacyType === 'none') return null;

	if (legacyType === 'set') {
		// Convert legacy set filter to multi-select
		const def: ColumnFilterDef<TRowData, string | number | null> = { type: 'multi-select' };
		if (filterValues) {
			def.options = filterValues.map((v) => ({
				label: v == null ? '(blank)' : String(v),
				value: v,
			}));
		}
		return def as ColumnFilterDef<TRowData>;
	}

	return { type: legacyType as ColumnFilterType } as ColumnFilterDef<TRowData>;
}

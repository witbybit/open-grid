/**
 * Canonical visual freshness model. Mounted cell state (CellSlot) and cached display state
 * (CellDisplaySnapshot) both carry these same six version stamps; both must be judged fresh
 * by this single predicate. Do not open-code a comparison across a subset or superset of these
 * fields elsewhere — extend this module instead.
 */
export interface VisualFreshness {
	rowVersion: number;
	globalVersion: number;
	insightVersion: number;
	styleVersion: number;
	loadingVersion: number;
	selectionVersion: number;
}

export function createVisualFreshness(input: VisualFreshness): VisualFreshness {
	return {
		rowVersion: input.rowVersion,
		globalVersion: input.globalVersion,
		insightVersion: input.insightVersion,
		styleVersion: input.styleVersion,
		loadingVersion: input.loadingVersion,
		selectionVersion: input.selectionVersion,
	};
}

/**
 * The canonical freshness predicate. `actual` is missing (undefined) whenever there is nothing
 * mounted/cached yet — that is always stale, never an exception case callers special-case.
 */
export function isVisualFresh(actual: VisualFreshness | undefined, expected: VisualFreshness): boolean {
	if (!actual) return false;
	return (
		actual.rowVersion === expected.rowVersion &&
		actual.globalVersion === expected.globalVersion &&
		actual.insightVersion === expected.insightVersion &&
		actual.styleVersion === expected.styleVersion &&
		actual.loadingVersion === expected.loadingVersion &&
		actual.selectionVersion === expected.selectionVersion
	);
}

/** Human-readable mismatch reasons, for diagnostics/logging — never used for control flow. */
export function explainVisualStaleness(actual: VisualFreshness | undefined, expected: VisualFreshness): string[] {
	if (!actual) return ['missing: no visual freshness recorded'];
	const reasons: string[] = [];
	if (actual.rowVersion !== expected.rowVersion) reasons.push(`rowVersion: ${actual.rowVersion} !== ${expected.rowVersion}`);
	if (actual.globalVersion !== expected.globalVersion) reasons.push(`globalVersion: ${actual.globalVersion} !== ${expected.globalVersion}`);
	if (actual.insightVersion !== expected.insightVersion) reasons.push(`insightVersion: ${actual.insightVersion} !== ${expected.insightVersion}`);
	if (actual.styleVersion !== expected.styleVersion) reasons.push(`styleVersion: ${actual.styleVersion} !== ${expected.styleVersion}`);
	if (actual.loadingVersion !== expected.loadingVersion) reasons.push(`loadingVersion: ${actual.loadingVersion} !== ${expected.loadingVersion}`);
	if (actual.selectionVersion !== expected.selectionVersion)
		reasons.push(`selectionVersion: ${actual.selectionVersion} !== ${expected.selectionVersion}`);
	return reasons;
}

/**
 * Structural shape of a mounted cell's freshness bookkeeping — matches CellSlot's
 * `lastMounted*` fields without importing CellSlot (avoids a circular import; cellSlot.ts
 * imports FROM this module). Any object with these six fields — a real CellSlot included —
 * satisfies this by structural typing.
 */
export interface MountedFreshnessHost {
	lastMountedRowVersion: number;
	lastMountedGlobalVersion: number;
	lastMountedInsightVersion: number;
	lastMountedStyleVersion: number;
	lastMountedLoadingVersion: number;
	lastMountedSelectionVersion: number;
}

/**
 * The canonical view of what a mounted cell slot currently has stamped. Returns `undefined`
 * only when the slot has never recorded a row-version stamp at all (a virgin/reset slot) —
 * `isVisualFresh` already treats `undefined` as always-stale, so callers don't need a separate
 * "never mounted" branch.
 */
export function mountedCellFreshness(host: MountedFreshnessHost): VisualFreshness | undefined {
	if (host.lastMountedRowVersion === -1 && host.lastMountedGlobalVersion === -1) return undefined;
	return {
		rowVersion: host.lastMountedRowVersion,
		globalVersion: host.lastMountedGlobalVersion,
		insightVersion: host.lastMountedInsightVersion,
		styleVersion: host.lastMountedStyleVersion,
		loadingVersion: host.lastMountedLoadingVersion,
		selectionVersion: host.lastMountedSelectionVersion,
	};
}

/** Stamps a mounted cell slot's freshness fields from a canonical VisualFreshness value. */
export function applyMountedCellFreshness(host: MountedFreshnessHost, freshness: VisualFreshness): void {
	host.lastMountedRowVersion = freshness.rowVersion;
	host.lastMountedGlobalVersion = freshness.globalVersion;
	host.lastMountedInsightVersion = freshness.insightVersion;
	host.lastMountedStyleVersion = freshness.styleVersion;
	host.lastMountedLoadingVersion = freshness.loadingVersion;
	host.lastMountedSelectionVersion = freshness.selectionVersion;
}

/** Convenience wrapper: is this mounted cell slot fresh against the expected freshness? */
export function isMountedCellVisuallyFresh(host: MountedFreshnessHost, expected: VisualFreshness): boolean {
	return isVisualFresh(mountedCellFreshness(host), expected);
}

/**
 * A display snapshot already carries all six freshness dimensions directly (CellDisplaySnapshot
 * extends VisualFreshness) — this is a thin, semantically-named accessor rather than a second
 * implementation, so mounted-cell and snapshot freshness are provably the same model.
 */
export function snapshotFreshness(snapshot: VisualFreshness): VisualFreshness {
	return createVisualFreshness(snapshot);
}

/** Convenience wrapper: is this (possibly absent) snapshot fresh against the expected freshness? */
export function isSnapshotVisuallyFresh(snapshot: VisualFreshness | undefined, expected: VisualFreshness): boolean {
	return isVisualFresh(snapshot, expected);
}

/**
 * Narrower than `isVisualFresh` on purpose: some scroll-time decisions (e.g. "should a frozen
 * portal be marked dirty") only care whether the underlying DATA identity drifted — row and
 * global version — not the full six-dimension contract. Centralizes that specific 2-dimension
 * check so it isn't open-coded at each call site; still distinct from full visual freshness.
 */
export function hasMountedDataVersionDrifted(
	host: Pick<MountedFreshnessHost, 'lastMountedRowVersion' | 'lastMountedGlobalVersion'>,
	expected: { rowVersion: number | undefined; globalVersion: number }
): { globalChanged: boolean; rowChanged: boolean } {
	const globalChanged = host.lastMountedGlobalVersion !== -1 && expected.globalVersion !== host.lastMountedGlobalVersion;
	const rowChanged =
		host.lastMountedRowVersion !== -1 && expected.rowVersion !== undefined && expected.rowVersion !== host.lastMountedRowVersion;
	return { globalChanged, rowChanged };
}

/**
 * Single-dimension freshness check for row-scoped caches that deliberately do NOT depend on the
 * other five dimensions — e.g. a captured `frozenHtml` string reflects a custom renderer's own
 * DOM output, which tracks row data (rowVersion) but not style/insight/selection/loading state
 * layered outside the portal. Using the full six-dimension `isVisualFresh` here would be a
 * regression: it would invalidate perfectly good cached HTML whenever an unrelated dimension
 * (e.g. selectionVersion elsewhere in the grid) changed.
 */
export function isRowVersionFresh(actualRowVersion: number | undefined, expectedRowVersion: number): boolean {
	return actualRowVersion !== undefined && actualRowVersion === expectedRowVersion;
}

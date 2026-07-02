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

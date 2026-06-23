/** Read a (possibly dotted) field path off a row's data. */
export function getFieldValue(row: unknown, field: string): unknown {
	if (!field.includes('.')) {
		return (row as Record<string, unknown> | null | undefined)?.[field];
	}
	let cursor: unknown = row;
	for (const key of field.split('.')) {
		if (cursor == null || typeof cursor !== 'object') return undefined;
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return cursor;
}

/**
 * Default total ordering used by the sort stage. Nullish values sort last; numbers compare
 * numerically; everything else compares by locale-aware string order. Stable when paired with a
 * stable sort.
 */
export function defaultCompare(a: unknown, b: unknown): number {
	if (a === b) return 0;
	const aNil = a == null;
	const bNil = b == null;
	if (aNil && bNil) return 0;
	if (aNil) return 1;
	if (bNil) return -1;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
	return String(a).localeCompare(String(b));
}

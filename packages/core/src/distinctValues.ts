import type { RowNode } from './rowNode.js';

export interface GridDistinctValueSummary {
	readonly values: readonly (string | number | null)[];
	readonly truncated: boolean;
	readonly limit: number | null;
}

export interface DistinctValueComputationOptions {
	readonly maxValues?: number;
}

export function computeDistinctValueSummary<TRowData>(
	nodes: readonly RowNode<TRowData>[],
	colField: string,
	options?: DistinctValueComputationOptions
): GridDistinctValueSummary {
	const rawLimit = options?.maxValues;
	const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : null;
	const seen = new Set<string>();
	const values: (string | number | null)[] = [];
	let truncated = false;

	for (const node of nodes) {
		const raw = node.getCellValue(colField, (d: unknown) => (d as Record<string, unknown>)[colField]);
		const key = raw == null || raw === '' ? '\0null' : String(raw);
		if (seen.has(key)) continue;
		seen.add(key);

		if (limit !== null && values.length >= limit) {
			truncated = true;
			break;
		}

		if (raw == null || raw === '') {
			values.push(null);
		} else {
			values.push(typeof raw === 'number' ? raw : String(raw));
		}
	}

	return {
		values: values.sort((a, b) => {
			if (a === null) return -1;
			if (b === null) return 1;
			if (typeof a === 'number' && typeof b === 'number') return a - b;
			return String(a).localeCompare(String(b));
		}),
		truncated,
		limit,
	};
}

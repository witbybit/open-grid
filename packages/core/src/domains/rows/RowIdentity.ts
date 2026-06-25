import type { RowId } from './RowId.js';
import { asRowId } from './RowId.js';
import { RowModelError } from './RowModelError.js';

export type GetRowId<TRow> = (row: TRow, index: number) => string | number;

/**
 * Resolves stable, branded {@link RowId}s for data rows (ARCHITECTURE.md §3 R5). Identity is
 * sacred: empty or duplicate ids are rejected loudly rather than allowed to silently corrupt
 * selection, editing, and reconciliation.
 *
 * When no `getRowId` is supplied, identity falls back to source position (`row:<index>`), which is
 * stable only while order is stable — callers that mutate or reorder should supply `getRowId`.
 */
export class RowIdentityResolver<TRow> {
	private readonly getRowId: GetRowId<TRow> | undefined;

	constructor(getRowId?: GetRowId<TRow>) {
		this.getRowId = getRowId;
	}

	idOf(row: TRow, index: number): RowId {
		const raw = this.getRowId ? this.getRowId(row, index) : `row:${index}`;
		return asRowId(String(raw));
	}

	/**
	 * Resolve ids for a whole dataset, validating uniqueness and non-emptiness.
	 * @throws RowModelError on an empty or duplicate id.
	 */
	resolveAll(rows: readonly TRow[], context = 'rows'): RowId[] {
		const ids: RowId[] = [];
		const seen = new Set<string>();

		for (let index = 0; index < rows.length; index++) {
			const id = this.idOf(rows[index]!, index);
			if (!id) {
				throw new RowModelError(
					`Open Grid [${context}]: getRowId returned an empty id at index ${index}. Every row must have a non-empty id.`
				);
			}
			if (seen.has(id)) {
				throw new RowModelError(`Open Grid [${context}]: duplicate row id "${id}". Each row must have a unique id.`);
			}
			seen.add(id);
			ids.push(id);
		}

		return ids;
	}
}

import { detailVisualRow } from './VisualRow.js';
import type { VisualRow } from './VisualRow.js';

/**
 * Which master rows have their detail panel open. Closed by default (opposite of group/tree
 * expansion); opening records the row id.
 */
export class DetailExpansionState {
	private readonly open = new Set<string>();

	isOpen(rowId: string): boolean {
		return this.open.has(rowId);
	}

	toggle(rowId: string): boolean {
		if (this.open.has(rowId)) {
			this.open.delete(rowId);
			return false;
		}
		this.open.add(rowId);
		return true;
	}

	setOpen(rowId: string, open: boolean): void {
		if (open) this.open.add(rowId);
		else this.open.delete(rowId);
	}

	get size(): number {
		return this.open.size;
	}
}

/**
 * Inserts a `detail` visual row immediately after each data/tree row whose detail is open
 * (ARCHITECTURE.md §3 R5–R6). Composes on top of the flat / grouped / tree projection — it runs as
 * a post-pass, so master/detail works regardless of grouping or tree mode.
 */
export function insertDetailRows<TRow>(rows: readonly VisualRow<TRow>[], expansion: DetailExpansionState): VisualRow<TRow>[] {
	if (expansion.size === 0) return rows.slice();
	const out: VisualRow<TRow>[] = [];
	for (const row of rows) {
		out.push(row);
		if ((row.kind === 'data' || row.kind === 'tree') && expansion.isOpen(String(row.rowId))) {
			out.push(detailVisualRow(row.rowId));
		}
	}
	return out;
}

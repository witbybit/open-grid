import type { RowNode } from '../rows/RowNode.js';
import type { GroupExpansionState } from './GroupModel.js';
import type { VisualRow } from './VisualRow.js';
import { treeVisualRow } from './VisualRow.js';

/**
 * Configures self-referential tree data: each row points at its parent (or none for a root).
 */
export interface TreeDataOptions<TRow = unknown> {
	getParentId: (row: TRow) => string | number | null | undefined;
}

const ROOT = Symbol('tree-root');

/**
 * Flattens self-referential rows into ordered `tree` visual rows carrying depth (ARCHITECTURE.md
 * §3 R5–R6). Children appear under expanded parents only; sibling order follows the (already
 * filtered+sorted) input order. Tree rows ARE data rows — they carry a `RowId` and node, so they
 * remain selectable/editable. Expansion is keyed by row id (expanded by default).
 */
export function buildTreeVisualRows<TRow>(
	rows: readonly RowNode<TRow>[],
	options: TreeDataOptions<TRow>,
	expansion: GroupExpansionState
): VisualRow<TRow>[] {
	const ids = new Set(rows.map((n) => String(n.id)));
	const childrenByParent = new Map<string | typeof ROOT, RowNode<TRow>[]>();

	for (const node of rows) {
		const rawParent = options.getParentId(node.data);
		const parentKey = rawParent != null && ids.has(String(rawParent)) ? String(rawParent) : ROOT;
		const bucket = childrenByParent.get(parentKey);
		if (bucket) bucket.push(node);
		else childrenByParent.set(parentKey, [node]);
	}

	const out: VisualRow<TRow>[] = [];
	const walk = (parentKey: string | typeof ROOT, depth: number): void => {
		const children = childrenByParent.get(parentKey);
		if (!children) return;
		for (const child of children) {
			out.push(treeVisualRow(child, depth));
			const key = String(child.id);
			if (childrenByParent.has(key) && expansion.isExpanded(key)) {
				walk(key, depth + 1);
			}
		}
	};
	walk(ROOT, 0);
	return out;
}

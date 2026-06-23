import type { RowId, VisualRowId } from '../rows/RowId.js';
import { asVisualRowId } from '../rows/RowId.js';
import type { RowNode } from '../rows/RowNode.js';

/**
 * A row as the user sees it (ARCHITECTURE.md §3 R5). Modeled as an explicit tagged union so a
 * loading/group/detail/placeholder row can NEVER be mistaken for a data row. Only `data` and
 * `tree` carry a `RowId`; the rest are pure visual constructs. This reset implements `data`;
 * the other kinds exist in the type so selection/editing/virtualization handle them correctly
 * from day one.
 */
export type VisualRow<TRow = unknown> =
	| { readonly kind: 'data'; readonly visualRowId: VisualRowId; readonly rowId: RowId; readonly sourceIndex: number; readonly node: RowNode<TRow> }
	| { readonly kind: 'group'; readonly visualRowId: VisualRowId; readonly groupKey: string; readonly depth: number }
	| { readonly kind: 'tree'; readonly visualRowId: VisualRowId; readonly rowId: RowId; readonly depth: number; readonly node: RowNode<TRow> }
	| { readonly kind: 'detail'; readonly visualRowId: VisualRowId; readonly parentRowId: RowId }
	| { readonly kind: 'loading'; readonly visualRowId: VisualRowId; readonly index: number }
	| { readonly kind: 'placeholder'; readonly visualRowId: VisualRowId; readonly index: number };

export function dataVisualRow<TRow>(node: RowNode<TRow>): VisualRow<TRow> {
	return {
		kind: 'data',
		visualRowId: asVisualRowId(`v:data:${node.id}`),
		rowId: node.id,
		sourceIndex: node.sourceIndex,
		node,
	};
}

/** Narrowing helper: the `RowId` of a visual row that maps to a data row, else null. */
export function rowIdOfVisualRow<TRow>(row: VisualRow<TRow>): RowId | null {
	return row.kind === 'data' || row.kind === 'tree' ? row.rowId : null;
}

/** True only for visual rows that are real, editable data rows. */
export function isDataVisualRow<TRow>(row: VisualRow<TRow>): row is Extract<VisualRow<TRow>, { kind: 'data' }> {
	return row.kind === 'data';
}

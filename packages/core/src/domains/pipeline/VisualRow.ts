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
	| {
			readonly kind: 'group';
			readonly visualRowId: VisualRowId;
			/** Full group path, e.g. `Europe/France`. Identity for expansion + the visual row id. */
			readonly groupKey: string;
			readonly depth: number;
			/** The column field this level groups by. */
			readonly field: string;
			/** The grouped value at this level. */
			readonly value: unknown;
			/** Number of leaf data rows under this group (all descendants). */
			readonly count: number;
			readonly expanded: boolean;
	  }
	| { readonly kind: 'tree'; readonly visualRowId: VisualRowId; readonly rowId: RowId; readonly depth: number; readonly node: RowNode<TRow> }
	| { readonly kind: 'detail'; readonly visualRowId: VisualRowId; readonly parentRowId: RowId }
	| { readonly kind: 'loading'; readonly visualRowId: VisualRowId; readonly index: number }
	| { readonly kind: 'placeholder'; readonly visualRowId: VisualRowId; readonly index: number };

export interface GroupVisualRowInit {
	readonly groupKey: string;
	readonly depth: number;
	readonly field: string;
	readonly value: unknown;
	readonly count: number;
	readonly expanded: boolean;
}

export function groupVisualRow<TRow>(init: GroupVisualRowInit): VisualRow<TRow> {
	return {
		kind: 'group',
		visualRowId: asVisualRowId(`v:group:${init.groupKey}`),
		groupKey: init.groupKey,
		depth: init.depth,
		field: init.field,
		value: init.value,
		count: init.count,
		expanded: init.expanded,
	};
}

export function dataVisualRow<TRow>(node: RowNode<TRow>): VisualRow<TRow> {
	return {
		kind: 'data',
		visualRowId: asVisualRowId(`v:data:${node.id}`),
		rowId: node.id,
		sourceIndex: node.sourceIndex,
		node,
	};
}

export function treeVisualRow<TRow>(node: RowNode<TRow>, depth: number): VisualRow<TRow> {
	return { kind: 'tree', visualRowId: asVisualRowId(`v:tree:${node.id}`), rowId: node.id, depth, node };
}

export function detailVisualRow<TRow>(parentRowId: RowId): VisualRow<TRow> {
	return { kind: 'detail', visualRowId: asVisualRowId(`v:detail:${parentRowId}`), parentRowId };
}

/** A row whose data is being fetched (infinite/server). Carries no RowId — never editable. */
export function loadingVisualRow<TRow>(index: number): VisualRow<TRow> {
	return { kind: 'loading', visualRowId: asVisualRowId(`v:loading:${index}`), index };
}

/** A row in an unrequested window (infinite/server). Carries no RowId — never editable. */
export function placeholderVisualRow<TRow>(index: number): VisualRow<TRow> {
	return { kind: 'placeholder', visualRowId: asVisualRowId(`v:placeholder:${index}`), index };
}

/** Narrowing helper: the `RowId` of a visual row that maps to a data row, else null. */
export function rowIdOfVisualRow<TRow>(row: VisualRow<TRow>): RowId | null {
	return row.kind === 'data' || row.kind === 'tree' ? row.rowId : null;
}

/** True only for visual rows that are real, editable data rows. */
export function isDataVisualRow<TRow>(row: VisualRow<TRow>): row is Extract<VisualRow<TRow>, { kind: 'data' }> {
	return row.kind === 'data';
}

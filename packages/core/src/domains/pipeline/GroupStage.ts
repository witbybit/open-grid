import type { RowNode } from '../rows/RowNode.js';
import { getFieldValue } from './fieldValue.js';
import type { GroupByModel, GroupExpansionState } from './GroupModel.js';
import type { VisualRow } from './VisualRow.js';
import { dataVisualRow, groupVisualRow } from './VisualRow.js';

const GROUP_PATH_SEPARATOR = '/';

/**
 * Flattens filtered+sorted rows into a heterogeneous visual model with `group` rows interleaved
 * above the `data` rows of expanded groups (ARCHITECTURE.md §3 R5–R6). Multi-level: each `GroupBy`
 * level nests under the previous. A collapsed group contributes its header row but none of its
 * descendants. Group order follows first-appearance in the (already sorted) input, so it composes
 * with the sort stage.
 *
 * This replaces the flat `data`-only projection whenever a group-by model is active; the renderer
 * dispatches on `VisualRow.kind`, so group rows render as headers and data rows as cells.
 */
export function buildGroupedVisualRows<TRow>(
	rows: readonly RowNode<TRow>[],
	groupBy: GroupByModel,
	expansion: GroupExpansionState,
): VisualRow<TRow>[] {
	if (groupBy.length === 0) {
		return rows.map((node) => dataVisualRow(node));
	}
	return groupLevel(rows, groupBy, expansion, 0, '');
}

function groupLevel<TRow>(
	rows: readonly RowNode<TRow>[],
	groupBy: GroupByModel,
	expansion: GroupExpansionState,
	depth: number,
	parentKey: string,
): VisualRow<TRow>[] {
	if (depth >= groupBy.length) {
		return rows.map((node) => dataVisualRow(node));
	}

	const level = groupBy[depth]!;
	const groups = orderedGroupBy(rows, (node) => getFieldValue(node.data, level.field));

	const out: VisualRow<TRow>[] = [];
	for (const { value, members } of groups) {
		const groupKey = parentKey === '' ? `${stringifyKey(value)}` : `${parentKey}${GROUP_PATH_SEPARATOR}${stringifyKey(value)}`;
		const expanded = expansion.isExpanded(groupKey);
		out.push(
			groupVisualRow({
				groupKey,
				depth,
				field: level.field,
				value,
				count: members.length, // leaf count: members at the deepest level are data rows
				expanded,
			}),
		);
		if (expanded) {
			out.push(...groupLevel(members, groupBy, expansion, depth + 1, groupKey));
		}
	}
	return out;
}

interface OrderedGroup<TRow> {
	readonly value: unknown;
	readonly members: RowNode<TRow>[];
}

/** Group preserving first-appearance order of keys (stable; composes with the sort stage). */
function orderedGroupBy<TRow>(rows: readonly RowNode<TRow>[], keyOf: (node: RowNode<TRow>) => unknown): OrderedGroup<TRow>[] {
	const order: unknown[] = [];
	const byKey = new Map<string, OrderedGroup<TRow>>();
	for (const node of rows) {
		const value = keyOf(node);
		const k = stringifyKey(value);
		let group = byKey.get(k);
		if (!group) {
			group = { value, members: [] };
			byKey.set(k, group);
			order.push(k);
		}
		group.members.push(node);
	}
	return order.map((k) => byKey.get(k as string)!);
}

function stringifyKey(value: unknown): string {
	return value == null ? '∅' : String(value);
}

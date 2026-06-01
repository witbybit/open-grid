import { RowNode, type ColumnDef } from '../../store.js';
import type { RowTreeNode } from './types.js';
import { getColumnValue } from '../../rowModel.js';
import { formatVisualGroupId } from '../../ids.js';

export function groupStage<TData>(nodes: RowNode<TData>[], groupBy: string[], columns: ColumnDef<TData>[]): RowTreeNode<TData>[] {
	if (groupBy.length === 0) {
		return nodes.map((node) => ({
			kind: 'leaf',
			rowId: node.id,
			node,
			depth: 0,
		}));
	}

	const columnMap = new Map<string, ColumnDef<TData>>();
	columns.forEach((c) => {
		columnMap.set(c.field, c);
	});

	return groupRecursively(nodes, groupBy, 0, '', columnMap);
}

function groupRecursively<TData>(
	nodes: RowNode<TData>[],
	groupBy: string[],
	depth: number,
	parentGroupId: string,
	columnMap: Map<string, ColumnDef<TData>>
): RowTreeNode<TData>[] {
	const field = groupBy[depth];
	const column = columnMap.get(field);
	const groupsMap = new Map<string, RowNode<TData>[]>();

	// Partition nodes by the resolved column value using the core value resolution pipeline
	for (const node of nodes) {
		const val = getColumnValue(node, column);
		const key = val === null || val === undefined ? 'None' : String(val);
		if (!groupsMap.has(key)) {
			groupsMap.set(key, []);
		}
		groupsMap.get(key)!.push(node);
	}

	const results: RowTreeNode<TData>[] = [];

	for (const [key, groupNodes] of groupsMap.entries()) {
		const groupId = formatVisualGroupId(field, key, parentGroupId);
		const isLastLevel = depth === groupBy.length - 1;

		let childNodes: RowTreeNode<TData>[];
		if (isLastLevel) {
			childNodes = groupNodes.map((node) => ({
				kind: 'leaf',
				rowId: node.id,
				node,
				depth: depth + 1,
			}));
		} else {
			childNodes = groupRecursively(groupNodes, groupBy, depth + 1, groupId, columnMap);
		}

		// Calculate total leaf count under this group node (supporting tree leaves too)
		const leafCount = childNodes.reduce((acc, child) => {
			return acc + (child.kind === 'leaf' ? 1 + (child.childCount ?? 0) : child.childCount);
		}, 0);

		results.push({
			kind: 'group',
			id: groupId,
			field,
			key,
			depth,
			children: childNodes,
			childCount: leafCount,
			aggregateValues: {},
		});
	}

	return results;
}

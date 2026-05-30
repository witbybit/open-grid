import { RowNode } from '../../store.js';
import type { RowTreeNode } from './types.js';

export function groupStage<TData>(nodes: RowNode<TData>[], groupBy: string[]): RowTreeNode<TData>[] {
	if (groupBy.length === 0) {
		return nodes.map((node) => ({
			kind: 'leaf',
			rowId: node.id,
			node,
			depth: 0,
		}));
	}

	return groupRecursively(nodes, groupBy, 0, '');
}

function groupRecursively<TData>(nodes: RowNode<TData>[], groupBy: string[], depth: number, parentGroupId: string): RowTreeNode<TData>[] {
	const field = groupBy[depth];
	const groupsMap = new Map<string, RowNode<TData>[]>();

	// Partition nodes by the field value
	for (const node of nodes) {
		const val = node.data ? String((node.data as Record<string, unknown>)[field] ?? 'None') : 'None';
		if (!groupsMap.has(val)) {
			groupsMap.set(val, []);
		}
		groupsMap.get(val)!.push(node);
	}

	const results: RowTreeNode<TData>[] = [];

	for (const [key, groupNodes] of groupsMap.entries()) {
		const groupId = parentGroupId ? `${parentGroupId}|${field}:${key}` : `group:${field}:${key}`;
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
			childNodes = groupRecursively(groupNodes, groupBy, depth + 1, groupId);
		}

		// Calculate total leaf count under this group node
		const leafCount = childNodes.reduce((acc, child) => {
			return acc + (child.kind === 'leaf' ? 1 : child.childCount);
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

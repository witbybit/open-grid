import { RowNode } from '../../store.js';
import type { RowTreeNode } from './types.js';

export function treeStage<TData>(nodes: RowNode<TData>[], getParentId: (data: TData) => string | null | undefined): RowTreeNode<TData>[] {
	const nodeMap = new Map<string, RowTreeNode<TData>>();
	const parentRelations = new Map<string, string[]>(); // parentId -> childIds
	const roots: string[] = [];

	// Build raw leaf nodes and analyze hierarchy
	for (const node of nodes) {
		const dataNode: RowTreeNode<TData> = {
			kind: 'data',
			rowId: node.id,
			node,
			depth: 0,
		};
		nodeMap.set(node.id, dataNode);

		const pId = node.data ? getParentId(node.data) : null;
		if (pId != null && pId !== '') {
			const parentId = String(pId);
			if (!parentRelations.has(parentId)) {
				parentRelations.set(parentId, []);
			}
			parentRelations.get(parentId)!.push(node.id);
		} else {
			roots.push(node.id);
		}
	}

	// We might have nodes whose parent ID is not in our nodes list.
	// They should also be treated as roots!
	for (const [parentId, childIds] of parentRelations.entries()) {
		if (!nodeMap.has(parentId)) {
			roots.push(...childIds);
		}
	}

	// Remove duplicates from roots
	const uniqueRoots = Array.from(new Set(roots));

	// Helper to build hierarchy recursively from root down
	const buildSubtree = (nodeId: string, depth: number): RowTreeNode<TData> => {
		const current = nodeMap.get(nodeId)!;
		const childIds = parentRelations.get(nodeId);
		current.depth = depth;

		if (!childIds || childIds.length === 0) {
			return current;
		}

		current.children = childIds.map((cId) => buildSubtree(cId, depth + 1));
		return current;
	};

	return uniqueRoots.map((rootId) => buildSubtree(rootId, 0));
}

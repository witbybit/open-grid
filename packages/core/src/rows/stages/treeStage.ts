import { RowNode } from '../../store.js';
import type { RowTreeNode } from './types.js';

/**
 * Preserves tree hierarchy by including all ancestor nodes of matching nodes under active filters.
 */
export function preserveTreeHierarchy<TData>(
	filteredNodes: RowNode<TData>[],
	allNodes: RowNode<TData>[],
	getParentId: (data: TData) => string | null | undefined
): RowNode<TData>[] {
	const allNodesMap = new Map<string, RowNode<TData>>();
	for (const node of allNodes) {
		allNodesMap.set(node.id, node);
	}

	const includedSet = new Set<string>();
	const result: RowNode<TData>[] = [];

	// Traverse from matched nodes up to roots to add all ancestors
	for (const node of filteredNodes) {
		if (!includedSet.has(node.id)) {
			includedSet.add(node.id);
			result.push(node);
		}

		let curr = node;
		while (curr) {
			const pId = curr.data ? getParentId(curr.data) : null;
			if (pId != null && pId !== '') {
				const parentNode = allNodesMap.get(String(pId));
				if (parentNode) {
					if (!includedSet.has(parentNode.id)) {
						includedSet.add(parentNode.id);
						result.push(parentNode);
					}
					curr = parentNode;
				} else {
					break;
				}
			} else {
				break;
			}
		}
	}

	return result;
}

export function treeStage<TData>(nodes: RowNode<TData>[], getParentId: (data: TData) => string | null | undefined): RowTreeNode<TData>[] {
	const nodeMap = new Map<string, RowTreeNode<TData>>();
	const parentRelations = new Map<string, string[]>(); // parentId -> childIds
	const roots: string[] = [];

	// 1. Build initial flat leaf representation
	for (const node of nodes) {
		const leaf: RowTreeNode<TData> = {
			kind: 'leaf',
			rowId: node.id,
			node,
			depth: 0,
		};
		nodeMap.set(node.id, leaf);

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

	// 2. Treat children whose parent is missing from input list as roots
	for (const [parentId, childIds] of parentRelations.entries()) {
		if (!nodeMap.has(parentId)) {
			roots.push(...childIds);
		}
	}

	// Deduplicate roots
	const uniqueRoots = Array.from(new Set(roots));

	// 3. Build tree hierarchy recursively under the leaf nodes
	const buildSubtree = (nodeId: string, depth: number): RowTreeNode<TData> => {
		const current = nodeMap.get(nodeId)!;
		const childIds = parentRelations.get(nodeId);

		if (!childIds || childIds.length === 0) {
			current.depth = depth;
			return current;
		}

		// Parents remain leaf nodes but have child tree nodes recursively attached
		const childTreeNodes = childIds.map((cId) => buildSubtree(cId, depth + 1));

		const leafCount = childTreeNodes.reduce((acc, child) => {
			return acc + (child.kind === 'leaf' ? 1 + (child.childCount ?? 0) : child.childCount);
		}, 0);

		current.depth = depth;
		current.children = childTreeNodes;
		current.childCount = leafCount;
		current.aggregateValues = {};
		return current;
	};

	return uniqueRoots.map((rootId) => buildSubtree(rootId, 0));
}

import type { RowTreeNode } from './types.js';
import type { SortModel } from '../../rowModel.js';
import { type ColumnDef, RowNode } from '../../store.js';
import { createRowPipelineContext } from '../pipelineContext.js';

export function sortTreeStage<TData>(roots: RowTreeNode<TData>[], sortModel: SortModel | null, columns: ColumnDef<TData>[]): void {
	if (!sortModel || sortModel.length === 0) return;

	const context = createRowPipelineContext(columns, { groups: new Set(), treeRows: new Set(), details: new Set() });
	const precompiledSortGetters = sortModel.map((sortItem) => {
		return (node: RowNode<TData>) => context.getValue(node, sortItem.colId);
	});

	// Sort roots
	sortChildren(roots, sortModel, precompiledSortGetters);

	// Recursively sort children
	for (const root of roots) {
		sortTreeRecursively(root, sortModel, precompiledSortGetters);
	}
}

function sortTreeRecursively<TData>(
	node: RowTreeNode<TData>,
	sortModel: SortModel,
	precompiledSortGetters: ((node: RowNode<TData>) => unknown)[]
): void {
	if (node.kind === 'data' && !node.children?.length) return;

	if (node.children?.length) {
		sortChildren(node.children, sortModel, precompiledSortGetters);
	}

	for (const child of node.children ?? []) {
		sortTreeRecursively(child, sortModel, precompiledSortGetters);
	}
}

function compareValues(a: unknown, b: unknown): number {
	if (a === b) return 0;
	if (a == null) return -1;
	if (b == null) return 1;

	if (typeof a === 'number' && typeof b === 'number') {
		return a - b;
	}

	const aNumber = Number(a);
	const bNumber = Number(b);
	if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
		return aNumber - bNumber;
	}

	const aStr = String(a);
	const bStr = String(b);
	if (aStr < bStr) return -1;
	if (aStr > bStr) return 1;
	return 0;
}

function sortChildren<TData>(
	children: RowTreeNode<TData>[],
	sortModel: SortModel,
	precompiledSortGetters: ((node: RowNode<TData>) => unknown)[]
): void {
	children.sort((a, b) => {
		// If both are group nodes, compare by key
		if (a.kind === 'group' && b.kind === 'group') {
			let comp = 0;
			const aVal = a.keyString;
			const bVal = b.keyString;
			if (aVal < bVal) comp = -1;
			else if (aVal > bVal) comp = 1;

			// Find the sort direction for the field of this group node, if any
			const fieldSort = sortModel.find((s) => s.colId === a.field);
			if (fieldSort && fieldSort.sort === 'desc') {
				return -comp;
			}
			return comp;
		}

		// If both are leaf nodes, compare using standard sort model
		if (a.kind === 'data' && b.kind === 'data') {
			for (let i = 0; i < sortModel.length; i++) {
				const sortItem = sortModel[i];
				const aVal = precompiledSortGetters[i](a.node);
				const bVal = precompiledSortGetters[i](b.node);

				const comparison = compareValues(aVal, bVal);
				if (comparison !== 0) {
					return sortItem.sort === 'desc' ? -comparison : comparison;
				}
			}
			return 0;
		}

		// Hybrid comparison (fallback)
		return a.kind === 'group' ? -1 : 1;
	});
}

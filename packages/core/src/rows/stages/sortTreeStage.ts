import type { RowTreeNode } from './types.js';
import type { SortModel } from '../../rowModel.js';
import { compilePathGetter, type ColumnDef, RowNode } from '../../store.js';

export function sortTreeStage<TData>(roots: RowTreeNode<TData>[], sortModel: SortModel | null, columns: ColumnDef<TData>[]): void {
	if (!sortModel || sortModel.length === 0) return;

	const columnById = new Map<string, ColumnDef<TData>>();
	columns.forEach((col) => {
		columnById.set(col.field, col);
	});

	const precompiledSortGetters = sortModel.map((sortItem) => {
		const column = columnById.get(sortItem.colId);
		let getter: (node: RowNode<TData>) => unknown;
		if (column) {
			if (column.valueGetter) {
				const colValGetter = column.valueGetter;
				getter = (node: RowNode<TData>) => colValGetter({ node, row: node.data, colField: column.field });
			} else {
				const pathGetter = compilePathGetter(column.field);
				getter = (node: RowNode<TData>) => node.getCellValue(column.field, pathGetter);
			}
		} else {
			const pathGetter = compilePathGetter(sortItem.colId);
			getter = (node: RowNode<TData>) => node.getCellValue(sortItem.colId, pathGetter);
		}
		return getter;
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
	if (!node.children || node.children.length === 0) return;

	sortChildren(node.children, sortModel, precompiledSortGetters);

	for (const child of node.children) {
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
			const aVal = String(a.key);
			const bVal = String(b.key);
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
		if (a.kind === 'leaf' && b.kind === 'leaf') {
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

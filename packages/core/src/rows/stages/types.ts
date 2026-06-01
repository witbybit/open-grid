import { RowNode } from '../../store.js';

export type RowTreeNode<TData = unknown> =
	| {
			kind: 'leaf';
			rowId: string;
			node: RowNode<TData>;
			depth: number;
			children?: RowTreeNode<TData>[];
			childCount?: number;
			aggregateValues?: Record<string, unknown>;
	  }
	| {
			kind: 'group';
			id: string;
			field: string;
			key: string;
			depth: number;
			children: RowTreeNode<TData>[];
			childCount: number;
			aggregateValues: Record<string, unknown>;
	  };

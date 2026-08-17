import type { GridRowNode } from './publicRowNode.js';
import type { RowNode } from './rowNode.js';

export interface RowNodeTransaction<TData = unknown> {
	add: GridRowNode<TData>[];
	remove: GridRowNode<TData>[];
	update: GridRowNode<TData>[];
}

export interface InternalRowNodeTransaction<TData = unknown> {
	add: RowNode<TData>[];
	remove: RowNode<TData>[];
	update: RowNode<TData>[];
}

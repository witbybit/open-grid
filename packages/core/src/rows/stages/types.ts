import { RowNode, type ColumnDef } from '../../store.js';
import type { GroupDef } from '../RowPipeline.js';
import type { GroupPathItem } from '../visualRowIds.js';

export type RowTreeNode<TData = unknown> =
	| {
			kind: 'data';
			rowId: string;
			node: RowNode<TData>;
			depth: number;
			children?: RowTreeNode<TData>[];
	  }
	| {
			kind: 'group';
			id: string;
			field: string;
			key: unknown;
			keyString: string;
			depth: number;
			path: GroupPathItem[];
			children: RowTreeNode<TData>[];
			childCount: number;
			leafCount: number;
			aggregateValues: Record<string, unknown>;
	  };

export interface RowPipelineExpansion {
	groups: Set<string>;
	treeRows: Set<string>;
	details: Set<string>;
}

export interface RowPipelineContext<TData = unknown> {
	columnsById: Map<string, ColumnDef<TData>>;
	getValue: (node: RowNode<TData>, colId: string) => unknown;
	getGroupKey: (node: RowNode<TData>, groupDef: GroupDef<TData>) => { key: unknown; keyString: string };
	expansion: RowPipelineExpansion;
}

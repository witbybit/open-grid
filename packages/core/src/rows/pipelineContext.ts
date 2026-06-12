import { compilePathGetter, RowNode, type ColumnDef } from '../store.js';
import type { GroupDef } from './RowPipeline.js';
import type { RowPipelineContext, RowPipelineExpansion } from './stages/types.js';

export function getCellValueForPipeline<TData>(node: RowNode<TData>, column: ColumnDef<TData> | undefined, colId: string): unknown {
	if (!column) {
		const getter = compilePathGetter(colId);
		return node.getCellValue(colId, getter);
	}
	if (column.valueGetter) {
		return column.valueGetter({ node, row: node.data, colField: column.field });
	}
	const getter = compilePathGetter(column.field);
	return node.getCellValue(column.field, getter);
}

export function createRowPipelineContext<TData>(columns: ColumnDef<TData>[], expansion: RowPipelineExpansion): RowPipelineContext<TData> {
	const columnsById = new Map<string, ColumnDef<TData>>();
	for (const column of columns) {
		columnsById.set(column.field, column);
	}

	return {
		columnsById,
		expansion,
		getValue: (node, colId) => getCellValueForPipeline(node, columnsById.get(colId), colId),
		getGroupKey: (node, groupDef: GroupDef<TData>) => {
			const value = getCellValueForPipeline(node, columnsById.get(groupDef.colId), groupDef.colId);
			const keyString = groupDef.keyCreator ? groupDef.keyCreator({ value, row: node.data, rowId: node.id }) : String(value ?? 'None');
			return { key: value, keyString };
		},
	};
}

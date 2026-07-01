/**
 * Client-side evaluator for GridQueryModel.
 *
 * Takes a query model, a row, and a lookup context, and returns true when the
 * row satisfies the query. Invalid conditions (unknown column, unknown operator)
 * produce diagnostics and are treated as passing so they don't silently drop rows.
 */
import type { ColumnDef } from '../columnDef.js';
import { compilePathGetter } from '../columnDef.js';
import type { RowNode } from '../rowNode.js';
import type { GridQueryCondition, GridQueryGroup, GridQueryModel, GridQueryNode, QueryConditionDiagnostic } from './GridQueryModel.js';
import { getQueryOperator } from './queryOperatorRegistry.js';

export interface QueryEvaluationContext<TRowData = unknown> {
	getCellValue(node: RowNode<TRowData>, columnId: string): unknown;
	getColumnType(columnId: string): string | null;
	reportDiagnostic?(diag: QueryConditionDiagnostic): void;
}

function evaluateNode<TRowData>(node: GridQueryNode, rowNode: RowNode<TRowData>, ctx: QueryEvaluationContext<TRowData>): boolean {
	if (node.kind === 'condition') {
		return evaluateCondition(node, rowNode, ctx);
	}
	return evaluateGroup(node, rowNode, ctx);
}

function evaluateGroup<TRowData>(group: GridQueryGroup, rowNode: RowNode<TRowData>, ctx: QueryEvaluationContext<TRowData>): boolean {
	const validChildren = group.children.filter((c): boolean => {
		if (c.kind === 'group') return c.children.length > 0;
		return true;
	});
	if (validChildren.length === 0) return true;
	if (group.operator === 'and') {
		return validChildren.every((child) => evaluateNode(child, rowNode, ctx));
	}
	return validChildren.some((child) => evaluateNode(child, rowNode, ctx));
}

function evaluateCondition<TRowData>(condition: GridQueryCondition, rowNode: RowNode<TRowData>, ctx: QueryEvaluationContext<TRowData>): boolean {
	const columnType = ctx.getColumnType(condition.columnId);
	if (columnType === null) {
		ctx.reportDiagnostic?.({
			conditionId: condition.id,
			columnId: condition.columnId,
			reason: 'unknown-column',
			message: `Query condition references unknown column "${condition.columnId}"`,
		});
		return true;
	}

	const opDef = getQueryOperator(columnType, condition.operator);
	if (!opDef) {
		ctx.reportDiagnostic?.({
			conditionId: condition.id,
			columnId: condition.columnId,
			reason: 'unknown-operator',
			message: `Unknown operator "${condition.operator}" for column type "${columnType}"`,
		});
		return true;
	}

	const cellValue = ctx.getCellValue(rowNode, condition.columnId);
	return opDef.evaluate({ cellValue, value: condition.value, valueTo: condition.valueTo });
}

/** Evaluate a query model against a single row node. Returns true when the row passes. */
export function evaluateQueryModel<TRowData>(queryModel: GridQueryModel, rowNode: RowNode<TRowData>, ctx: QueryEvaluationContext<TRowData>): boolean {
	return evaluateGroup(queryModel.root, rowNode, ctx);
}

/**
 * Build an evaluation context from a columns array.
 * Looks up column types by field name, gets cell values via valueGetter or path.
 */
export function createQueryEvaluationContext<TRowData>(
	columns: ColumnDef<TRowData>[],
	reportDiagnostic?: (diag: QueryConditionDiagnostic) => void
): QueryEvaluationContext<TRowData> {
	const columnMap = new Map<string, ColumnDef<TRowData>>();
	for (const col of columns) columnMap.set(col.field, col);

	const getterCache = new Map<string, (node: RowNode<TRowData>) => unknown>();

	function getCellValue(node: RowNode<TRowData>, columnId: string): unknown {
		const col = columnMap.get(columnId);
		if (!col) return undefined;
		let getter = getterCache.get(columnId);
		if (!getter) {
			if (col.valueGetter) {
				const vg = col.valueGetter;
				getter = (n) => vg({ node: n, row: n.data, colField: col.field });
			} else {
				const pg = compilePathGetter(col.field);
				getter = (n) => n.getCellValue(col.field, pg);
			}
			getterCache.set(columnId, getter);
		}
		return getter(node);
	}

	function getColumnType(columnId: string): string | null {
		const col = columnMap.get(columnId);
		if (!col) return null;
		return (col.filterType as string | null | undefined) ?? 'text';
	}

	return { getCellValue, getColumnType, reportDiagnostic };
}

/**
 * Filter a node array by a query model. Returns the input array unchanged when
 * queryModel is null or has no conditions.
 */
export function applyQueryModelFilter<TRowData>(
	nodes: RowNode<TRowData>[],
	columns: ColumnDef<TRowData>[],
	queryModel: GridQueryModel | null | undefined,
	reportDiagnostic?: (diag: QueryConditionDiagnostic) => void
): RowNode<TRowData>[] {
	if (!queryModel) return nodes;
	if (queryModel.root.children.length === 0) return nodes;
	const ctx = createQueryEvaluationContext(columns, reportDiagnostic);
	return nodes.filter((node) => evaluateQueryModel(queryModel, node, ctx));
}

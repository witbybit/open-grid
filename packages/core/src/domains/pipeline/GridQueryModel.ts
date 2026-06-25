import type { FilterOperator } from './PipelineModels.js';
import { evaluateOperator } from './PipelineModels.js';

// ---------------------------------------------------------------------------
// Query AST
// ---------------------------------------------------------------------------

export interface QueryGroup {
	readonly type: 'group';
	readonly operator: 'and' | 'or';
	readonly children: readonly QueryNode[];
	readonly negated?: boolean;
}

export interface QueryCondition {
	readonly type: 'condition';
	readonly field: string;
	readonly operator: FilterOperator;
	readonly value?: unknown;
	readonly negated?: boolean;
}

export type QueryNode = QueryGroup | QueryCondition;

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a query node against a row. `getFieldValue` extracts a cell value by field name.
 */
export function evaluateQueryNode(node: QueryNode, getFieldValue: (field: string) => unknown): boolean {
	if (node.type === 'condition') {
		const cellValue = getFieldValue(node.field);
		const result = evaluateOperator(node.operator, cellValue, node.value);
		return node.negated ? !result : result;
	}

	// group
	const { children, operator, negated } = node;
	if (children.length === 0) return true;

	const result =
		operator === 'and'
			? children.every((child) => evaluateQueryNode(child, getFieldValue))
			: children.some((child) => evaluateQueryNode(child, getFieldValue));

	return negated ? !result : result;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function queryGroup(operator: 'and' | 'or', children: QueryNode[], negated?: boolean): QueryGroup {
	return { type: 'group', operator, children, negated };
}

export function queryCondition(field: string, operator: FilterOperator, value?: unknown, negated?: boolean): QueryCondition {
	return { type: 'condition', field, operator, value, negated };
}

/** Convert a flat FilterModel to an equivalent AND query group. */
export function filterModelToQuery(filterModel: readonly { field: string; operator: FilterOperator; value?: unknown }[]): QueryGroup {
	return queryGroup(
		'and',
		filterModel.map((f) => queryCondition(f.field, f.operator, f.value)),
	);
}

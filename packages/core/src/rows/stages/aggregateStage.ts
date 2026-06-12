import { RowNode } from '../../store.js';
import type { RowPipelineContext, RowTreeNode } from './types.js';

export interface AggregationDef<TData = unknown> {
	field: string;
	aggFunc: 'sum' | 'avg' | 'min' | 'max' | 'count' | ((nodes: RowNode<TData>[]) => unknown);
}

export function aggregateStage<TData>(roots: RowTreeNode<TData>[], aggDefs: AggregationDef<TData>[], context: RowPipelineContext<TData>): void {
	if (aggDefs.length === 0) return;

	for (const root of roots) {
		aggregateNodeRecursively(root, aggDefs, context);
	}
}

function aggregateNodeRecursively<TData>(
	node: RowTreeNode<TData>,
	aggDefs: AggregationDef<TData>[],
	context: RowPipelineContext<TData>
): RowNode<TData>[] {
	if (node.kind === 'data' && !node.children?.length) {
		return [node.node];
	}

	const descendantLeafNodes: RowNode<TData>[] = [];
	if (node.kind === 'data') {
		descendantLeafNodes.push(node.node);
	}
	for (const child of node.children ?? []) {
		const childLeaves = aggregateNodeRecursively(child, aggDefs, context);
		descendantLeafNodes.push(...childLeaves);
	}

	if (node.kind === 'data') {
		return descendantLeafNodes;
	}

	const aggregateValues: Record<string, unknown> = {};

	for (const def of aggDefs) {
		const { field, aggFunc } = def;

		if (typeof aggFunc === 'function') {
			try {
				aggregateValues[field] = aggFunc(descendantLeafNodes);
			} catch (e) {
				console.error(`aggregation failed for custom fn on field ${field}`, e);
				aggregateValues[field] = undefined;
			}
			continue;
		}

		if (aggFunc === 'count') {
			aggregateValues[field] = descendantLeafNodes.length;
			continue;
		}

		const values = descendantLeafNodes.map((n) => context.getValue(n, field)).filter((v) => typeof v === 'number' && !isNaN(v)) as number[];

		if (values.length === 0) {
			aggregateValues[field] = undefined;
			continue;
		}

		switch (aggFunc) {
			case 'sum':
				aggregateValues[field] = values.reduce((sum, v) => sum + v, 0);
				break;
			case 'avg':
				const sum = values.reduce((sum, v) => sum + v, 0);
				aggregateValues[field] = values.length > 0 ? sum / values.length : 0;
				break;
			case 'min':
				aggregateValues[field] = Math.min(...values);
				break;
			case 'max':
				aggregateValues[field] = Math.max(...values);
				break;
		}
	}

	node.aggregateValues = aggregateValues;
	return descendantLeafNodes;
}

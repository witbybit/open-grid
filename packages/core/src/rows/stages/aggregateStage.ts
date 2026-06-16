import { RowNode } from '../../store.js';
import type { RowPipelineContext, RowTreeNode } from './types.js';

export interface AggregationDef<TData = unknown> {
	field: string;
	aggFunc: 'sum' | 'avg' | 'min' | 'max' | 'count' | ((nodes: RowNode<TData>[]) => unknown);
}

export function aggregateStage<TData>(roots: RowTreeNode<TData>[], aggDefs: AggregationDef<TData>[], context: RowPipelineContext<TData>): void {
	if (aggDefs.length === 0) return;

	const needsLeafNodes = aggDefs.some((def) => typeof def.aggFunc === 'function');
	for (const root of roots) {
		aggregateNodeRecursively(root, aggDefs, context, needsLeafNodes);
	}
}

interface NumericStats {
	totalCount: number;
	numericCount: number;
	sum: number;
	min: number;
	max: number;
}

interface AggregateVisitResult<TData> {
	statsByField: Map<string, NumericStats>;
	leafNodes?: RowNode<TData>[];
}

function createStats(): NumericStats {
	return {
		totalCount: 0,
		numericCount: 0,
		sum: 0,
		min: Infinity,
		max: -Infinity,
	};
}

function addNodeValue<TData>(stats: NumericStats, node: RowNode<TData>, field: string, context: RowPipelineContext<TData>): void {
	stats.totalCount++;
	const value = context.getValue(node, field);
	if (typeof value === 'number' && !isNaN(value)) {
		stats.numericCount++;
		stats.sum += value;
		if (value < stats.min) stats.min = value;
		if (value > stats.max) stats.max = value;
	}
}

function mergeStats(target: NumericStats, source: NumericStats): void {
	target.totalCount += source.totalCount;
	target.numericCount += source.numericCount;
	target.sum += source.sum;
	if (source.min < target.min) target.min = source.min;
	if (source.max > target.max) target.max = source.max;
}

function getStats(statsByField: Map<string, NumericStats>, field: string): NumericStats {
	let stats = statsByField.get(field);
	if (!stats) {
		stats = createStats();
		statsByField.set(field, stats);
	}
	return stats;
}

function aggregateNodeRecursively<TData>(
	node: RowTreeNode<TData>,
	aggDefs: AggregationDef<TData>[],
	context: RowPipelineContext<TData>,
	needsLeafNodes: boolean
): AggregateVisitResult<TData> {
	const statsByField = new Map<string, NumericStats>();
	const leafNodes: RowNode<TData>[] | undefined = needsLeafNodes ? [] : undefined;

	if (node.kind === 'data') {
		if (leafNodes) leafNodes.push(node.node);
		for (const def of aggDefs) {
			if (typeof def.aggFunc !== 'function') {
				addNodeValue(getStats(statsByField, def.field), node.node, def.field, context);
			}
		}
	}

	for (const child of node.children ?? []) {
		const childResult = aggregateNodeRecursively(child, aggDefs, context, needsLeafNodes);
		for (const [field, childStats] of childResult.statsByField) {
			mergeStats(getStats(statsByField, field), childStats);
		}
		if (leafNodes && childResult.leafNodes) {
			leafNodes.push(...childResult.leafNodes);
		}
	}

	if (node.kind === 'data') {
		return { statsByField, leafNodes };
	}

	const aggregateValues: Record<string, unknown> = {};

	for (const def of aggDefs) {
		const { field, aggFunc } = def;

		if (typeof aggFunc === 'function') {
			try {
				aggregateValues[field] = aggFunc(leafNodes ?? []);
			} catch (e) {
				context.reportFault?.('custom-aggregation', e, { field });
				aggregateValues[field] = undefined;
			}
			continue;
		}

		if (aggFunc === 'count') {
			aggregateValues[field] = statsByField.get(field)?.totalCount ?? 0;
			continue;
		}

		const stats = statsByField.get(field);
		if (!stats || stats.numericCount === 0) {
			aggregateValues[field] = undefined;
			continue;
		}

		switch (aggFunc) {
			case 'sum':
				aggregateValues[field] = stats.sum;
				break;
			case 'avg':
				aggregateValues[field] = stats.sum / stats.numericCount;
				break;
			case 'min':
				aggregateValues[field] = stats.min;
				break;
			case 'max':
				aggregateValues[field] = stats.max;
				break;
		}
	}

	node.aggregateValues = aggregateValues;
	return { statsByField, leafNodes };
}

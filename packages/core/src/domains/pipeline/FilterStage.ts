import type { GridChangeSet } from '../../kernel/GridChangeSet.js';
import type { RowNode } from '../rows/RowNode.js';
import { getFieldValue } from './fieldValue.js';
import type { PipelineContext, PipelineStage, PipelineUpdateResult } from './PipelineStage.js';
import { evaluateOperator } from './PipelineModels.js';
import { evaluateQueryNode } from './GridQueryModel.js';

type Rows<TRow> = readonly RowNode<TRow>[];

/**
 * Keeps only rows that pass every column filter (AND semantics) — ARCHITECTURE.md §3 R7.
 * When a queryNode is active it takes precedence over the flat filterModel.
 */
export class FilterStage<TRow> implements PipelineStage<Rows<TRow>, Rows<TRow>> {
	readonly id = 'filter';

	build(input: Rows<TRow>, ctx: PipelineContext): Rows<TRow> {
		if (ctx.queryNode) {
			return input.filter((node) =>
				evaluateQueryNode(ctx.queryNode!, (field) => getFieldValue(node.data, field)),
			);
		}
		if (ctx.filterModel.length === 0) return input;
		return input.filter((node) =>
			ctx.filterModel.every((filter) =>
				evaluateOperator(filter.operator, getFieldValue(node.data, filter.field), filter.value),
			),
		);
	}

	update(_previous: Rows<TRow>, _changeSet: GridChangeSet, ctx: PipelineContext, input: Rows<TRow>): PipelineUpdateResult<Rows<TRow>> {
		return { output: this.build(input, ctx), rebuilt: true };
	}
}

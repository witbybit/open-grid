import type { GridChangeSet } from '../../kernel/GridChangeSet.js';
import type { RowNode } from '../rows/RowNode.js';
import { getFieldValue } from './fieldValue.js';
import type { PipelineContext, PipelineStage, PipelineUpdateResult } from './PipelineStage.js';

type Rows<TRow> = readonly RowNode<TRow>[];

/**
 * Keeps only rows that pass every column filter (AND semantics) — ARCHITECTURE.md §3 R7.
 */
export class FilterStage<TRow> implements PipelineStage<Rows<TRow>, Rows<TRow>> {
	readonly id = 'filter';

	build(input: Rows<TRow>, ctx: PipelineContext): Rows<TRow> {
		if (ctx.filterModel.length === 0) return input;
		return input.filter((node) =>
			ctx.filterModel.every((filter) => filter.predicate(getFieldValue(node.data, filter.field), node.data)),
		);
	}

	update(_previous: Rows<TRow>, _changeSet: GridChangeSet, ctx: PipelineContext, input: Rows<TRow>): PipelineUpdateResult<Rows<TRow>> {
		// Honest rebuild — incremental membership tracking lands later without changing the contract.
		return { output: this.build(input, ctx), rebuilt: true };
	}
}

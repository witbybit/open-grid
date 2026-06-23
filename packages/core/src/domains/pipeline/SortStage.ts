import type { GridChangeSet } from '../../kernel/GridChangeSet.js';
import type { RowNode } from '../rows/RowNode.js';
import { defaultCompare, getFieldValue } from './fieldValue.js';
import type { PipelineContext, PipelineStage, PipelineUpdateResult } from './PipelineStage.js';

type Rows<TRow> = readonly RowNode<TRow>[];

/**
 * Multi-key stable sort (ARCHITECTURE.md §3 R7). Stability is preserved by falling back to the
 * original source index when all sort keys tie, so equal rows keep their input order.
 */
export class SortStage<TRow> implements PipelineStage<Rows<TRow>, Rows<TRow>> {
	readonly id = 'sort';

	build(input: Rows<TRow>, ctx: PipelineContext): Rows<TRow> {
		if (ctx.sortModel.length === 0) return input;
		const keys = ctx.sortModel;
		// decorate-sort to keep it stable across engines
		return input
			.map((node, index) => ({ node, index }))
			.sort((a, b) => {
				for (const key of keys) {
					const av = getFieldValue(a.node.data, key.field);
					const bv = getFieldValue(b.node.data, key.field);
					const cmp = defaultCompare(av, bv);
					if (cmp !== 0) return key.direction === 'desc' ? -cmp : cmp;
				}
				return a.index - b.index;
			})
			.map((entry) => entry.node);
	}

	update(_previous: Rows<TRow>, _changeSet: GridChangeSet, ctx: PipelineContext, input: Rows<TRow>): PipelineUpdateResult<Rows<TRow>> {
		return { output: this.build(input, ctx), rebuilt: true };
	}
}

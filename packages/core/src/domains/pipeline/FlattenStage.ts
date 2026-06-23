import type { GridChangeSet } from '../../kernel/GridChangeSet.js';
import type { RowNode } from '../rows/RowNode.js';
import type { PipelineContext, PipelineStage, PipelineUpdateResult } from './PipelineStage.js';
import type { VisualRow } from './VisualRow.js';
import { dataVisualRow } from './VisualRow.js';

type Rows<TRow> = readonly RowNode<TRow>[];
type Visual<TRow> = readonly VisualRow<TRow>[];

/**
 * Projects filtered+sorted row nodes into visual rows (ARCHITECTURE.md §3 R6). For this reset every
 * row flattens to a `data` visual row; group/tree/detail/loading/placeholder rows are emitted here
 * once those stages land, without changing this stage's contract.
 */
export class FlattenStage<TRow> implements PipelineStage<Rows<TRow>, Visual<TRow>> {
	readonly id = 'flatten';

	build(input: Rows<TRow>, _ctx: PipelineContext): Visual<TRow> {
		return input.map((node) => dataVisualRow(node));
	}

	update(_previous: Visual<TRow>, _changeSet: GridChangeSet, ctx: PipelineContext, input: Rows<TRow>): PipelineUpdateResult<Visual<TRow>> {
		return { output: this.build(input, ctx), rebuilt: true };
	}
}

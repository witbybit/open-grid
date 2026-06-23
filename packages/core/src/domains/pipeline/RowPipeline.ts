import type { RowChangeSet } from '../rows/RowChangeSet.js';
import { isFieldOnlyChange } from '../rows/RowChangeSet.js';
import type { RowNode } from '../rows/RowNode.js';
import { FilterStage } from './FilterStage.js';
import { FlattenStage } from './FlattenStage.js';
import type { FilterModel, SortModel } from './PipelineModels.js';
import { EMPTY_FILTER_MODEL, EMPTY_SORT_MODEL, filterColumnIds, sortColumnIds } from './PipelineModels.js';
import type { PipelineContext } from './PipelineStage.js';
import type { RowWriteImpact, RowWriteImpactContext } from './RowWriteImpact.js';
import { classifyWriteImpact } from './RowWriteImpact.js';
import { SortStage } from './SortStage.js';
import { VisualModel } from './VisualModel.js';

export type RowSource<TRow> = () => readonly RowNode<TRow>[];

/**
 * Runs the row nodes through filter → sort → flatten to produce the {@link VisualModel}
 * (ARCHITECTURE.md §3 R6). Holds the active sort/filter models and exposes the SHARED impact
 * classifier (R7). It is a pure transform over the row source — it owns no storage, publishes no
 * events, and bumps no versions.
 */
export class RowPipeline<TRow> {
	private readonly source: RowSource<TRow>;
	private readonly filterStage = new FilterStage<TRow>();
	private readonly sortStage = new SortStage<TRow>();
	private readonly flattenStage = new FlattenStage<TRow>();

	private sortModel: SortModel = EMPTY_SORT_MODEL;
	private filterModel: FilterModel = EMPTY_FILTER_MODEL;
	private visualModel: VisualModel<TRow> = new VisualModel<TRow>([]);

	constructor(source: RowSource<TRow>) {
		this.source = source;
	}

	getSortModel(): SortModel {
		return this.sortModel;
	}

	getFilterModel(): FilterModel {
		return this.filterModel;
	}

	getVisualModel(): VisualModel<TRow> {
		return this.visualModel;
	}

	setSortModel(model: SortModel): VisualModel<TRow> {
		this.sortModel = model;
		return this.recompute();
	}

	setFilterModel(model: FilterModel): VisualModel<TRow> {
		this.filterModel = model;
		return this.recompute();
	}

	/** Rebuild the visual model from the current row source and sort/filter models. */
	recompute(): VisualModel<TRow> {
		const ctx = this.context();
		const filtered = this.filterStage.build(this.source(), ctx);
		const sorted = this.sortStage.build(filtered, ctx);
		const visual = this.flattenStage.build(sorted, ctx);
		this.visualModel = new VisualModel<TRow>(visual);
		return this.visualModel;
	}

	/** Classify a row change against the active sort/filter models (R7). */
	classify(changeSet: RowChangeSet): RowWriteImpact {
		if (!isFieldOnlyChange(changeSet)) return 'structural';
		return classifyWriteImpact(changeSet.changedFieldsByRow, this.impactContext());
	}

	private context(): PipelineContext {
		return { sortModel: this.sortModel, filterModel: this.filterModel };
	}

	private impactContext(): RowWriteImpactContext {
		return {
			filterColumns: filterColumnIds(this.filterModel),
			sortColumns: sortColumnIds(this.sortModel),
		};
	}
}

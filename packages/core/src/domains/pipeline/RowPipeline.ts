import type { RowChangeSet } from '../rows/RowChangeSet.js';
import { isFieldOnlyChange } from '../rows/RowChangeSet.js';
import type { RowNode } from '../rows/RowNode.js';
import { FilterStage } from './FilterStage.js';
import { buildGroupedVisualRows } from './GroupStage.js';
import { EMPTY_GROUP_BY, GroupExpansionState, groupColumnIds } from './GroupModel.js';
import type { GroupByModel } from './GroupModel.js';
import { buildTreeVisualRows } from './TreeStage.js';
import type { TreeDataOptions } from './TreeStage.js';
import { DetailExpansionState, insertDetailRows } from './DetailStage.js';
import type { FilterModel, SortModel } from './PipelineModels.js';
import { EMPTY_FILTER_MODEL, EMPTY_SORT_MODEL, filterColumnIds, sortColumnIds } from './PipelineModels.js';
import type { PipelineContext } from './PipelineStage.js';
import type { RowWriteImpact, RowWriteImpactContext } from './RowWriteImpact.js';
import { classifyWriteImpact } from './RowWriteImpact.js';
import { SortStage } from './SortStage.js';
import { VisualModel } from './VisualModel.js';
import type { VisualModelView } from './VisualModel.js';
import { WindowedVisualModel } from './WindowedVisualModel.js';

export type RowSource<TRow> = () => readonly RowNode<TRow>[];

/**
 * Windowed-dataset source for infinite/server row models: total logical count + a per-index loaded
 * node accessor. When provided, the pipeline produces a lazy windowed visual model (data rows where
 * loaded, loading rows in gaps) and skips client filter/sort/group/tree (the server owns those).
 */
export interface WindowedSource<TRow> {
	getTotalRowCount(): number;
	getNodeByIndex(index: number): RowNode<TRow> | null;
}

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

	private sortModel: SortModel = EMPTY_SORT_MODEL;
	private filterModel: FilterModel = EMPTY_FILTER_MODEL;
	private groupBy: GroupByModel = EMPTY_GROUP_BY;
	private readonly expansion = new GroupExpansionState();
	private treeOptions: TreeDataOptions<TRow> | null = null;
	private readonly treeExpansion = new GroupExpansionState();
	private readonly detailExpansion = new DetailExpansionState();
	private readonly windowed: WindowedSource<TRow> | null;
	private visualModel: VisualModelView<TRow> = new VisualModel<TRow>([]);

	constructor(source: RowSource<TRow>, windowed?: WindowedSource<TRow>) {
		this.source = source;
		this.windowed = windowed ?? null;
	}

	getSortModel(): SortModel {
		return this.sortModel;
	}

	getFilterModel(): FilterModel {
		return this.filterModel;
	}

	getVisualModel(): VisualModelView<TRow> {
		return this.visualModel;
	}

	setSortModel(model: SortModel): VisualModelView<TRow> {
		this.sortModel = model;
		return this.recompute();
	}

	setFilterModel(model: FilterModel): VisualModelView<TRow> {
		this.filterModel = model;
		return this.recompute();
	}

	getGroupBy(): GroupByModel {
		return this.groupBy;
	}

	setGroupBy(model: GroupByModel): VisualModelView<TRow> {
		this.groupBy = model;
		return this.recompute();
	}

	/** Toggle a group's expansion and rebuild. Returns the new visual model. */
	toggleGroup(groupKey: string): VisualModelView<TRow> {
		this.expansion.toggle(groupKey);
		return this.recompute();
	}

	setGroupExpanded(groupKey: string, expanded: boolean): VisualModelView<TRow> {
		this.expansion.setExpanded(groupKey, expanded);
		return this.recompute();
	}

	// ── Tree data ──
	setTreeData(options: TreeDataOptions<TRow> | null): VisualModelView<TRow> {
		this.treeOptions = options;
		return this.recompute();
	}

	toggleTreeNode(rowId: string): VisualModelView<TRow> {
		this.treeExpansion.toggle(rowId);
		return this.recompute();
	}

	// ── Master/detail ──
	toggleDetail(rowId: string): VisualModelView<TRow> {
		this.detailExpansion.toggle(rowId);
		return this.recompute();
	}

	setDetailOpen(rowId: string, open: boolean): VisualModelView<TRow> {
		this.detailExpansion.setOpen(rowId, open);
		return this.recompute();
	}

	/**
	 * Rebuild the visual model: filter → sort → shape → detail.
	 * Shape is tree (if tree data is configured), else grouped (if group-by is active), else flat
	 * data rows. Master/detail rows are inserted as a post-pass on top of any shape.
	 */
	recompute(): VisualModelView<TRow> {
		// Windowed (infinite/server): the server owns filter/sort/group; we project the full logical
		// height with data rows where loaded and loading rows in the gaps, lazily.
		if (this.windowed) {
			this.visualModel = new WindowedVisualModel<TRow>(
				this.windowed.getTotalRowCount(),
				(index) => this.windowed!.getNodeByIndex(index),
				this.source(),
			);
			return this.visualModel;
		}

		const ctx = this.context();
		const filtered = this.filterStage.build(this.source(), ctx);
		const sorted = this.sortStage.build(filtered, ctx);
		const shaped = this.treeOptions
			? buildTreeVisualRows(sorted, this.treeOptions, this.treeExpansion)
			: buildGroupedVisualRows(sorted, this.groupBy, this.expansion);
		const withDetail = insertDetailRows(shaped, this.detailExpansion);
		this.visualModel = new VisualModel<TRow>(withDetail);
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
			groupColumns: groupColumnIds(this.groupBy),
		};
	}
}

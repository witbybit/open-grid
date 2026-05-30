import { RowNode, type ColumnDef, type VisualRow } from '../store.js';
import type { SortModel, FilterModel } from '../rowModel.js';
import { applyClientSortAndFilter } from '../rowModel.js';
import { groupStage } from './stages/groupStage.js';
import { treeStage } from './stages/treeStage.js';
import { sortTreeStage } from './stages/sortTreeStage.js';
import { aggregateStage, type AggregationDef } from './stages/aggregateStage.js';
import { flattenStage } from './stages/flattenStage.js';
import type { RowTreeNode } from './stages/types.js';

export interface RowPipelineInput<TData = unknown> {
	nodes: RowNode<TData>[];
	columns: ColumnDef<TData>[];
	sortModel: SortModel | null;
	filterModel: FilterModel | null;

	// Tree / Group / Detail configs
	groupBy?: string[];
	getParentId?: (data: TData) => string | null | undefined;
	aggDefs?: AggregationDef<TData>[];
	expandedGroupIds: Set<string>;
	expandedDetailRowIds: Set<string>;

	// Heights
	defaultRowHeight: number;
	rowHeightsRecord: Record<string, number>;
	groupRowHeight?: number;
	detailRowHeight?: number;
	masterDetailEnabled?: boolean;
	detailRenderer?: unknown;
}

export interface RowPipelineOutput<TData = unknown> {
	visualRows: VisualRow<TData>[];
	visualRowIdMap: Map<string, number>;
}

export class RowPipeline<TData = unknown> {
	public run(input: RowPipelineInput<TData>): RowPipelineOutput<TData> {
		const {
			nodes,
			columns,
			sortModel,
			filterModel,
			groupBy,
			getParentId,
			aggDefs = [],
			expandedGroupIds,
			expandedDetailRowIds,
			defaultRowHeight,
			rowHeightsRecord,
			groupRowHeight,
			detailRowHeight,
			masterDetailEnabled,
			detailRenderer,
		} = input;

		// 1. Filter raw leaf nodes (reuse existing client filter implementation)
		const filteredWrappers = applyClientSortAndFilter(nodes, columns, null, filterModel);
		const filteredNodes = filteredWrappers.map((w) => w.node);

		// 2. Build tree structure: either Grouping or Parent-Child Tree Data
		let roots: RowTreeNode<TData>[];

		if (groupBy && groupBy.length > 0) {
			roots = groupStage(filteredNodes, groupBy);
		} else if (getParentId) {
			roots = treeStage(filteredNodes, getParentId);
		} else {
			// Flat list of leaf nodes
			roots = filteredNodes.map((node) => ({
				kind: 'leaf',
				rowId: node.id,
				node,
				depth: 0,
			}));
		}

		// 3. Hierarchical Sort inside the tree structure
		if (sortModel && sortModel.length > 0) {
			sortTreeStage(roots, sortModel, columns);
		}

		// 4. Perform bottom-up calculations/aggregates
		if (aggDefs && aggDefs.length > 0) {
			aggregateStage(roots, aggDefs);
		}

		// 5. Flatten the visible/expanded tree nodes into visualRows
		const visualRows = flattenStage(roots, {
			expandedGroupIds,
			expandedDetailRowIds,
			defaultRowHeight,
			rowHeightsRecord,
			groupRowHeight,
			detailRowHeight,
			masterDetailEnabled,
			detailRenderer,
		});

		// 6. Build quick lookup visualRowIdMap
		const visualRowIdMap = new Map<string, number>();
		visualRows.forEach((row, idx) => {
			if (row) {
				visualRowIdMap.set(row.id, idx);
			}
		});

		return {
			visualRows,
			visualRowIdMap,
		};
	}
}

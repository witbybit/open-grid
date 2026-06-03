import { RowNode, type ColumnDef, type VisualRow } from '../store.js';
import type { SortModel, FilterModel } from '../rowModel.js';
import { applyClientSortAndFilter } from '../rowModel.js';
import { createRowPipelineContext } from './pipelineContext.js';
import { groupStage } from './stages/groupStage.js';
import { treeStage } from './stages/treeStage.js';
import { sortTreeStage } from './stages/sortTreeStage.js';
import { aggregateStage, type AggregationDef } from './stages/aggregateStage.js';
import { flattenStage } from './stages/flattenStage.js';
import type { RowTreeNode } from './stages/types.js';
import { toDataVisualRowId } from './visualRowIds.js';

export interface GroupDef<TData = unknown> {
	colId: string;
	keyCreator?: (params: { value: unknown; row: TData; rowId: string }) => string;
	comparator?: (a: unknown, b: unknown) => number;
}

export interface RowModelConfig<TData = unknown> {
	type: 'client' | 'server';
	grouping?: {
		model: GroupDef<TData>[];
		defaultExpanded?: boolean;
		expandedGroupIds?: Record<string, true>;
		includeFooter?: boolean;
	};
	treeData?: {
		enabled: boolean;
		getParentId: (row: TData) => string | null | undefined;
		defaultExpanded?: boolean;
		expandedRowIds?: Record<string, true>;
		filterMode?: 'strict' | 'includeAncestors' | 'includeDescendants';
	};
	masterDetail?: {
		enabled: boolean;
		expandedRowIds?: Record<string, true>;
		getDetailHeight?: (params: { row: TData; rowId: string }) => number;
		defaultDetailHeight?: number;
	};
}

export interface RowPipelineInput<TData = unknown> {
	nodes: RowNode<TData>[];
	columns: ColumnDef<TData>[];
	sortModel: SortModel | null;
	filterModel: FilterModel | null;

	// Tree / Group / Detail configs
	groupBy?: string[];
	rowModelConfig?: RowModelConfig<TData>;
	getParentId?: (data: TData) => string | null | undefined;
	aggDefs?: AggregationDef<TData>[];
	expandedGroupIds: Set<string>;
	expandedTreeRowIds?: Set<string>;
	expandedDetailRowIds: Set<string>;

	// Heights
	defaultRowHeight: number;
	rowHeightsRecord: Record<string, number>;
	groupRowHeight?: number;
	detailRowHeight?: number;
	getDetailHeight?: (params: { row: TData; rowId: string }) => number;
	masterDetailEnabled?: boolean;
	detailRenderer?: unknown;
}

export interface RowPipelineOutput<TData = unknown> {
	visualRows: VisualRow<TData>[];
	visualRowIdToIndex: Map<string, number>;
	rowIdToVisualIndex: Map<string, number>;
	rowIdToVisualRowId: Map<string, string>;
	rowIdToVisualRowIds?: Map<string, string[]>;
	version: number;
	stats: {
		totalDataRows: number;
		totalVisualRows: number;
		groupCount: number;
		detailRowCount: number;
		loadingRowCount: number;
	};
}

export type RowPipelineResult<TData = unknown> = RowPipelineOutput<TData>;

export class RowPipeline<TData = unknown> {
	private version = 0;

	public run(input: RowPipelineInput<TData>): RowPipelineOutput<TData> {
		const {
			nodes,
			columns,
			sortModel,
			filterModel,
			groupBy,
			rowModelConfig,
			getParentId,
			aggDefs = [],
			expandedGroupIds,
			expandedTreeRowIds = new Set<string>(),
			expandedDetailRowIds,
			defaultRowHeight,
			rowHeightsRecord,
			groupRowHeight,
			detailRowHeight,
			getDetailHeight,
			masterDetailEnabled,
			detailRenderer,
		} = input;

		const groupingConfig = rowModelConfig?.grouping;
		const treeConfig = rowModelConfig?.treeData?.enabled ? rowModelConfig.treeData : undefined;
		const detailConfig = rowModelConfig?.masterDetail;
		const groupDefs: GroupDef<TData>[] = groupingConfig?.model ?? (groupBy ?? []).map((colId) => ({ colId }));
		const effectiveGetParentId = treeConfig?.getParentId ?? getParentId;
		const context = createRowPipelineContext(columns, {
			groups: new Set([...expandedGroupIds, ...Object.keys(groupingConfig?.expandedGroupIds ?? {})]),
			treeRows: new Set([...expandedTreeRowIds, ...Object.keys(treeConfig?.expandedRowIds ?? {})]),
			details: new Set([...expandedDetailRowIds, ...Object.keys(detailConfig?.expandedRowIds ?? {})]),
		});

		let roots: RowTreeNode<TData>[] | null = null;
		let visualRows: VisualRow<TData>[] | null = null;

		if (groupDefs.length > 0) {
			const filteredWrappers = applyClientSortAndFilter(nodes, columns, null, filterModel);
			const filteredNodes = filteredWrappers.map((w) => w.node);
			roots = groupStage(filteredNodes, groupDefs, context);
		} else if (effectiveGetParentId) {
			const treeRoots = treeStage(nodes, effectiveGetParentId);
			roots = this.filterTree(treeRoots, columns, filterModel, treeConfig?.filterMode ?? 'includeAncestors');
		} else {
			const filteredNodes = applyClientSortAndFilter(nodes, columns, sortModel, filterModel).map((w) => w.node);
			if (!detailConfig?.enabled && !masterDetailEnabled && aggDefs.length === 0) {
				visualRows = filteredNodes.map((node) => {
					const explicitHeight = rowHeightsRecord[node.id];
					return {
						kind: 'data',
						id: toDataVisualRowId(node.id),
						rowId: node.id,
						node,
						depth: 0,
						height: explicitHeight !== undefined ? explicitHeight : defaultRowHeight,
						selectable: true,
						editable: true,
					};
				});
			} else {
				roots = filteredNodes.map((node) => ({
					kind: 'data',
					rowId: node.id,
					node,
					depth: 0,
				}));
			}
		}

		if (roots && (groupDefs.length > 0 || effectiveGetParentId) && sortModel && sortModel.length > 0) {
			sortTreeStage(roots, sortModel, columns);
		}

		if (roots && aggDefs && aggDefs.length > 0) {
			aggregateStage(roots, aggDefs, context);
		}

		visualRows ??= flattenStage(roots ?? [], {
			expandedGroupIds: context.expansion.groups,
			expandedTreeRowIds: context.expansion.treeRows,
			expandedDetailRowIds: context.expansion.details,
			defaultRowHeight,
			rowHeightsRecord,
			groupRowHeight,
			detailRowHeight: detailConfig?.defaultDetailHeight ?? detailRowHeight,
			getDetailHeight: detailConfig?.getDetailHeight ?? getDetailHeight,
			masterDetailEnabled: detailConfig?.enabled ?? masterDetailEnabled,
			detailRenderer,
			defaultGroupsExpanded: groupingConfig?.defaultExpanded,
			defaultTreeRowsExpanded: treeConfig?.defaultExpanded,
			includeFooter: groupingConfig?.includeFooter,
		});

		const visualRowIdToIndex = new Map<string, number>();
		const rowIdToVisualIndex = new Map<string, number>();
		const rowIdToVisualRowId = new Map<string, string>();
		let rowIdToVisualRowIds: Map<string, string[]> | undefined;
		let groupCount = 0;
		let detailRowCount = 0;
		let loadingRowCount = 0;
		visualRows.forEach((row, idx) => {
			visualRowIdToIndex.set(row.id, idx);
			if (row.kind === 'data') {
				if (!rowIdToVisualIndex.has(row.rowId)) {
					rowIdToVisualIndex.set(row.rowId, idx);
					rowIdToVisualRowId.set(row.rowId, row.id);
				}
			} else if (row.kind === 'detail') {
				rowIdToVisualRowIds ??= new Map<string, string[]>();
				const parentRowId = row.parentRowId ?? row.parentId;
				const ids = rowIdToVisualRowIds.get(parentRowId) ?? [];
				const dataVisualRowId = rowIdToVisualRowId.get(parentRowId);
				if (ids.length === 0 && dataVisualRowId) {
					ids.push(dataVisualRowId);
				}
				ids.push(row.id);
				rowIdToVisualRowIds.set(parentRowId, ids);
				detailRowCount++;
			} else if (row.kind === 'group') {
				groupCount++;
			} else if (row.kind === 'loading') {
				loadingRowCount++;
			}
		});

		return {
			visualRows,
			visualRowIdToIndex,
			rowIdToVisualIndex,
			rowIdToVisualRowId,
			rowIdToVisualRowIds,
			version: ++this.version,
			stats: {
				totalDataRows: nodes.length,
				totalVisualRows: visualRows.length,
				groupCount,
				detailRowCount,
				loadingRowCount,
			},
		};
	}

	private filterTree<TData>(
		roots: RowTreeNode<TData>[],
		columns: ColumnDef<TData>[],
		filterModel: FilterModel | null,
		filterMode: 'strict' | 'includeAncestors' | 'includeDescendants'
	): RowTreeNode<TData>[] {
		if (!filterModel || Object.keys(filterModel).length === 0) return roots;
		const matchingIds = new Set(
			applyClientSortAndFilter(
				roots.flatMap((root) => collectDataNodes(root)),
				columns,
				null,
				filterModel
			).map((w) => w.node.id)
		);
		const includeNode = (node: RowTreeNode<TData>): RowTreeNode<TData> | null => {
			if (node.kind !== 'data') return node;
			const children = (node.children ?? []).map(includeNode).filter((child): child is RowTreeNode<TData> => !!child);
			const selfMatches = matchingIds.has(node.rowId);
			const keep = filterMode === 'strict' ? selfMatches : selfMatches || children.length > 0;
			if (!keep) return null;
			if (filterMode === 'includeDescendants' && selfMatches) {
				return node;
			}
			return { ...node, children: children.length > 0 ? children : undefined };
		};
		return roots.map(includeNode).filter((node): node is RowTreeNode<TData> => !!node);
	}
}

function collectDataNodes<TData>(root: RowTreeNode<TData>): RowNode<TData>[] {
	if (root.kind === 'data') {
		return [root.node, ...(root.children ?? []).flatMap((child) => collectDataNodes(child))];
	}
	return root.children.flatMap((child) => collectDataNodes(child));
}

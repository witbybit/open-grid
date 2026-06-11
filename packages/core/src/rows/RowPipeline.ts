import { RowNode, type ColumnDef, type VisualRow } from '../store.js';
import type { SortModel, FilterModel, GroupRowMeta } from '../rowModel.js';
import { applyClientFilterOnly, applyClientSortAndFilter } from '../rowModel.js';
import { createRowPipelineContext } from './pipelineContext.js';
import { groupStage } from './stages/groupStage.js';
import { treeStage } from './stages/treeStage.js';
import { sortTreeStage } from './stages/sortTreeStage.js';
import { aggregateStage, type AggregationDef } from './stages/aggregateStage.js';
import { flattenStage } from './stages/flattenStage.js';
import type { RowTreeNode } from './stages/types.js';
import { toDataVisualRowId, toGroupVisualRowId } from './visualRowIds.js';

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
	/** Maps each expanded group row's visual index → its last descendant's visual index. */
	stickyGroupMeta: Map<number, number>;
	/** Rich metadata for each group row, keyed by groupId. */
	groupMeta: Map<string, GroupRowMeta>;
	/** Rich metadata for each group row, keyed by visual index. */
	groupMetaByVisualIndex: Map<number, GroupRowMeta>;
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
			const filteredNodes = applyClientFilterOnly(nodes, columns, filterModel);
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

		const stickyGroupMeta = new Map<number, number>();
		visualRows ??= flattenStage(
			roots ?? [],
			{
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
			},
			stickyGroupMeta
		);

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

		const { byId: groupMeta, byVisualIndex: groupMetaByVisualIndex } = computeGroupMeta(visualRows);

		return {
			visualRows,
			visualRowIdToIndex,
			rowIdToVisualIndex,
			rowIdToVisualRowId,
			rowIdToVisualRowIds,
			stickyGroupMeta,
			groupMeta,
			groupMetaByVisualIndex,
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

	public collectAllGroupIds(input: Pick<RowPipelineInput<TData>, 'nodes' | 'columns' | 'groupBy' | 'rowModelConfig' | 'filterModel'>): string[] {
		const { nodes, columns, groupBy, rowModelConfig, filterModel } = input;
		const groupingConfig = rowModelConfig?.grouping;
		const groupDefs: GroupDef<TData>[] = groupingConfig?.model ?? (groupBy ?? []).map((colId) => ({ colId }));
		if (groupDefs.length === 0) return [];
		const filteredNodes = applyClientFilterOnly(nodes, columns, filterModel);
		const context = createRowPipelineContext(columns, { groups: new Set(), treeRows: new Set(), details: new Set() });
		const roots = groupStage(filteredNodes, groupDefs, context);
		const ids: string[] = [];
		const collect = (nodes: RowTreeNode<TData>[]) => {
			for (const node of nodes) {
				if (node.kind === 'group') {
					ids.push(toGroupVisualRowId(node.path));
					collect(node.children);
				}
			}
		};
		collect(roots);
		return ids;
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

function computeGroupMeta<TData>(visualRows: VisualRow<TData>[]): {
	byId: Map<string, GroupRowMeta>;
	byVisualIndex: Map<number, GroupRowMeta>;
} {
	const byId = new Map<string, GroupRowMeta>();
	const byVisualIndex = new Map<number, GroupRowMeta>();
	const stack: GroupRowMeta[] = [];

	for (let i = 0; i < visualRows.length; i++) {
		const row = visualRows[i];
		if (row.kind === 'group') {
			// Close groups on the stack that are at same or deeper depth than this new group.
			while (stack.length > 0 && stack[stack.length - 1].depth >= row.depth) {
				const closing = stack.pop()!;
				if (closing.firstChildIndex !== -1) closing.lastChildIndex = i - 1;
			}
			const parentGroupId = stack.length > 0 ? stack[stack.length - 1].groupId : null;
			const meta: GroupRowMeta = {
				groupId: row.groupId,
				visualIndex: i,
				depth: row.depth,
				parentGroupId,
				firstChildIndex: row.expanded ? i + 1 : -1,
				lastChildIndex: row.expanded ? visualRows.length - 1 : -1,
				firstLeafIndex: -1,
				lastLeafIndex: -1,
				visibleDescendantRowIds: [],
				childGroupIds: [],
				leafCount: row.leafCount ?? 0,
				childCount: row.childCount ?? 0,
				expanded: row.expanded,
				aggregateValues: row.aggregateValues,
			};
			if (parentGroupId !== null) byId.get(parentGroupId)?.childGroupIds.push(row.groupId);
			byId.set(row.groupId, meta);
			byVisualIndex.set(i, meta);
			if (row.expanded) stack.push(meta);
		} else if (row.kind === 'data') {
			for (const group of stack) {
				group.visibleDescendantRowIds.push(row.rowId);
				if (group.firstLeafIndex === -1) group.firstLeafIndex = i;
				group.lastLeafIndex = i;
			}
		}
	}
	// Close any groups still open at end of list.
	while (stack.length > 0) {
		const closing = stack.pop()!;
		if (closing.firstChildIndex !== -1) closing.lastChildIndex = visualRows.length - 1;
	}

	return { byId, byVisualIndex };
}

function collectDataNodes<TData>(root: RowTreeNode<TData>): RowNode<TData>[] {
	if (root.kind === 'data') {
		return [root.node, ...(root.children ?? []).flatMap((child) => collectDataNodes(child))];
	}
	return root.children.flatMap((child) => collectDataNodes(child));
}

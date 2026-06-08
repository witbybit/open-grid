import type { VisualRow } from '../../store.js';
import { toDataVisualRowId, toDetailVisualRowId, toFooterVisualRowId } from '../visualRowIds.js';
import type { RowTreeNode } from './types.js';

export interface FlattenConfig<TData = unknown> {
	expandedGroupIds: Set<string>;
	expandedTreeRowIds: Set<string>;
	expandedDetailRowIds: Set<string>;
	defaultRowHeight: number;
	rowHeightsRecord: Record<string, number>;
	groupRowHeight?: number;
	detailRowHeight?: number;
	getDetailHeight?: (params: { row: TData; rowId: string }) => number;
	masterDetailEnabled?: boolean;
	detailRenderer?: unknown;
	defaultGroupsExpanded?: boolean;
	defaultTreeRowsExpanded?: boolean;
	includeFooter?: boolean;
}

export function flattenStage<TData>(
	roots: RowTreeNode<TData>[],
	config: FlattenConfig<TData>,
	stickyGroupMeta?: Map<number, number>
): VisualRow<TData>[] {
	const result: VisualRow<TData>[] = [];

	for (const root of roots) {
		flattenNodeRecursively(root, config, result, stickyGroupMeta);
	}

	return result;
}

function flattenNodeRecursively<TData>(
	node: RowTreeNode<TData>,
	config: FlattenConfig<TData>,
	result: VisualRow<TData>[],
	stickyGroupMeta?: Map<number, number>
): void {
	if (node.kind === 'data') {
		const rowId = node.node.id;
		const explicitHeight = config.rowHeightsRecord[rowId];
		const height = explicitHeight !== undefined ? explicitHeight : config.defaultRowHeight;

		result.push({
			kind: 'data',
			id: toDataVisualRowId(rowId),
			rowId,
			node: node.node,
			depth: node.depth,
			height,
			selectable: true,
			editable: true,
		});

		const isExpandedTreeRow = config.defaultTreeRowsExpanded || config.expandedTreeRowIds.has(rowId);
		if (node.children?.length && isExpandedTreeRow) {
			for (const child of node.children) {
				flattenNodeRecursively(child, config, result, stickyGroupMeta);
			}
		}

		if (config.masterDetailEnabled && config.expandedDetailRowIds.has(rowId)) {
			const dHeight = config.getDetailHeight?.({ row: node.node.data, rowId }) ?? config.detailRowHeight ?? 200;
			result.push({
				kind: 'detail',
				id: toDetailVisualRowId(rowId),
				parentId: rowId,
				parentRowId: rowId,
				depth: node.depth + 1,
				height: dHeight,
				render: config.detailRenderer,
			});
		}
		return;
	}

	const isExpanded = config.defaultGroupsExpanded || config.expandedGroupIds.has(node.id);
	const groupHeight = config.groupRowHeight || config.defaultRowHeight;
	const groupRowIdx = result.length;

	result.push({
		kind: 'group',
		id: node.id,
		groupId: node.id,
		key: node.key,
		keyString: node.keyString,
		field: node.field,
		path: node.path,
		depth: node.depth,
		expanded: isExpanded,
		childCount: node.childCount,
		leafCount: node.leafCount,
		aggregateValues: node.aggregateValues,
		aggregate: node.aggregateValues,
		height: groupHeight,
		selectable: false,
	});

	if (isExpanded) {
		for (const child of node.children) {
			flattenNodeRecursively(child, config, result, stickyGroupMeta);
		}

		// Record sticky boundary using the last content descendant (before the footer).
		// This ensures the group stops being sticky when its last data row scrolls off,
		// not when the footer itself scrolls off — preventing header+footer overlap at the top.
		if (stickyGroupMeta && result.length > groupRowIdx + 1) {
			stickyGroupMeta.set(groupRowIdx, result.length - 1);
		}

		// Only add footer for leaf groups (children are data rows, not nested groups).
		// This prevents duplicate subtotals at every nesting level.
		if (config.includeFooter) {
			const hasGroupChildren = node.children.some((c) => c.kind === 'group');
			if (!hasGroupChildren) {
				result.push({
					kind: 'footer',
					id: toFooterVisualRowId(node.id),
					parentGroupId: node.id,
					depth: node.depth,
					aggregateValues: node.aggregateValues,
					aggregate: node.aggregateValues,
					height: groupHeight,
				});
			}
		}
	}
}

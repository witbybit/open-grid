import type { VisualRow } from '../../store.js';
import type { RowTreeNode } from './types.js';
import { formatVisualDetailId } from '../../ids.js';

export interface FlattenConfig {
	expandedGroupIds: Set<string>;
	expandedDetailRowIds: Set<string>;
	defaultRowHeight: number;
	rowHeightsRecord: Record<string, number>;
	groupRowHeight?: number;
	detailRowHeight?: number;
	masterDetailEnabled?: boolean;
	detailRenderer?: unknown;
}

export function flattenStage<TData>(roots: RowTreeNode<TData>[], config: FlattenConfig): VisualRow<TData>[] {
	const result: VisualRow<TData>[] = [];

	for (const root of roots) {
		flattenNodeRecursively(root, config, result);
	}

	return result;
}

function flattenNodeRecursively<TData>(node: RowTreeNode<TData>, config: FlattenConfig, result: VisualRow<TData>[]): void {
	if (node.kind === 'leaf') {
		const rowId = node.node.id;
		const explicitHeight = config.rowHeightsRecord[rowId];
		const height = explicitHeight !== undefined ? explicitHeight : config.defaultRowHeight;

		const hasChildren = !!node.children && node.children.length > 0;
		const isExpanded = hasChildren && config.expandedGroupIds.has(rowId);

		result.push({
			kind: 'data',
			id: rowId,
			rowId,
			node: node.node,
			depth: node.depth,
			height,
			hasChildren,
			expanded: isExpanded,
			childCount: node.childCount,
		});

		// If master detail is enabled and this data row's detail view is expanded, inject detail row!
		if (config.masterDetailEnabled && config.expandedDetailRowIds.has(rowId)) {
			const detailId = formatVisualDetailId(rowId);
			const dHeight = config.detailRowHeight || 200; // default detail height
			result.push({
				kind: 'detail',
				id: detailId,
				parentId: rowId,
				rowId,
				depth: node.depth + 1,
				height: dHeight,
				render: config.detailRenderer,
			});
		}

		// Recursively flatten tree data children if expanded
		if (hasChildren && isExpanded && node.children) {
			for (const child of node.children) {
				flattenNodeRecursively(child, config, result);
			}
		}
		return;
	}

	// For group nodes:
	const isExpanded = config.expandedGroupIds.has(node.id);
	const groupHeight = config.groupRowHeight || config.defaultRowHeight;

	result.push({
		kind: 'group',
		id: node.id,
		key: node.key,
		field: node.field,
		depth: node.depth,
		expanded: isExpanded,
		childCount: node.childCount,
		aggregate: node.aggregateValues,
		height: groupHeight,
	});

	if (isExpanded) {
		for (const child of node.children) {
			flattenNodeRecursively(child, config, result);
		}
	}
}

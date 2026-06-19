import { GridEventName } from '../api/GridEvents.js';
import type { AggregationDef } from '../rows/stages/aggregateStage.js';
import type { InvalidationManager } from '../renderer/invalidationManager.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import type { RowModel, RowModelRefreshResult } from '../rowModel.js';

export interface GroupingFeatureControllerDeps<TRowData = unknown> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	invalidation: InvalidationManager;
	requestRender?: (reason: string) => void;
}

export class GroupingFeatureController<TRowData = unknown> {
	private readonly ctx: GridFeatureContext<TRowData>;
	private readonly getRowModel: () => RowModel<TRowData> | null;
	private readonly invalidation: InvalidationManager;
	private readonly requestRender: (reason: string) => void;

	constructor(deps: GroupingFeatureControllerDeps<TRowData>) {
		this.ctx = deps.ctx;
		this.getRowModel = deps.getRowModel;
		this.invalidation = deps.invalidation;
		this.requestRender = deps.requestRender ?? (() => {});
	}

	public applyRowModelRefreshInvalidation(result: RowModelRefreshResult | void, reason: 'group expansion' | 'detail', groupId?: string): void {
		if (!result?.changed) return;

		const targetGroupId = result.groupId ?? groupId;
		if (targetGroupId) {
			this.invalidation.invalidateGroup(targetGroupId, reason);
		}
		if (result.changedStartIndex !== undefined && result.changedEndIndex !== undefined) {
			this.invalidation.invalidateRowRange(result.changedStartIndex, result.changedEndIndex, reason);
		}
		if (result.previousRowCount !== result.nextRowCount) {
			this.invalidation.invalidateGeometry(reason);
		}
		this.invalidation.invalidateViewport(reason);
		this.requestRender(reason);
	}

	public setGroupBy(colIds: string[]): void {
		const state = this.ctx.getState();
		const newExpansion = { ...state.expansion, groups: {} as Record<string, true> };
		this.ctx.applyChange({
			reason: 'grouping:set-group-by',
			state: { groupBy: colIds, expansion: newExpansion },
			invalidations: [
				{ kind: 'geometry', reason: 'groupBy' },
				{ kind: 'viewport', reason: 'groupBy' },
				{ kind: 'headers', reason: 'groupBy' },
				{ kind: 'overlay', reason: 'groupBy' },
			],
			domains: ['rows'],
			events: [{ type: GridEventName.groupByChanged, payload: { groupBy: colIds } }],
		});
	}

	public addGroupBy(colId: string, atIndex?: number): void {
		const current = this.ctx.getState().groupBy ?? [];
		if (current.includes(colId)) return;
		const next = [...current];
		const insertAt = atIndex !== undefined ? Math.max(0, Math.min(next.length, atIndex)) : next.length;
		next.splice(insertAt, 0, colId);

		const state = this.ctx.getState();
		const newExpansion = { ...state.expansion, groups: {} as Record<string, true> };
		this.ctx.applyChange({
			reason: 'grouping:add-group-by',
			state: { groupBy: next, expansion: newExpansion },
			invalidations: [
				{ kind: 'geometry', reason: 'groupBy' },
				{ kind: 'viewport', reason: 'groupBy' },
				{ kind: 'headers', reason: 'groupBy' },
				{ kind: 'overlay', reason: 'groupBy' },
			],
			domains: ['rows'],
			events: [
				{ type: GridEventName.groupByChanged, payload: { groupBy: next } },
				{ type: GridEventName.groupColumnAdded, payload: { colId, index: insertAt, groupBy: next } },
			],
		});
	}

	public removeGroupBy(colId: string): void {
		const current = this.ctx.getState().groupBy ?? [];
		if (!current.includes(colId)) return;
		const next = current.filter((id) => id !== colId);

		const state = this.ctx.getState();
		const newExpansion = { ...state.expansion, groups: {} as Record<string, true> };
		this.ctx.applyChange({
			reason: 'grouping:remove-group-by',
			state: { groupBy: next, expansion: newExpansion },
			invalidations: [
				{ kind: 'geometry', reason: 'groupBy' },
				{ kind: 'viewport', reason: 'groupBy' },
				{ kind: 'headers', reason: 'groupBy' },
				{ kind: 'overlay', reason: 'groupBy' },
			],
			domains: ['rows'],
			events: [
				{ type: GridEventName.groupByChanged, payload: { groupBy: next } },
				{ type: GridEventName.groupColumnRemoved, payload: { colId, groupBy: next } },
			],
		});
	}

	public moveGroupBy(colId: string, toIndex: number): void {
		const current = this.ctx.getState().groupBy ?? [];
		const fromIndex = current.indexOf(colId);
		if (fromIndex === -1) return;
		const next = [...current];
		next.splice(fromIndex, 1);
		const boundedTo = Math.max(0, Math.min(next.length, toIndex));
		next.splice(boundedTo, 0, colId);
		if (boundedTo === fromIndex) return;

		const state = this.ctx.getState();
		const newExpansion = { ...state.expansion, groups: {} as Record<string, true> };
		this.ctx.applyChange({
			reason: 'grouping:move-group-by',
			state: { groupBy: next, expansion: newExpansion },
			invalidations: [
				{ kind: 'geometry', reason: 'groupBy' },
				{ kind: 'viewport', reason: 'groupBy' },
				{ kind: 'headers', reason: 'groupBy' },
				{ kind: 'overlay', reason: 'groupBy' },
			],
			domains: ['rows'],
			events: [
				{ type: GridEventName.groupByChanged, payload: { groupBy: next } },
				{ type: GridEventName.groupColumnMoved, payload: { colId, fromIndex, toIndex: boundedTo, groupBy: next } },
			],
		});
	}

	public setAggDefs(defs: AggregationDef<TRowData>[]): void {
		this.ctx.applyChange({
			reason: 'grouping:set-agg-defs',
			state: { aggDefs: defs },
			invalidations: [{ kind: 'viewport' }, { kind: 'overlay' }],
			domains: ['rows'],
			events: [{ type: GridEventName.aggDefsChanged, payload: { aggDefs: defs } }],
		});
	}

	public setShowGroupFooter(enabled: boolean): void {
		this.ctx.applyChange({
			reason: 'grouping:set-footer',
			state: { showGroupFooter: enabled },
			invalidations: [
				{ kind: 'geometry', reason: 'showGroupFooter' },
				{ kind: 'viewport', reason: 'showGroupFooter' },
				{ kind: 'overlay', reason: 'showGroupFooter' },
			],
			domains: ['rows', 'geometry'],
			events: [{ type: GridEventName.showGroupFooterChanged, payload: { showGroupFooter: enabled } }],
		});
	}

	public setStickyGroupRows(enabled: boolean): void {
		this.ctx.applyChange({
			reason: 'grouping:set-sticky-rows',
			state: { enableStickyGroupRows: enabled },
			invalidations: [{ kind: 'viewport', reason: 'enableStickyGroupRows' }],
			domains: ['rows'],
			events: [{ type: GridEventName.enableStickyGroupRowsChanged, payload: { enableStickyGroupRows: enabled } }],
		});
	}

	public setShowGroupPanel(enabled: boolean): void {
		this.ctx.applyChange({
			reason: 'grouping:set-panel',
			state: { showGroupPanel: enabled },
			invalidations: [
				{ kind: 'geometry', reason: 'showGroupPanel' },
				{ kind: 'viewport', reason: 'showGroupPanel' },
				{ kind: 'headers', reason: 'showGroupPanel' },
			],
			domains: ['geometry'],
		});
	}

	public expandAllGroups(): void {
		this.applyRowModelRefreshInvalidation(this.getRowModel()?.expandAllGroups?.(), 'group expansion');
	}

	public collapseAllGroups(): void {
		this.applyRowModelRefreshInvalidation(this.getRowModel()?.collapseAllGroups?.(), 'group expansion');
	}

	public toggleGroupExpanded(groupId: string): void {
		this.applyRowModelRefreshInvalidation(this.getRowModel()?.toggleGroupExpanded?.(groupId), 'group expansion', groupId);
	}

	public toggleDetailExpanded(rowId: string): void {
		this.applyRowModelRefreshInvalidation(this.getRowModel()?.toggleDetailExpanded?.(rowId), 'detail');
	}
}

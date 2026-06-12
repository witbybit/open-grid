import { GridEventName } from '../store.js';
import type { RowModel, RowModelRefreshResult } from '../store.js';
import type { AggregationDef } from '../rows/stages/aggregateStage.js';
import type { GridFeatureContext } from './GridFeatureContext.js';

export class GroupingFeatureController<TRowData = unknown> {
	constructor(
		private readonly ctx: GridFeatureContext<TRowData>,
		private readonly getRowModel: () => RowModel<TRowData> | null
	) {}

	// ─── private helpers ──────────────────────────────────────────────────────

	public applyRowModelRefreshInvalidation(result: RowModelRefreshResult | void, reason: 'group expansion' | 'detail', groupId?: string): void {
		if (!result?.changed) return;

		const targetGroupId = result.groupId ?? groupId;
		if (targetGroupId) {
			this.ctx.invalidation.invalidateGroup(targetGroupId, reason);
		}
		if (result.changedStartIndex !== undefined && result.changedEndIndex !== undefined) {
			this.ctx.invalidation.invalidateRowRange(result.changedStartIndex, result.changedEndIndex, reason);
		}
		if (result.previousRowCount !== result.nextRowCount) {
			this.ctx.invalidation.invalidateGeometry(reason);
		}
		this.ctx.invalidation.invalidateViewport(reason);
	}

	// ─── public API ───────────────────────────────────────────────────────────

	public setGroupBy(colIds: string[]): void {
		const state = this.ctx.stateManager.getState();
		const newExpansion = { ...state.expansion, groups: {} as Record<string, true> };
		this.ctx.changeApplier.apply({
			reason: 'groupBy',
			state: { groupBy: colIds, expansion: newExpansion },
			invalidations: [
				{ kind: 'geometry', reason: 'groupBy' },
				{ kind: 'viewport', reason: 'groupBy' },
				{ kind: 'headers', reason: 'groupBy' },
				{ kind: 'overlay', reason: 'groupBy' },
			],
		});
	}

	public addGroupBy(colId: string, atIndex?: number): void {
		const current = this.ctx.stateManager.getState().groupBy ?? [];
		if (current.includes(colId)) return;
		const next = [...current];
		const insertAt = atIndex !== undefined ? Math.max(0, Math.min(next.length, atIndex)) : next.length;
		next.splice(insertAt, 0, colId);
		this.setGroupBy(next);
		this.ctx.eventBus.dispatchEvent(GridEventName.groupColumnAdded, { colId, index: insertAt, groupBy: next });
	}

	public removeGroupBy(colId: string): void {
		const current = this.ctx.stateManager.getState().groupBy ?? [];
		if (!current.includes(colId)) return;
		const next = current.filter((id) => id !== colId);
		this.setGroupBy(next);
		this.ctx.eventBus.dispatchEvent(GridEventName.groupColumnRemoved, { colId, groupBy: next });
	}

	public moveGroupBy(colId: string, toIndex: number): void {
		const current = this.ctx.stateManager.getState().groupBy ?? [];
		const fromIndex = current.indexOf(colId);
		if (fromIndex === -1) return;
		const next = [...current];
		next.splice(fromIndex, 1);
		const boundedTo = Math.max(0, Math.min(next.length, toIndex));
		next.splice(boundedTo, 0, colId);
		if (boundedTo === fromIndex) return;
		this.setGroupBy(next);
		this.ctx.eventBus.dispatchEvent(GridEventName.groupColumnMoved, { colId, fromIndex, toIndex: boundedTo, groupBy: next });
	}

	public setAggDefs(defs: AggregationDef<TRowData>[]): void {
		this.ctx.changeApplier.apply({
			reason: 'aggDefs',
			state: { aggDefs: defs },
			invalidations: [{ kind: 'viewport' }, { kind: 'overlay' }],
		});
	}

	public setShowGroupFooter(enabled: boolean): void {
		this.ctx.stateManager.setState({ showGroupFooter: enabled });
		this.ctx.invalidation.invalidateGeometry('showGroupFooter');
		this.ctx.invalidation.invalidateViewport('showGroupFooter');
		this.ctx.invalidation.invalidateOverlay('showGroupFooter');
		this.ctx.requestRender('showGroupFooter');
	}

	public setStickyGroupRows(enabled: boolean): void {
		this.ctx.stateManager.setState({ enableStickyGroupRows: enabled });
		this.ctx.invalidation.invalidateViewport('enableStickyGroupRows');
		this.ctx.requestRender('enableStickyGroupRows');
	}

	public setShowGroupPanel(enabled: boolean): void {
		this.ctx.stateManager.setState({ showGroupPanel: enabled });
		this.ctx.requestRender('showGroupPanel');
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

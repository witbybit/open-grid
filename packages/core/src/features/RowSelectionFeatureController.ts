import { isDataCellSelectable, GridEventName } from '../store.js';
import type { RowModel, RowSelectionGesture, RowSelectionGestureSource, RowSelectionChangeResult } from '../store.js';
import type { GridFeatureContext } from './GridFeatureContext.js';

export class RowSelectionFeatureController<TRowData = unknown> {
	constructor(
		private readonly ctx: GridFeatureContext<TRowData>,
		private readonly getRowModel: () => RowModel<TRowData> | null
	) {}

	private getAllSelectableDataRowIds(): string[] {
		const allIds: string[] = [];
		const rowModel = this.getRowModel();
		if (!rowModel) return allIds;
		const count = rowModel.getVisualRowCount();
		for (let i = 0; i < count; i++) {
			const vr = rowModel.getVisualRow(i);
			if (vr?.kind === 'data') allIds.push(vr.rowId);
		}
		return allIds;
	}

	private isDataCellSelectable(rowId: string, colField: string): boolean {
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return isDataCellSelectable(visualRow, this.ctx.columns.getColumnDef(colField));
	}

	private reduceRowSelection(gesture: RowSelectionGesture): RowSelectionChangeResult | null {
		const current = this.ctx.getState();
		const currentSet = new Set(current.selectedRowIds);
		const rowIds = gesture.rowIds ?? [];
		let newIds: string[];

		switch (gesture.kind) {
			case 'replace': {
				const nextSet = new Set(rowIds);
				newIds = [...nextSet];
				break;
			}
			case 'select': {
				rowIds.forEach((id) => currentSet.add(id));
				newIds = [...currentSet];
				break;
			}
			case 'deselect': {
				const toRemove = new Set(rowIds);
				newIds = current.selectedRowIds.filter((id) => !toRemove.has(id));
				break;
			}
			case 'toggle': {
				const id = rowIds[0];
				if (!id) return null;
				if (currentSet.has(id)) currentSet.delete(id);
				else currentSet.add(id);
				newIds = [...currentSet];
				break;
			}
			case 'selectAll': {
				newIds = this.getAllSelectableDataRowIds();
				break;
			}
			case 'clear': {
				newIds = [];
				break;
			}
			default:
				return null;
		}

		const prevSet = new Set(current.selectedRowIds);
		const newSet = new Set(newIds);
		const addedRowIds = newIds.filter((id) => !prevSet.has(id));
		const removedRowIds = current.selectedRowIds.filter((id) => !newSet.has(id));
		const changedRowIds = addedRowIds.concat(removedRowIds);
		if (changedRowIds.length === 0) return null;

		return {
			selectedRowIds: newIds,
			changedRowIds,
			addedRowIds,
			removedRowIds,
			source: gesture.source ?? 'api',
		};
	}

	public applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null {
		const result = this.reduceRowSelection(gesture);
		if (!result) return null;

		this.ctx.applyChange({
			reason: 'selection:rows',
			state: { selectedRowIds: result.selectedRowIds },
			invalidations: [
				...result.changedRowIds.map((rowId) => ({ kind: 'row' as const, rowId, reason: 'selection' })),
				{ kind: 'headers', reason: 'selection' },
			],
			events: [{ type: GridEventName.rowSelectionChanged, payload: result as never }],
		});
		return result;
	}

	public selectRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'select', rowIds, source });
	}

	public deselectRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'deselect', rowIds, source });
	}

	public toggleRowId(rowId: string, source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'toggle', rowIds: [rowId], source });
	}

	public selectAllDataRows(source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'selectAll', source });
	}

	public clearRowSelection(source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'clear', source });
	}
}

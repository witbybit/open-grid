import { canEditCell, GridEventName } from '../store.js';
import type { RowModel } from '../store.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import type { DataModel } from '../models/DataModel.js';

export interface EditingFeatureControllerDeps<TRowData = unknown> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	data: DataModel<TRowData>;
	/**
	 * Called after a cell value is changed to notify subscribers.
	 * Maps to GridEngine.notifyCellChange.
	 */
	notifyCellChange: (rowId: string, colField: string) => void;
	/**
	 * Apply a cell value mutation.
	 * Maps to GridEngine.setCellValue (with undoable=false for rollback case).
	 */
	setCellValue: (rowId: string, colField: string, value: unknown, undoable?: boolean) => void;
}

export class EditingFeatureController<TRowData = unknown> {
	private readonly ctx: GridFeatureContext<TRowData>;
	private readonly getRowModel: () => RowModel<TRowData> | null;
	private readonly data: DataModel<TRowData>;
	private readonly notifyCellChange: (rowId: string, colField: string) => void;
	private readonly setCellValue: (rowId: string, colField: string, value: unknown, undoable?: boolean) => void;

	constructor(deps: EditingFeatureControllerDeps<TRowData>) {
		this.ctx = deps.ctx;
		this.getRowModel = deps.getRowModel;
		this.data = deps.data;
		this.notifyCellChange = deps.notifyCellChange;
		this.setCellValue = deps.setCellValue;
	}

	// ─── private helpers ──────────────────────────────────────────────────────

	private canEditCell(rowId: string, colField: string): boolean {
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return canEditCell(visualRow, this.ctx.columns.getColumnDef(colField));
	}

	// ─── public API ───────────────────────────────────────────────────────────

	public startEdit(rowId: string, colField: string): void {
		if (!this.canEditCell(rowId, colField)) return;
		this.ctx.stateManager.setState({ activeEdit: { rowId, colField } });
		this.ctx.invalidation.invalidateCell(rowId, colField, 'edit started');
		this.ctx.invalidation.invalidateOverlay('edit started');
		this.notifyCellChange(rowId, colField);
		this.ctx.eventBus.dispatchEvent(GridEventName.editStarted, { rowId, colField });
		this.ctx.requestRender('edit started');
	}

	public stopEdit(cancel = false): void {
		const activeEdit = this.ctx.stateManager.getState().activeEdit;
		if (!activeEdit) return;

		const { rowId, colField } = activeEdit;
		this.ctx.stateManager.setState({ activeEdit: null });
		this.ctx.invalidation.invalidateCell(rowId, colField, 'edit stopped');
		this.ctx.invalidation.invalidateOverlay('edit stopped');
		this.notifyCellChange(rowId, colField);
		this.ctx.eventBus.dispatchEvent(GridEventName.editStopped, { rowId, colField, cancel });
		this.ctx.requestRender('edit stopped');
	}

	public async commitEdit(rowId: string, colField: string, value: unknown): Promise<boolean> {
		const col = this.ctx.columns.getColumnDef(colField);
		const oldValue = this.data.getRawCellValue(rowId, colField);
		const node = this.getRowModel()?.getRowNodeById(rowId);
		const row = node?.data ?? ({} as TRowData);

		// Step 1: validate
		if (col?.valueValidator) {
			let error: string | null = null;
			try {
				error = await col.valueValidator({ value, oldValue, row, colField });
			} catch {
				error = 'Validation failed';
			}
			if (error) {
				const activeEdit = this.ctx.stateManager.getState().activeEdit;
				if (activeEdit?.rowId === rowId && activeEdit?.colField === colField) {
					this.ctx.stateManager.setState({ activeEdit: { ...activeEdit, validationError: error } });
					this.notifyCellChange(rowId, colField);
				}
				return false;
			}
		}

		// Step 2: optimistic update
		this.setCellValue(rowId, colField, value);

		// Step 3: async valueSetter (server-side confirm)
		if (col?.valueSetter) {
			let didAbort = false;
			const abort = () => {
				didAbort = true;
			};
			let success = true;
			try {
				success = await col.valueSetter({ value, oldValue, row, colField, abort });
			} catch {
				success = false;
			}
			if (!success || didAbort) {
				// Roll back the optimistic update
				this.setCellValue(rowId, colField, oldValue, false);
				const activeEdit = this.ctx.stateManager.getState().activeEdit;
				if (activeEdit?.rowId === rowId && activeEdit?.colField === colField) {
					this.ctx.stateManager.setState({ activeEdit: { ...activeEdit, validationError: 'Save failed' } });
					this.notifyCellChange(rowId, colField);
				}
				return false;
			}
		}

		// Step 4: close the editor
		this.stopEdit(false);
		return true;
	}
}

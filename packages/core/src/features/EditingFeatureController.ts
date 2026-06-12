import { canEditCell, GridEventName } from '../store.js';
import type { RowModel } from '../store.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import type { DataModel } from '../models/DataModel.js';

export interface EditingFeatureControllerDeps<TRowData = unknown> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	data: DataModel<TRowData>;
	notifyCellChange: (rowId: string, colField: string) => void;
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

	private canEditCell(rowId: string, colField: string): boolean {
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return canEditCell(visualRow, this.ctx.columns.getColumnDef(colField));
	}

	public startEdit(rowId: string, colField: string): void {
		if (!this.canEditCell(rowId, colField)) return;
		this.ctx.applyChange({
			reason: 'editing:start',
			state: { activeEdit: { rowId, colField } },
			invalidations: [
				{ kind: 'cell', rowId, colId: colField, reason: 'edit started' },
				{ kind: 'overlay', reason: 'edit started' },
			],
			events: [{ type: GridEventName.editStarted, payload: { rowId, colField } as never }],
		});
		this.notifyCellChange(rowId, colField);
	}

	public stopEdit(cancel = false): void {
		const activeEdit = this.ctx.getState().activeEdit;
		if (!activeEdit) return;

		const { rowId, colField } = activeEdit;
		this.ctx.applyChange({
			reason: 'editing:stop',
			state: { activeEdit: null },
			invalidations: [
				{ kind: 'cell', rowId, colId: colField, reason: 'edit stopped' },
				{ kind: 'overlay', reason: 'edit stopped' },
			],
			events: [{ type: GridEventName.editStopped, payload: { rowId, colField, cancel } as never }],
		});
		this.notifyCellChange(rowId, colField);
	}

	public async commitEdit(rowId: string, colField: string, value: unknown): Promise<boolean> {
		const col = this.ctx.columns.getColumnDef(colField);
		const oldValue = this.data.getRawCellValue(rowId, colField);
		const node = this.getRowModel()?.getRowNodeById(rowId);
		const row = node?.data ?? ({} as TRowData);

		if (col?.valueValidator) {
			let error: string | null = null;
			try {
				error = await col.valueValidator({ value, oldValue, row, colField });
			} catch {
				error = 'Validation failed';
			}
			if (error) {
				const activeEdit = this.ctx.getState().activeEdit;
				if (activeEdit?.rowId === rowId && activeEdit?.colField === colField) {
					this.ctx.applyChange({
						reason: 'editing:validation',
						state: { activeEdit: { ...activeEdit, validationError: error } },
						requestRender: false,
					});
					this.notifyCellChange(rowId, colField);
				}
				return false;
			}
		}

		this.setCellValue(rowId, colField, value);

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
				this.setCellValue(rowId, colField, oldValue, false);
				const activeEdit = this.ctx.getState().activeEdit;
				if (activeEdit?.rowId === rowId && activeEdit?.colField === colField) {
					this.ctx.applyChange({
						reason: 'editing:save-failed',
						state: { activeEdit: { ...activeEdit, validationError: 'Save failed' } },
						requestRender: false,
					});
					this.notifyCellChange(rowId, colField);
				}
				return false;
			}
		}

		this.stopEdit(false);
		return true;
	}
}

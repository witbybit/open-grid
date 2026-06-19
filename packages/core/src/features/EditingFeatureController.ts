import { GridEventName } from '../api/GridEvents.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import type { DataModel } from '../models/DataModel.js';
import type { RowModel } from '../rowModel.js';
import { canEditCell } from '../visualRow.js';
import type { CellValueChangeOptions, CellValueChangeResult } from './DataMutationController.js';
import { createCellValueMutationHistory } from '../engine/GridDomainMutation.js';
import type { GridHistoryEntry } from '../engine/GridChangeApplier.js';

export interface EditingFeatureControllerDeps<TRowData = unknown> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	data: DataModel<TRowData>;
	notifyCellChange: (rowId: string, colField: string) => void;
	applyCellValueChange: (rowId: string, colField: string, value: unknown, options?: CellValueChangeOptions) => CellValueChangeResult;
	registerHistory: (history: GridHistoryEntry<TRowData>) => void;
	/** Called when an edit commits successfully — removes any persistent validation error for the cell. */
	clearValidationError?: (rowId: string, colField: string) => void;
	/** Called when an edit fails validation — persists the error indicator even after the editor closes. */
	setValidationError?: (rowId: string, colField: string, error: string) => void;
	/** Runs full validation (column + row) after the new value has been written to the data model. */
	validateCellPostCommit?: (rowId: string, colField: string) => Promise<void>;
}

export class EditingFeatureController<TRowData = unknown> {
	private readonly ctx: GridFeatureContext<TRowData>;
	private readonly getRowModel: () => RowModel<TRowData> | null;
	private readonly data: DataModel<TRowData>;
	private readonly notifyCellChange: (rowId: string, colField: string) => void;
	private readonly applyCellValueChange: (
		rowId: string,
		colField: string,
		value: unknown,
		options?: CellValueChangeOptions
	) => CellValueChangeResult;
	private readonly registerHistory: (history: GridHistoryEntry<TRowData>) => void;
	private readonly clearValidationError?: (rowId: string, colField: string) => void;
	private readonly setValidationError?: (rowId: string, colField: string, error: string) => void;
	private readonly validateCellPostCommit?: (rowId: string, colField: string) => Promise<void>;

	constructor(deps: EditingFeatureControllerDeps<TRowData>) {
		this.ctx = deps.ctx;
		this.getRowModel = deps.getRowModel;
		this.data = deps.data;
		this.notifyCellChange = deps.notifyCellChange;
		this.applyCellValueChange = deps.applyCellValueChange;
		this.registerHistory = deps.registerHistory;
		this.clearValidationError = deps.clearValidationError;
		this.setValidationError = deps.setValidationError;
		this.validateCellPostCommit = deps.validateCellPostCommit;
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
			domains: ['editing'],
			events: [{ type: GridEventName.editStarted, payload: { rowId, colField } }],
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
			domains: ['editing'],
			events: [{ type: GridEventName.editStopped, payload: { rowId, colField, cancel } }],
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
						invalidations: [
							{ kind: 'cell', rowId, colId: colField, reason: 'edit stopped' },
							{ kind: 'overlay', reason: 'edit stopped' },
						],
					});
					this.notifyCellChange(rowId, colField);
				}
				// Persist the error so the red-border indicator survives after the editor closes
				this.setValidationError?.(rowId, colField, error);
				return false;
			}
		}

		const writeResult = this.applyCellValueChange(rowId, colField, value, {
			undoable: false,
			source: 'edit',
		});

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
				if (writeResult.applied) {
					this.applyCellValueChange(rowId, colField, oldValue, { undoable: false, source: 'edit' });
				}
				const activeEdit = this.ctx.getState().activeEdit;
				if (activeEdit?.rowId === rowId && activeEdit?.colField === colField) {
					this.ctx.applyChange({
						reason: 'editing:save-failed',
						state: { activeEdit: { ...activeEdit, validationError: 'Save failed' } },
						invalidations: [
							{ kind: 'cell', rowId, colId: colField, reason: 'edit stopped' },
							{ kind: 'overlay', reason: 'edit stopped' },
						],
					});
					this.notifyCellChange(rowId, colField);
				}
				return false;
			}
		}

		if (writeResult.applied) {
			this.registerHistory(createCellValueMutationHistory('data:set-cell-value', rowId, colField, oldValue, value));
		}

		this.stopEdit(false);
		// Run full validation (column + row) against the committed value, or just clear if no validator.
		if (this.validateCellPostCommit) {
			await this.validateCellPostCommit(rowId, colField);
		} else {
			this.clearValidationError?.(rowId, colField);
		}
		return true;
	}
}

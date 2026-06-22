import { GridEventName } from '../api/GridEvents.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import type { DataModel } from '../models/DataModel.js';
import type { RowModel } from '../rowModel.js';

export interface ValidationManagerDeps<TRowData = unknown> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	data: DataModel<TRowData>;
}

export function validationKey(rowId: string, colField: string): string {
	return `${rowId}:${colField}`;
}

export class ValidationManager<TRowData = unknown> {
	private readonly ctx: GridFeatureContext<TRowData>;
	private readonly getRowModel: () => RowModel<TRowData> | null;
	private readonly data: DataModel<TRowData>;

	constructor(deps: ValidationManagerDeps<TRowData>) {
		this.ctx = deps.ctx;
		this.getRowModel = deps.getRowModel;
		this.data = deps.data;
	}

	/** Run the column's valueValidator with the cell's current value. Updates state on failure. */
	public async validateCell(rowId: string, colField: string): Promise<string | null> {
		const col = this.ctx.columns.getColumnDef(colField);
		const rowModel = this.getRowModel();
		const node = rowModel?.getRowNodeById(rowId) ?? null;
		const row = node?.data ?? ({} as TRowData);

		let colError: string | null = null;
		if (col?.valueValidator) {
			const value = this.data.getRawCellValue(rowId, colField);
			try {
				colError = await col.valueValidator({ value, oldValue: value, row, colField });
			} catch {
				colError = 'Validation failed';
			}
			this._setCellError(rowId, colField, colError ?? null);
		}

		return colError ?? null;
	}

	/** Internal: set or clear an error for one cell and fire the event. */
	public _setCellError(rowId: string, colField: string, error: string | null): void {
		const state = this.ctx.getState();
		const key = validationKey(rowId, colField);
		const existing = state.validationErrors ?? {};
		const currentError = existing[key] ?? null;

		if (currentError === error) return; // no change

		const nextErrors = { ...existing };
		if (error) {
			nextErrors[key] = error;
		} else {
			delete nextErrors[key];
		}

		this.ctx.applyChange({
			reason: 'validation:cell',
			state: { validationErrors: nextErrors },
			invalidations: [{ kind: 'cell', rowId, colId: colField, reason: 'validation' }],
			events: [
				{
					type: GridEventName.cellValidationChanged,
					payload: { rowId, colField, error },
				},
			],
		});
	}
}

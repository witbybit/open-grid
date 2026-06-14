import { GridEventName } from '../store.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import type { DataModel } from '../models/DataModel.js';
import type { RowModel } from '../rowModel.js';

export interface CellValidationError {
	rowId: string;
	colField: string;
	error: string;
}

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
		if (!col?.valueValidator) return null;

		const rowModel = this.getRowModel();
		const node = rowModel?.getRowNodeById(rowId) ?? null;
		const row = node?.data ?? ({} as TRowData);
		const value = this.data.getRawCellValue(rowId, colField);

		let error: string | null = null;
		try {
			error = await col.valueValidator({ value, oldValue: value, row, colField });
		} catch {
			error = 'Validation failed';
		}

		this._setCellError(rowId, colField, error ?? null);
		return error ?? null;
	}

	/** Run all column validators across all data rows. Returns the list of failures. */
	public async validateGrid(): Promise<CellValidationError[]> {
		const rowModel = this.getRowModel();
		if (!rowModel) return [];

		// Read columns from state (source of truth for all columns), but resolve validators
		// through getColumnDef which is the same path validateCell uses.
		const colFields = this.ctx.getState().columns.map((c) => c.field);
		const validatableCols = colFields.map((f) => this.ctx.columns.getColumnDef(f)).filter((c): c is NonNullable<typeof c> => !!c?.valueValidator);
		if (validatableCols.length === 0) return [];

		// Collect all validation promises
		const tasks: Array<Promise<{ rowId: string; colField: string; error: string | null }>> = [];

		const state = this.ctx.getState();
		const rowCount = rowModel.getVisualRowCount();
		for (let i = 0; i < rowCount; i++) {
			const vr = rowModel.getVisualRow(i);
			if (!vr || vr.kind !== 'data') continue;
			const node = vr.node;
			const row = node.data ?? ({} as TRowData);

			for (const col of validatableCols) {
				const colField = col.field;
				const value = this.data.getRawCellValue(node.id, colField);
				tasks.push(
					(async () => {
						let error: string | null = null;
						try {
							error = await col.valueValidator!({ value, oldValue: value, row, colField });
						} catch {
							error = 'Validation failed';
						}
						return { rowId: node.id, colField, error: error ?? null };
					})()
				);
			}
		}

		const results = await Promise.all(tasks);

		// Build new sparse errors map from scratch (replace previous validation pass)
		const nextErrors: Record<string, string> = {};
		const failures: CellValidationError[] = [];

		// Preserve errors that were set outside this grid-level pass (cell-level api.validateCell)
		// — don't wipe them; only update the cells we just validated.
		const existingErrors = state.validationErrors ?? {};
		const validatedKeys = new Set<string>();
		for (const col of validatableCols) {
			// we'll overwrite all keys for validated columns; gather which cells we touched
			for (let i = 0; i < rowCount; i++) {
				const vr = rowModel.getVisualRow(i);
				if (!vr || vr.kind !== 'data') continue;
				validatedKeys.add(validationKey(vr.node.id, col.field));
			}
		}

		// Start from existing, remove re-validated keys, then re-add failures
		for (const [k, v] of Object.entries(existingErrors)) {
			if (!validatedKeys.has(k)) nextErrors[k] = v;
		}
		for (const r of results) {
			if (r.error) {
				nextErrors[validationKey(r.rowId, r.colField)] = r.error;
				failures.push({ rowId: r.rowId, colField: r.colField, error: r.error });
			}
		}

		const invalidations: Array<{ kind: 'cell'; rowId: string; colId: string; reason: string }> = [];
		for (const k of validatedKeys) {
			const [rowId, colField] = k.split(':');
			invalidations.push({ kind: 'cell', rowId, colId: colField, reason: 'validation' });
		}

		this.ctx.applyChange({
			reason: 'validation:grid',
			state: { validationErrors: nextErrors },
			invalidations,
			events: [
				{
					type: GridEventName.gridValidated,
					payload: { errors: failures, hasErrors: failures.length > 0 } as never,
				},
			],
		});

		return failures;
	}

	/** Clear a single cell's validation error. */
	public clearCellValidationError(rowId: string, colField: string): void {
		this._setCellError(rowId, colField, null);
	}

	/** Clear all validation errors on the grid. */
	public clearValidationErrors(): void {
		const state = this.ctx.getState();
		if (!state.validationErrors || Object.keys(state.validationErrors).length === 0) return;

		const invalidations: Array<{ kind: 'cell'; rowId: string; colId: string; reason: string }> = [];
		for (const key of Object.keys(state.validationErrors)) {
			const colonIdx = key.indexOf(':');
			if (colonIdx === -1) continue;
			const rowId = key.slice(0, colonIdx);
			const colField = key.slice(colonIdx + 1);
			invalidations.push({ kind: 'cell', rowId, colId: colField, reason: 'validation-clear' });
		}

		this.ctx.applyChange({
			reason: 'validation:clear-all',
			state: { validationErrors: {} },
			invalidations,
		});
	}

	/** Get the current validation error for a cell, or null if none. */
	public getCellValidationError(rowId: string, colField: string): string | null {
		const errors = this.ctx.getState().validationErrors;
		return errors?.[validationKey(rowId, colField)] ?? null;
	}

	/** Returns true if any cell currently has a validation error. */
	public hasValidationErrors(): boolean {
		const errors = this.ctx.getState().validationErrors;
		return !!errors && Object.keys(errors).length > 0;
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
					payload: { rowId, colField, error } as never,
				},
			],
		});
	}
}

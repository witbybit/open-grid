import { GridEventName } from '../store.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import type { DataModel } from '../models/DataModel.js';
import type { RowModel } from '../rowModel.js';

export interface CellValidationError {
	rowId: string;
	colField: string;
	error: string;
}

/** Parameters passed to a grid-level row validator. */
export interface RowValidatorParams<TRowData = unknown> {
	/** Current row data snapshot. */
	row: TRowData;
	/**
	 * Which column triggered this validation call (set during single-cell validation,
	 * undefined during a full grid validateGrid() sweep).
	 */
	changedColField?: string;
}

/**
 * Grid-level cross-field validator. Return a map of colField → error string (or null/empty
 * to clear a row-level error for that field). Runs after per-column valueValidators so it can
 * override or supplement them.
 */
export type RowValidator<TRowData = unknown> = (
	params: RowValidatorParams<TRowData>
) => Record<string, string | null> | Promise<Record<string, string | null>>;

export interface ValidationManagerDeps<TRowData = unknown> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	data: DataModel<TRowData>;
	rowValidator?: RowValidator<TRowData>;
}

export function validationKey(rowId: string, colField: string): string {
	return `${rowId}:${colField}`;
}

export class ValidationManager<TRowData = unknown> {
	private readonly ctx: GridFeatureContext<TRowData>;
	private readonly getRowModel: () => RowModel<TRowData> | null;
	private readonly data: DataModel<TRowData>;
	private readonly rowValidator?: RowValidator<TRowData>;

	constructor(deps: ValidationManagerDeps<TRowData>) {
		this.ctx = deps.ctx;
		this.getRowModel = deps.getRowModel;
		this.data = deps.data;
		this.rowValidator = deps.rowValidator;
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

		// Run grid-level row validator — may set/clear errors on any field in the row.
		if (this.rowValidator) {
			let rowErrors: Record<string, string | null> = {};
			try {
				rowErrors = await this.rowValidator({ row, changedColField: colField });
			} catch {
				// row validator exceptions don't block the column error result
			}
			for (const [field, err] of Object.entries(rowErrors)) {
				// If the column validator already flagged this cell, keep that error;
				// otherwise apply the row validator result (including clearing stale errors).
				if (field === colField && colError !== null) continue;
				this._setCellError(rowId, field, err ?? null);
			}
		}

		return colError ?? null;
	}

	/** Run all column validators across all data rows. Returns the list of failures. */
	public async validateGrid(): Promise<CellValidationError[]> {
		const rowModel = this.getRowModel();
		if (!rowModel) return [];

		const colFields = this.ctx.getState().columns.map((c) => c.field);
		const validatableCols = colFields.map((f) => this.ctx.columns.getColumnDef(f)).filter((c): c is NonNullable<typeof c> => !!c?.valueValidator);

		const state = this.ctx.getState();
		const rowCount = rowModel.getVisualRowCount();

		// ── Column validators ────────────────────────────────────────────────────
		const colTasks: Array<Promise<{ rowId: string; colField: string; error: string | null }>> = [];
		for (let i = 0; i < rowCount; i++) {
			const vr = rowModel.getVisualRow(i);
			if (!vr || vr.kind !== 'data') continue;
			const node = vr.node;
			const row = node.data ?? ({} as TRowData);

			for (const col of validatableCols) {
				const colField = col.field;
				const value = this.data.getRawCellValue(node.id, colField);
				colTasks.push(
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

		const colResults = await Promise.all(colTasks);

		// Build sparse errors map — preserve cell-level errors from outside this pass.
		const existingErrors = state.validationErrors ?? {};
		const validatedKeys = new Set<string>();
		for (const col of validatableCols) {
			for (let i = 0; i < rowCount; i++) {
				const vr = rowModel.getVisualRow(i);
				if (!vr || vr.kind !== 'data') continue;
				validatedKeys.add(validationKey(vr.node.id, col.field));
			}
		}
		const nextErrors: Record<string, string> = {};
		for (const [k, v] of Object.entries(existingErrors)) {
			if (!validatedKeys.has(k)) nextErrors[k] = v;
		}
		for (const r of colResults) {
			if (r.error) nextErrors[validationKey(r.rowId, r.colField)] = r.error;
		}

		// ── Row validator (cross-field rules) ────────────────────────────────────
		if (this.rowValidator) {
			const rowTasks: Array<Promise<{ rowId: string; errors: Record<string, string | null> }>> = [];
			for (let i = 0; i < rowCount; i++) {
				const vr = rowModel.getVisualRow(i);
				if (!vr || vr.kind !== 'data') continue;
				const node = vr.node;
				const row = node.data ?? ({} as TRowData);
				rowTasks.push(
					(async () => {
						let errors: Record<string, string | null> = {};
						try {
							errors = await this.rowValidator!({ row, changedColField: undefined });
						} catch {
							// row validator exceptions don't block column results
						}
						return { rowId: node.id, errors };
					})()
				);
			}
			const rowResults = await Promise.all(rowTasks);
			for (const { rowId, errors } of rowResults) {
				for (const [field, err] of Object.entries(errors)) {
					const key = validationKey(rowId, field);
					if (err) {
						nextErrors[key] = err;
						validatedKeys.add(key);
					} else {
						// null/empty = row validator clears this field's error
						delete nextErrors[key];
						validatedKeys.add(key);
					}
				}
			}
		}

		// ── Build final failures list and fire state change ───────────────────────
		const failures: CellValidationError[] = [];
		for (const [key, err] of Object.entries(nextErrors)) {
			const colonIdx = key.lastIndexOf(':');
			if (colonIdx === -1) continue;
			failures.push({ rowId: key.slice(0, colonIdx), colField: key.slice(colonIdx + 1), error: err });
		}

		const invalidations: Array<{ kind: 'cell'; rowId: string; colId: string; reason: string }> = [];
		for (const k of validatedKeys) {
			const colonIdx = k.indexOf(':');
			if (colonIdx === -1) continue;
			invalidations.push({ kind: 'cell', rowId: k.slice(0, colonIdx), colId: k.slice(colonIdx + 1), reason: 'validation' });
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

	/** Set a validation error on a cell from an external source (e.g. server response, external form library). */
	public setCellValidationError(rowId: string, colField: string, error: string): void {
		this._setCellError(rowId, colField, error);
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
			const colonIdx = key.lastIndexOf(':');
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

	/** Returns all current validation errors without re-running validation. */
	public getAllValidationErrors(): CellValidationError[] {
		const errors = this.ctx.getState().validationErrors ?? {};
		return Object.entries(errors).map(([key, error]) => {
			const colonIdx = key.lastIndexOf(':');
			return { rowId: key.slice(0, colonIdx), colField: key.slice(colonIdx + 1), error };
		});
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

import type { GridApi } from '../../../api/GridApi.js';
import type { GridFeatureContext } from '../../GridFeatureContext.js';
import type { DataModel } from '../../../models/DataModel.js';
import type { RowModel } from '../../../rowModel.js';
import type {
	GridIntegrityIssue,
	GridIntegrityModule,
	GridIntegrityRunContext,
	GridValidationIntegrityOptions,
	GridCellIntegrityRule,
	GridRowIntegrityRule,
} from '../integrityTypes.js';
import { GridEventName } from '../../../api/GridEvents.js';

let _seq = 0;
function nextIssueId(): string {
	return `vi-${++_seq}`;
}

export interface ValidationModuleDeps<TRowData> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	data: DataModel<TRowData>;
	getApi: () => GridApi<TRowData>;
	requestRepaint: (cells?: Array<{ rowId: string; colField: string }>) => void;
}

export class ValidationIntegrityModule<TRowData> implements GridIntegrityModule<TRowData> {
	public readonly id = 'validation' as const;

	private options: GridValidationIntegrityOptions<TRowData>;
	private issues: GridIntegrityIssue[] = [];

	// Cell-level error index for inline display: `rowId:colField` → issue
	private readonly cellErrorIndex = new Map<string, GridIntegrityIssue>();

	constructor(
		options: GridValidationIntegrityOptions<TRowData>,
		private readonly deps: ValidationModuleDeps<TRowData>
	) {
		this.options = options;
	}

	isEnabled(): boolean {
		return this.options.enabled !== false;
	}

	getIssues(): readonly GridIntegrityIssue[] {
		return this.issues;
	}

	getCellError(rowId: string, colField: string): GridIntegrityIssue | null {
		return this.cellErrorIndex.get(`${rowId}:${colField}`) ?? null;
	}

	getDiagnostics(): unknown {
		return {
			enabled: this.isEnabled(),
			totalIssues: this.issues.length,
			blockingIssues: this.issues.filter((i) => i.blocking).length,
			options: {
				validateOnEdit: this.options.validateOnEdit ?? true,
				validateOnSubmit: this.options.validateOnSubmit ?? true,
				cellRules: this.options.cellRules?.length ?? 0,
				rowRules: this.options.rowRules?.length ?? 0,
			},
		};
	}

	// ── Module run (batch) ────────────────────────────────────────────────────

	async run(context: GridIntegrityRunContext<TRowData>): Promise<readonly GridIntegrityIssue[]> {
		if (!this.isEnabled()) return _EMPTY;

		const cellRules = this.options.cellRules ?? [];
		const rowRules = this.options.rowRules ?? [];
		const api = this.deps.getApi();
		const newIssues: GridIntegrityIssue[] = [];

		for (const ref of context.rows) {
			const { rowId, row } = ref;

			// Cell rules
			for (const rule of cellRules) {
				if (!_fieldInColumns(rule.field, context.columns)) continue;
				const rawValue = this.deps.data.getRawCellValue(rowId, rule.field);
				let result: import('../integrityTypes.js').GridIntegrityRuleResult | null = null;
				try {
					result = await rule.validate({ rowId, row, field: rule.field, value: rawValue, api });
				} catch {
					result = { message: `Rule "${rule.id}" threw an error` };
				}
				if (result) {
					newIssues.push(_makeCellIssue(rule, rowId, rule.field, rawValue, result));
				}
			}

			// Row rules
			for (const rule of rowRules) {
				let result: import('../integrityTypes.js').GridIntegrityRuleResult | null = null;
				try {
					result = await rule.validate({ rowId, row, api });
				} catch {
					result = { message: `Rule "${rule.id}" threw an error` };
				}
				if (result) {
					const fields = result.fields ?? [];
					newIssues.push(_makeRowIssue(rule, rowId, fields, result));
					// Also index cell-level for multi-field rules
					for (const field of fields) {
						const cellIssue = _makeCellIssue(
							{ id: `${rule.id}:${field}`, field, severity: rule.severity ?? 'error', blocking: rule.blocking ?? true },
							rowId,
							field,
							undefined,
							result
						);
						newIssues.push(cellIssue);
					}
				}
			}
		}

		this._applyIssues(newIssues);
		return newIssues;
	}

	// ── Single-cell validation (triggered by edit) ───────────────────────────

	async validateCell(rowId: string, colField: string): Promise<readonly GridIntegrityIssue[]> {
		if (!this.isEnabled()) return _EMPTY;

		const cellRules = (this.options.cellRules ?? []).filter((r) => r.field === colField);
		const api = this.deps.getApi();
		const rowModel = this.deps.getRowModel();
		const node = rowModel?.getRowNodeById?.(rowId) ?? null;
		const row = (node?.data ?? {}) as TRowData;
		const rawValue = this.deps.data.getRawCellValue(rowId, colField);
		const newIssues: GridIntegrityIssue[] = [];

		for (const rule of cellRules) {
			let result: import('../integrityTypes.js').GridIntegrityRuleResult | null = null;
			try {
				result = await rule.validate({ rowId, row, field: colField, value: rawValue, api });
			} catch {
				result = { message: `Rule "${rule.id}" threw an error` };
			}
			if (result) {
				newIssues.push(_makeCellIssue(rule, rowId, colField, rawValue, result));
			}
		}

		// Row rules that touch this field
		const rowRules = (this.options.rowRules ?? []).filter((r) => true); // run all; filter by affected fields after
		for (const rule of rowRules) {
			let result: import('../integrityTypes.js').GridIntegrityRuleResult | null = null;
			try {
				result = await rule.validate({ rowId, row, api });
			} catch {
				result = null;
			}
			if (result) {
				const fields = result.fields ?? [];
				if (fields.includes(colField) || fields.length === 0) {
					newIssues.push(_makeRowIssue(rule, rowId, fields, result));
					for (const f of fields) {
						if (
							!newIssues.some((i) => i.colField === f && i.rowId === rowId && i.source === 'validation' && i.type === 'rowValidation')
						) {
							newIssues.push(
								_makeCellIssue(
									{ id: `${rule.id}:${f}`, field: f, severity: rule.severity ?? 'error', blocking: rule.blocking ?? true },
									rowId,
									f,
									undefined,
									result
								)
							);
						}
					}
				}
			}
		}

		// Merge with existing issues (replace for this cell)
		const keyToRemove = new Set([`${rowId}:${colField}`]);
		const retained = this.issues.filter((i) => !_issueKeyMatches(i, rowId, colField, keyToRemove));
		this._applyIssues([...retained, ...newIssues], false);

		// Fire event
		this.deps.ctx.applyChange({
			reason: 'integrity:validation:cell',
			state: {},
			invalidations: [{ kind: 'cell', rowId, colId: colField, reason: 'integrity-validation' }],
			events:
				newIssues.length > 0
					? [{ type: GridEventName.cellValidationChanged, payload: { rowId, colField, error: newIssues[0]?.message ?? null } }]
					: [],
		});

		this.deps.requestRepaint([{ rowId, colField }]);
		return newIssues;
	}

	// ── Single-row validation ─────────────────────────────────────────────────

	async validateRow(rowId: string): Promise<readonly GridIntegrityIssue[]> {
		if (!this.isEnabled()) return _EMPTY;

		const api = this.deps.getApi();
		const rowModel = this.deps.getRowModel();
		const node = rowModel?.getRowNodeById?.(rowId) ?? null;
		if (!node) return _EMPTY;

		const row = (node.data ?? {}) as TRowData;
		const newIssues: GridIntegrityIssue[] = [];
		const state = this.deps.ctx.getState();

		for (const rule of this.options.cellRules ?? []) {
			if (!_fieldInColumns(rule.field, state.columns)) continue;
			const rawValue = this.deps.data.getRawCellValue(rowId, rule.field);
			let result: import('../integrityTypes.js').GridIntegrityRuleResult | null = null;
			try {
				result = await rule.validate({ rowId, row, field: rule.field, value: rawValue, api });
			} catch {
				result = { message: `Rule "${rule.id}" threw an error` };
			}
			if (result) newIssues.push(_makeCellIssue(rule, rowId, rule.field, rawValue, result));
		}

		for (const rule of this.options.rowRules ?? []) {
			let result: import('../integrityTypes.js').GridIntegrityRuleResult | null = null;
			try {
				result = await rule.validate({ rowId, row, api });
			} catch {
				result = null;
			}
			if (result) {
				const fields = result.fields ?? [];
				newIssues.push(_makeRowIssue(rule, rowId, fields, result));
				for (const f of fields) {
					newIssues.push(
						_makeCellIssue(
							{ id: `${rule.id}:${f}`, field: f, severity: rule.severity ?? 'error', blocking: rule.blocking ?? true },
							rowId,
							f,
							undefined,
							result
						)
					);
				}
			}
		}

		// Merge: replace issues for this row
		const retained = this.issues.filter((i) => i.rowId !== rowId);
		this._applyIssues([...retained, ...newIssues], false);
		this.deps.requestRepaint();
		return newIssues;
	}

	// ── External (server) validation ──────────────────────────────────────────

	publishServerValidationError(rowId: string, colField: string, message: string): void {
		const issue: GridIntegrityIssue = {
			id: nextIssueId(),
			source: 'serverValidation',
			type: 'serverRejected',
			severity: 'error',
			blocking: true,
			rowId,
			colField,
			message,
			createdAt: _now(),
		};
		const retained = this.issues.filter((i) => !(i.source === 'serverValidation' && i.rowId === rowId && i.colField === colField));
		this._applyIssues([...retained, issue], false);
		this.deps.ctx.applyChange({
			reason: 'integrity:serverValidation',
			state: {},
			invalidations: [{ kind: 'cell', rowId, colId: colField, reason: 'server-validation' }],
		});
		this.deps.requestRepaint([{ rowId, colField }]);
	}

	// ── Inline error display helper ───────────────────────────────────────────

	getCellErrorMessage(rowId: string, colField: string): string | null {
		return this.cellErrorIndex.get(`${rowId}:${colField}`)?.message ?? null;
	}

	// ── Internal ──────────────────────────────────────────────────────────────

	private _applyIssues(issues: GridIntegrityIssue[], rebuildState = true): void {
		this.issues = issues;
		this.cellErrorIndex.clear();
		for (const issue of issues) {
			if (issue.rowId && issue.colField) {
				this.cellErrorIndex.set(`${issue.rowId}:${issue.colField}`, issue);
			}
		}
		if (rebuildState) {
			this.deps.ctx.applyChange({
				reason: 'integrity:validation:batch',
				state: {},
				invalidations: [],
			});
		}
	}

	destroy(): void {
		this.issues = [];
		this.cellErrorIndex.clear();
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _makeCellIssue(
	rule: { id: string; field: string; severity?: import('../integrityTypes.js').GridIntegritySeverity; blocking?: boolean },
	rowId: string,
	colField: string,
	value: unknown,
	result: import('../integrityTypes.js').GridIntegrityRuleResult
): GridIntegrityIssue {
	const sev = rule.severity ?? 'error';
	return {
		id: nextIssueId(),
		source: 'validation',
		type: 'invalidValue',
		severity: sev,
		blocking: rule.blocking ?? sev === 'error',
		rowId,
		colField,
		message: result.message,
		value,
		createdAt: _now(),
		data: result.data,
	};
}

function _makeRowIssue(
	rule: { id: string; severity?: import('../integrityTypes.js').GridIntegritySeverity; blocking?: boolean },
	rowId: string,
	fields: readonly string[],
	result: import('../integrityTypes.js').GridIntegrityRuleResult
): GridIntegrityIssue {
	const sev = rule.severity ?? 'error';
	return {
		id: nextIssueId(),
		source: 'validation',
		type: 'rowValidation',
		severity: sev,
		blocking: rule.blocking ?? sev === 'error',
		rowId,
		colField: fields[0],
		message: result.message,
		createdAt: _now(),
		data: result.data,
	};
}

function _fieldInColumns(field: string, columns: readonly { field?: string }[]): boolean {
	return columns.some((c) => c.field === field);
}

function _issueKeyMatches(issue: GridIntegrityIssue, rowId: string, colField: string, _keys: Set<string>): boolean {
	return issue.rowId === rowId && issue.colField === colField && (issue.source === 'validation' || issue.source === 'serverValidation');
}

function _now(): number {
	// Use performance.now offset to avoid Date.now() flakiness in tests
	return typeof performance !== 'undefined' ? Math.floor(performance.timeOrigin + performance.now()) : 0;
}

const _EMPTY: readonly GridIntegrityIssue[] = [];

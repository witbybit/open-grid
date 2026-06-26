import type { GridApi } from '../../../api/GridApi.js';
import type { GridFeatureContext } from '../../GridFeatureContext.js';
import type { DataModel } from '../../../models/DataModel.js';
import type { RowModel } from '../../../rowModel.js';
import type { GridIntegrityState } from '../../../state/GridState.js';
import type {
	GridIntegrityIssue,
	GridIntegrityModule,
	GridIntegrityRunContext,
	GridValidationIntegrityOptions,
	GridValidateCellProposalParams,
} from '../integrityTypes.js';
import { GridEventName } from '../../../api/GridEvents.js';

function _stableCellIssueId(ruleId: string, rowId: string, field: string): string {
	return `validation:${ruleId}:${rowId}:${field}`;
}

function _stableRowIssueId(ruleId: string, rowId: string): string {
	return `validation:row:${ruleId}:${rowId}`;
}

export interface ValidationModuleDeps<TRowData> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	data: DataModel<TRowData>;
	getApi: () => GridApi<TRowData>;
	getIntegrityState: () => GridIntegrityState<TRowData>;
	requestRepaint: (cells?: Array<{ rowId: string; colField: string }>) => void;
}

export class ValidationIntegrityModule<TRowData> implements GridIntegrityModule<TRowData> {
	public readonly id = 'validation' as const;

	private options: GridValidationIntegrityOptions<TRowData>;

	constructor(
		options: GridValidationIntegrityOptions<TRowData>,
		private readonly deps: ValidationModuleDeps<TRowData>
	) {
		this.options = options;
	}

	isEnabled(): boolean {
		return this.options.enabled !== false;
	}

	shouldAutoValidateWrite(source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo'): boolean {
		if (!this.isEnabled()) return false;
		const validateOnEdit = this.options.validateOnEdit ?? true;
		const validateOnPaste = this.options.validateOnPaste ?? validateOnEdit;
		const validateOnFill = this.options.validateOnFill ?? validateOnEdit;

		switch (source) {
			case 'paste':
				return validateOnPaste;
			case 'fill':
				return validateOnFill;
			case 'api':
			case 'edit':
			case 'undo':
			case 'redo':
				return validateOnEdit;
		}
	}

	getIssues(): readonly GridIntegrityIssue[] {
		return this.deps.getIntegrityState().validation.issues;
	}

	getCellError(rowId: string, colField: string): GridIntegrityIssue | null {
		return this.deps.getIntegrityState().validation.cellErrorIndex[`${rowId}:${colField}`] ?? null;
	}

	getDiagnostics(): unknown {
		const issues = this.getIssues();
		return {
			enabled: this.isEnabled(),
			totalIssues: issues.length,
			blockingIssues: issues.filter((issue) => issue.blocking).length,
			options: {
				validateOnEdit: this.options.validateOnEdit ?? true,
				validateOnSubmit: this.options.validateOnSubmit ?? true,
				cellRules: this.options.cellRules?.length ?? 0,
				rowRules: this.options.rowRules?.length ?? 0,
			},
		};
	}

	async run(context: GridIntegrityRunContext<TRowData>): Promise<readonly GridIntegrityIssue[]> {
		if (!this.isEnabled()) return _EMPTY;

		const cellRules = this.options.cellRules ?? [];
		const rowRules = this.options.rowRules ?? [];
		const api = this.deps.getApi();
		const newIssues: GridIntegrityIssue[] = [];

		for (const ref of context.rows) {
			const { rowId, row } = ref;

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
					for (const field of fields) {
						newIssues.push(
							_makeCellIssue(
								{ id: `${rule.id}:${field}`, field, severity: rule.severity ?? 'error', blocking: rule.blocking ?? true },
								rowId,
								field,
								undefined,
								result
							)
						);
					}
				}
			}
		}

		this._commitIssues('integrity:validation:set-issues', newIssues);
		return newIssues;
	}

	async validateCell(rowId: string, colField: string): Promise<readonly GridIntegrityIssue[]> {
		return this.validateCells([{ rowId, colField }]);
	}

	async validateCells(cells: readonly { rowId: string; colField: string }[]): Promise<readonly GridIntegrityIssue[]> {
		if (!this.isEnabled()) return _EMPTY;
		const uniqueCells = _dedupeCells(cells);
		if (uniqueCells.length === 0) return _EMPTY;

		const issueMap = new Map<string, GridIntegrityIssue>();
		for (const cell of uniqueCells) {
			const issues = await this._collectCellIssues(cell.rowId, cell.colField);
			for (const issue of issues) issueMap.set(issue.id, issue);
		}

		const targetedKeys = new Set(uniqueCells.map((cell) => `${cell.rowId}:${cell.colField}`));
		const retained = this.getIssues().filter((issue) => !targetedKeys.has(`${issue.rowId ?? ''}:${issue.colField ?? ''}`));
		const newIssues = Array.from(issueMap.values());
		this.deps.ctx.applyChange({
			reason: 'integrity:validation:set-issues',
			domainMutations: [{ kind: 'integrity-set-validation-issues', issues: [...retained, ...newIssues] }],
			invalidations: uniqueCells.map((cell) => ({
				kind: 'cell' as const,
				rowId: cell.rowId,
				colId: cell.colField,
				reason: 'integrity-validation',
			})),
			events: uniqueCells.map((cell) => ({
				type: GridEventName.cellValidationChanged as const,
				payload: {
					rowId: cell.rowId,
					colField: cell.colField,
					error: newIssues.find((issue) => issue.rowId === cell.rowId && issue.colField === cell.colField)?.message ?? null,
				},
			})),
		});

		this.deps.requestRepaint(uniqueCells.map((cell) => ({ rowId: cell.rowId, colField: cell.colField })));
		return newIssues;
	}

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
				for (const field of fields) {
					newIssues.push(
						_makeCellIssue(
							{ id: `${rule.id}:${field}`, field, severity: rule.severity ?? 'error', blocking: rule.blocking ?? true },
							rowId,
							field,
							undefined,
							result
						)
					);
				}
			}
		}

		const retained = this.getIssues().filter((issue) => issue.rowId !== rowId);
		this._commitIssues('integrity:validation:set-issues', [...retained, ...newIssues]);
		this.deps.requestRepaint();
		return newIssues;
	}

	async validateCellProposal(params: GridValidateCellProposalParams): Promise<readonly GridIntegrityIssue[]> {
		if (!this.isEnabled()) return _EMPTY;
		const { rowId, colField, proposedValue } = params;

		const cellRules = (this.options.cellRules ?? []).filter((rule) => rule.field === colField);
		const api = this.deps.getApi();
		const rowModel = this.deps.getRowModel();
		const node = rowModel?.getRowNodeById?.(rowId) ?? null;
		const row = (node?.data ?? {}) as TRowData;
		const issues: GridIntegrityIssue[] = [];

		for (const rule of cellRules) {
			let result: import('../integrityTypes.js').GridIntegrityRuleResult | null = null;
			try {
				result = await rule.validate({ rowId, row, field: colField, value: proposedValue, api });
			} catch {
				result = { message: `Rule "${rule.id}" threw an error` };
			}
			if (result) {
				issues.push(_makeCellIssue(rule, rowId, colField, proposedValue, result));
			}
		}

		const rowRules = this.options.rowRules ?? [];
		if (rowRules.length > 0) {
			const draftRow = { ...(row as Record<string, unknown>) };
			draftRow[colField] = proposedValue;
			for (const rule of rowRules) {
				let result: import('../integrityTypes.js').GridIntegrityRuleResult | null = null;
				try {
					result = await rule.validate({ rowId, row: draftRow as TRowData, api });
				} catch {
					result = null;
				}
				if (result) {
					const fields = result.fields ?? [];
					if (fields.includes(colField) || fields.length === 0) {
						issues.push(_makeRowIssue(rule, rowId, fields, result));
					}
				}
			}
		}

		return issues;
	}

	clearIssues(): void {
		this._commitIssues('integrity:validation:set-issues', []);
		this.deps.requestRepaint();
	}

	publishServerValidationError(rowId: string, colField: string, message: string): void {
		const issue: GridIntegrityIssue = {
			id: `validation:server:${rowId}:${colField}`,
			source: 'serverValidation',
			type: 'serverRejected',
			severity: 'error',
			blocking: true,
			rowId,
			colField,
			message,
			createdAt: _now(),
		};
		const retained = this.getIssues().filter(
			(existing) => !(existing.source === 'serverValidation' && existing.rowId === rowId && existing.colField === colField)
		);
		this.deps.ctx.applyChange({
			reason: 'integrity:validation:set-issues',
			domainMutations: [{ kind: 'integrity-set-validation-issues', issues: [...retained, issue] }],
			invalidations: [{ kind: 'cell', rowId, colId: colField, reason: 'server-validation' }],
		});
		this.deps.requestRepaint([{ rowId, colField }]);
	}

	getCellErrorMessage(rowId: string, colField: string): string | null {
		return this.deps.getIntegrityState().validation.cellErrorIndex[`${rowId}:${colField}`]?.message ?? null;
	}

	private _commitIssues(reason: 'integrity:validation:set-issues', issues: GridIntegrityIssue[]): void {
		this.deps.ctx.applyChange({
			reason,
			domainMutations: [{ kind: 'integrity-set-validation-issues', issues }],
		});
	}

	destroy(): void {
		this._commitIssues('integrity:validation:set-issues', []);
	}

	private async _collectCellIssues(rowId: string, colField: string): Promise<GridIntegrityIssue[]> {
		const cellRules = (this.options.cellRules ?? []).filter((rule) => rule.field === colField);
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

		for (const rule of this.options.rowRules ?? []) {
			let result: import('../integrityTypes.js').GridIntegrityRuleResult | null = null;
			try {
				result = await rule.validate({ rowId, row, api });
			} catch {
				result = null;
			}
			if (!result) continue;
			const fields = result.fields ?? [];
			if (!fields.includes(colField) && fields.length !== 0) continue;
			newIssues.push(_makeRowIssue(rule, rowId, fields, result));
			for (const field of fields) {
				if (
					!newIssues.some(
						(issue) =>
							issue.colField === field && issue.rowId === rowId && issue.source === 'validation' && issue.type === 'rowValidation'
					)
				) {
					newIssues.push(
						_makeCellIssue(
							{ id: `${rule.id}:${field}`, field, severity: rule.severity ?? 'error', blocking: rule.blocking ?? true },
							rowId,
							field,
							undefined,
							result
						)
					);
				}
			}
		}

		return newIssues;
	}
}

function _makeCellIssue(
	rule: { id: string; field: string; severity?: import('../integrityTypes.js').GridIntegritySeverity; blocking?: boolean },
	rowId: string,
	colField: string,
	value: unknown,
	result: import('../integrityTypes.js').GridIntegrityRuleResult
): GridIntegrityIssue {
	const sev = rule.severity ?? 'error';
	return {
		id: _stableCellIssueId(rule.id, rowId, colField),
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
		id: _stableRowIssueId(rule.id, rowId),
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
	return columns.some((column) => column.field === field);
}

function _issueKeyMatches(issue: GridIntegrityIssue, rowId: string, colField: string): boolean {
	return issue.rowId === rowId && issue.colField === colField && (issue.source === 'validation' || issue.source === 'serverValidation');
}

function _dedupeCells(cells: readonly { rowId: string; colField: string }[]): Array<{ rowId: string; colField: string }> {
	const unique: Array<{ rowId: string; colField: string }> = [];
	const seen = new Set<string>();
	for (const cell of cells) {
		const key = `${cell.rowId}:${cell.colField}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push({ rowId: cell.rowId, colField: cell.colField });
	}
	return unique;
}

function _now(): number {
	return typeof performance !== 'undefined' ? Math.floor(performance.timeOrigin + performance.now()) : 0;
}

const _EMPTY: readonly GridIntegrityIssue[] = [];

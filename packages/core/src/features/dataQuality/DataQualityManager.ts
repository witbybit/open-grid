import type { GridInsightLayer, GridCellDecoration } from '../../insights/insightTypes.js';
import type { InternalGridState } from '../../state/GridState.js';
import type { RowModel } from '../../rowModel.js';
import { missingRequiredRule } from './builtInRules.js';
import type { DataQualityDiagnostics, DataQualityIssue, DataQualityReport, DataQualityRule } from './dataQualityTypes.js';

export type { DataQualityDiagnostics, DataQualityIssue, DataQualityReport, DataQualityRule };
export type { DataQualityIssueType, DataQualityFix, DataQualityRuleContext } from './dataQualityTypes.js';
export { createDuplicateValueRule } from './builtInRules.js';

let _reportSeq = 0;
let _issueSeq = 0;

function nextReportId(): string {
	return `dq-report-${++_reportSeq}`;
}

function nextIssueId(): string {
	return `dq-issue-${++_issueSeq}`;
}

export interface DataQualityManagerDeps<TRowData> {
	getState: () => InternalGridState<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	requestInsightRepaint: () => void;
}

/**
 * Implements GridInsightLayer for data quality.
 * Read-only: scans rows and produces a report; never mutates row data.
 * Registered on engine.insights at GridEngine construction.
 */
export class GridDataQualityManager<TRowData> implements GridInsightLayer {
	public readonly id = 'dataQuality' as const;

	private report: DataQualityReport | null = null;
	private lastError: string | null = null;
	private lastRunAt: number | null = null;

	// Map: `rowId\0colField` → aggregated decorations
	private readonly cellDecMap = new Map<string, GridCellDecoration[]>();

	private readonly customRules = new Map<string, DataQualityRule<TRowData>>();

	constructor(private readonly deps: DataQualityManagerDeps<TRowData>) {}

	// ── GridInsightLayer ────────────────────────────────────────────────────────

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		return this.cellDecMap.get(`${rowId}\0${colField}`) ?? _EMPTY;
	}

	getDiagnostics(): DataQualityDiagnostics {
		return {
			active: this.report !== null,
			scope: this.report?.scope ?? null,
			totalIssues: this.report?.summary.totalIssues ?? 0,
			errors: this.report?.summary.errors ?? 0,
			warnings: this.report?.summary.warnings ?? 0,
			infos: this.report?.summary.infos ?? 0,
			lastRunAt: this.lastRunAt,
			lastError: this.lastError,
		};
	}

	destroy(): void {
		this.clear();
	}

	// ── Public API ──────────────────────────────────────────────────────────────

	async run(scope?: DataQualityReport['scope']): Promise<DataQualityReport> {
		this.lastError = null;
		const state = this.deps.getState();
		const rowModel = this.deps.getRowModel();

		// Determine effective scope and collect rows
		const resolvedScope = scope ?? this._defaultScope(rowModel);
		const rows = this._collectRows(rowModel, resolvedScope, state);

		const getRowId = state.getRowId ? (row: TRowData) => state.getRowId!(row) : (_row: TRowData) => String(Math.random());

		const context: import('./dataQualityTypes.js').DataQualityRuleContext<TRowData> = {
			rows,
			columns: state.columns,
			getRowId,
		};

		const allIssues: DataQualityIssue[] = [];

		// 1. Aggregate existing validation errors (read-only; validation owns them)
		// validationKey format is `${rowId}:${colField}`; match via column suffix to handle rowIds with ':'.
		if (state.validationErrors) {
			const columns = state.columns;
			for (const [key, error] of Object.entries(state.validationErrors)) {
				if (!error) continue;
				let rowId: string | undefined;
				let colField: string | undefined;
				for (const col of columns) {
					const suffix = `:${col.field}`;
					if (key.endsWith(suffix)) {
						colField = col.field;
						rowId = key.slice(0, key.length - suffix.length);
						break;
					}
				}
				if (!rowId || !colField) continue;
				allIssues.push({
					id: nextIssueId(),
					type: 'validation',
					severity: 'error',
					rowId,
					colField,
					message: error,
				});
			}
		}

		// 2. Missing required values (built-in)
		const missingIssues = await missingRequiredRule.run(context as import('./dataQualityTypes.js').DataQualityRuleContext<unknown>);
		for (const issue of missingIssues) allIssues.push({ ...issue, id: nextIssueId() });

		// 3. Custom rules
		for (const rule of this.customRules.values()) {
			try {
				const ruleIssues = await rule.run(context);
				for (const issue of ruleIssues) allIssues.push({ ...issue, id: nextIssueId() });
			} catch (e) {
				this.lastError = `Rule "${rule.id}" failed: ${e instanceof Error ? e.message : String(e)}`;
			}
		}

		const summary = {
			totalIssues: allIssues.length,
			errors: allIssues.filter((i) => i.severity === 'error').length,
			warnings: allIssues.filter((i) => i.severity === 'warning').length,
			infos: allIssues.filter((i) => i.severity === 'info').length,
		};

		this.report = { id: nextReportId(), generatedAt: Date.now(), scope: resolvedScope, issues: allIssues, summary };
		this.lastRunAt = Date.now();

		this._rebuildDecorationsMap(allIssues);
		this.deps.requestInsightRepaint();

		return this.report;
	}

	getReport(): DataQualityReport | null {
		return this.report;
	}

	clear(): void {
		this.report = null;
		this.cellDecMap.clear();
		this.deps.requestInsightRepaint();
	}

	registerRule(rule: DataQualityRule<TRowData>): void {
		this.customRules.set(rule.id, rule);
	}

	unregisterRule(ruleId: string): void {
		this.customRules.delete(ruleId);
	}

	// ── Private helpers ─────────────────────────────────────────────────────────

	private _rebuildDecorationsMap(issues: readonly DataQualityIssue[]): void {
		this.cellDecMap.clear();
		for (const issue of issues) {
			if (!issue.rowId || !issue.colField) continue;
			const key = `${issue.rowId}\0${issue.colField}`;
			let list = this.cellDecMap.get(key);
			if (!list) {
				list = [];
				this.cellDecMap.set(key, list);
			}
			list.push({
				layerId: 'dataQuality',
				kind: issue.type,
				severity: issue.severity,
				className: _severityClass(issue.severity),
				title: issue.message,
				data: issue,
			});
		}
	}

	private _defaultScope(rowModel: RowModel<TRowData> | null): DataQualityReport['scope'] {
		if (!rowModel) return 'loadedRows';
		const type = (rowModel as { type?: string }).type;
		return type === 'client' ? 'allClientRows' : 'loadedRows';
	}

	private _collectRows(rowModel: RowModel<TRowData> | null, _scope: DataQualityReport['scope'], _state: InternalGridState<TRowData>): TRowData[] {
		if (!rowModel) return [];
		const rows: TRowData[] = [];
		const count = rowModel.getVisualRowCount();
		for (let i = 0; i < count; i++) {
			const row = rowModel.getVisualRow(i);
			if (row?.kind === 'data' && row.node.data != null) rows.push(row.node.data as TRowData);
		}
		return rows;
	}
}

function _severityClass(severity: 'info' | 'warning' | 'error'): string {
	if (severity === 'error') return 'og-cell-quality-error';
	if (severity === 'warning') return 'og-cell-quality-warning';
	return 'og-cell-quality-info';
}

const _EMPTY: readonly GridCellDecoration[] = [];

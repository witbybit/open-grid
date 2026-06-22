import type { GridCellDecoration } from '../../../insights/insightTypes.js';
import type { ColumnDef } from '../../../columnDef.js';
import type { GridApi } from '../../../api/GridApi.js';
import type {
	GridIntegrityIssue,
	GridIntegrityModule,
	GridIntegrityRunContext,
	GridQualityIntegrityOptions,
	GridDataQualityRule,
	GridIntegrityRowRef,
	GridIntegrityScope,
} from '../integrityTypes.js';

let _seq = 0;
function nextIssueId(): string {
	return `qi-${++_seq}`;
}

export interface QualityModuleDeps<TRowData> {
	getApi: () => GridApi<TRowData>;
}

export class QualityIntegrityModule<TRowData> implements GridIntegrityModule<TRowData> {
	public readonly id = 'quality' as const;

	private options: GridQualityIntegrityOptions<TRowData>;
	private issues: GridIntegrityIssue[] = [];
	private lastRunAt: number | null = null;
	private lastError: string | null = null;
	private lastScope: GridIntegrityScope | null = null;
	private lastComplete = false;
	private customRules = new Map<string, GridDataQualityRule<TRowData>>();
	private readonly cellDecMap = new Map<string, GridCellDecoration[]>();

	constructor(
		options: GridQualityIntegrityOptions<TRowData>,
		private readonly deps: QualityModuleDeps<TRowData>
	) {
		this.options = options;
		for (const rule of options.rules ?? []) {
			this.customRules.set(rule.id, rule);
		}
	}

	isEnabled(): boolean {
		return this.options.enabled !== false;
	}

	getIssues(): readonly GridIntegrityIssue[] {
		return this.issues;
	}

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		return this.cellDecMap.get(`${rowId}\0${colField}`) ?? _EMPTY_DECS;
	}

	getDiagnostics(): unknown {
		return {
			enabled: this.isEnabled(),
			totalIssues: this.issues.length,
			lastRunAt: this.lastRunAt,
			lastError: this.lastError,
			lastScope: this.lastScope,
			complete: this.lastComplete,
			customRules: this.customRules.size,
		};
	}

	async run(context: GridIntegrityRunContext<TRowData>): Promise<readonly GridIntegrityIssue[]> {
		if (!this.isEnabled()) return _EMPTY;

		this.lastError = null;
		this.lastScope = context.scope;
		this.lastComplete = context.complete;

		const api = this.deps.getApi();
		const allIssues: GridIntegrityIssue[] = [];

		// Include validation issues from existing context issues if configured (default true)
		const includeValidation = this.options.includeValidationIssues !== false;
		if (includeValidation) {
			for (const issue of context.existingIssues) {
				if (issue.source === 'validation' || issue.source === 'serverValidation') {
					allIssues.push(issue);
				}
			}
		}

		// Built-in: missing required values (based on column required flag or required() rule)
		const missingIssues = _runMissingRequired<TRowData>(context.rows, context.columns);
		for (const issue of missingIssues) allIssues.push({ ...issue, id: nextIssueId() });

		// Custom rules
		const ruleContext = {
			scope: context.scope,
			rows: context.rows,
			columns: context.columns,
			api,
			complete: context.complete,
		};

		for (const rule of this.customRules.values()) {
			try {
				const ruleIssues = await rule.run(ruleContext);
				for (const issue of ruleIssues) {
					allIssues.push({ ...issue, id: nextIssueId() });
				}
			} catch (e) {
				this.lastError = `Quality rule "${rule.id}" failed: ${e instanceof Error ? e.message : String(e)}`;
			}
		}

		this.issues = allIssues;
		this.lastRunAt = _now();
		this._rebuildCellDecMap();
		return allIssues;
	}

	registerRule(rule: GridDataQualityRule<TRowData>): void {
		this.customRules.set(rule.id, rule);
	}

	unregisterRule(ruleId: string): void {
		this.customRules.delete(ruleId);
	}

	clearIssues(): void {
		this.issues = [];
		this.cellDecMap.clear();
	}

	destroy(): void {
		this.clearIssues();
		this.customRules.clear();
	}

	private _rebuildCellDecMap(): void {
		this.cellDecMap.clear();
		for (const issue of this.issues) {
			if (!issue.rowId || !issue.colField) continue;
			const key = `${issue.rowId}\0${issue.colField}`;
			let list = this.cellDecMap.get(key);
			if (!list) {
				list = [];
				this.cellDecMap.set(key, list);
			}
			list.push({
				layerId: 'dataIntegrity',
				kind: issue.type,
				severity: issue.severity,
				className: _qualityClass(issue.severity),
				title: issue.message,
				data: issue,
			});
		}
	}
}

// ── Built-in rules ────────────────────────────────────────────────────────────

function _runMissingRequired<TRowData>(
	rows: readonly GridIntegrityRowRef<TRowData>[],
	columns: readonly ColumnDef<TRowData>[]
): GridIntegrityIssue[] {
	const requiredFields = columns.filter((c) => (c as { required?: boolean }).required === true).map((c) => c.field);
	if (requiredFields.length === 0) return [];

	const issues: GridIntegrityIssue[] = [];
	for (const ref of rows) {
		for (const field of requiredFields) {
			const value = (ref.row as Record<string, unknown>)[field ?? ''];
			if (value === null || value === undefined || value === '') {
				issues.push({
					id: nextIssueId(),
					source: 'dataQuality',
					type: 'missingRequired',
					severity: 'error',
					blocking: true,
					rowId: ref.rowId,
					colField: field,
					message: `${field} is required but missing`,
					createdAt: _now(),
				});
			}
		}
	}
	return issues;
}

export function duplicateValueRule<TRowData>(field: string): GridDataQualityRule<TRowData> {
	return {
		id: `duplicate:${field}`,
		label: `Duplicate ${field}`,
		run(context): readonly GridIntegrityIssue[] {
			// Scan the provided integrity rows (not visible rows) — scope-aware
			const seen = new Map<unknown, string>();
			const issues: GridIntegrityIssue[] = [];

			for (const ref of context.rows) {
				const value = (ref.row as Record<string, unknown>)[field ?? ''];
				if (value === null || value === undefined || value === '') continue;

				if (seen.has(value)) {
					issues.push({
						id: nextIssueId(),
						source: 'dataQuality',
						type: 'duplicate',
						severity: 'warning',
						blocking: false,
						rowId: ref.rowId,
						colField: field,
						message: `Duplicate ${field}: "${value}" (also in row ${seen.get(value)})`,
						value,
						createdAt: _now(),
					});
				} else {
					seen.set(value, ref.rowId);
				}
			}
			return issues;
		},
	};
}

export function missingRequiredRule<TRowData>(): GridDataQualityRule<TRowData> {
	return {
		id: 'missingRequired',
		label: 'Missing required values',
		run(context): readonly GridIntegrityIssue[] {
			return _runMissingRequired(context.rows, context.columns);
		},
	};
}

function _qualityClass(severity: import('../integrityTypes.js').GridIntegritySeverity): string {
	if (severity === 'error') return 'og-cell-quality-error';
	if (severity === 'warning') return 'og-cell-quality-warning';
	return 'og-cell-quality-info';
}

function _now(): number {
	return typeof performance !== 'undefined' ? Math.floor(performance.timeOrigin + performance.now()) : 0;
}

const _EMPTY: readonly GridIntegrityIssue[] = [];
const _EMPTY_DECS: readonly GridCellDecoration[] = [];

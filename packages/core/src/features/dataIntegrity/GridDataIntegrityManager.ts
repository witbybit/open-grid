import type { GridInsightLayer, GridCellDecoration, GridRowDecoration } from '../../insights/insightTypes.js';
import type { GridFeatureContext } from '../GridFeatureContext.js';
import type { DataModel } from '../../models/DataModel.js';
import type { RowModel } from '../../rowModel.js';
import type { GridApi } from '../../api/GridApi.js';
import type { GridScheduler } from '../../renderer/gridScheduler.js';
import type { GridCapabilityManager } from '../../capabilities/GridCapabilityManager.js';
import type {
	GridDataIntegrityConfig,
	GridIntegrityIssue,
	GridIntegrityIssueFilter,
	GridIntegrityIssueSource,
	GridIntegritySeverity,
	GridIntegritySummary,
	GridIntegrityRunOptions,
	GridIntegrityRunResult,
	GridIntegrityScope,
	GridIntegrityModuleId,
	GridDiffModel,
	GridDiffResult,
	GridDiffAcceptResult,
	GridCellDiff,
	GridLiveStreamOptions,
	GridTransactionStreamHandle,
	GridTransactionStreamState,
	GridCellConflict,
	ResolveConflictOptions,
	ConflictResolutionResult,
	ServerIntegrityReport,
	GridIntegrityApi,
	GridCommitResult,
} from './integrityTypes.js';
import type { GridIntegrityRowProvider } from './integrityTypes.js';
import { ValidationIntegrityModule } from './modules/ValidationIntegrityModule.js';
import type { ValidationModuleDeps } from './modules/ValidationIntegrityModule.js';
import { QualityIntegrityModule } from './modules/QualityIntegrityModule.js';
import { DiffIntegrityModule } from './modules/DiffIntegrityModule.js';
import { LiveStreamIntegrityModule } from './modules/LiveStreamIntegrityModule.js';
import { ConflictIntegrityModule } from './modules/ConflictIntegrityModule.js';

let _issueSeq = 0;
function nextIssueId(): string {
	return `ig-${++_issueSeq}`;
}

export interface GridDataIntegrityManagerDeps<TRowData> {
	ctx: GridFeatureContext<TRowData>;
	data: DataModel<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	getApi: () => GridApi<TRowData>;
	scheduler: GridScheduler;
	rowProvider: GridIntegrityRowProvider<TRowData>;
	capabilityManager: GridCapabilityManager<TRowData>;
	setCellValue: (rowId: string, colField: string, value: unknown) => void;
	commitCells: (updates: readonly { rowId: string; colField: string; value: unknown }[]) => void;
	applyRowPatch: (rowId: string, patch: Partial<TRowData>) => void;
	requestInsightRepaint: () => void;
	requestTargetedRepaint: (cells: Array<{ rowId: string; colField: string }>) => void;
}

export class GridDataIntegrityManager<TRowData> implements GridInsightLayer {
	public readonly id = 'dataIntegrity' as const;

	/** @internal exposed for GridEngine to route post-edit validateCell to the integrity pipeline */
	public readonly validationModule: ValidationIntegrityModule<TRowData> | null;
	private readonly qualityModule: QualityIntegrityModule<TRowData> | null;
	private readonly diffModule: DiffIntegrityModule<TRowData> | null;
	private readonly liveStreamModule: LiveStreamIntegrityModule<TRowData> | null;
	private readonly conflictModule: ConflictIntegrityModule<TRowData> | null;

	// Unified issue registry: all externally published issues
	private readonly publishedIssues = new Map<GridIntegrityIssueSource, GridIntegrityIssue[]>();

	// Server-provided report
	private serverReport: ServerIntegrityReport | null = null;

	private _summary: GridIntegritySummary = _cleanSummary();

	constructor(
		config: GridDataIntegrityConfig<TRowData>,
		private readonly deps: GridDataIntegrityManagerDeps<TRowData>
	) {
		const requestRepaint = (cells?: Array<{ rowId: string; colField: string }>) => {
			if (cells && cells.length > 0) {
				deps.requestTargetedRepaint(cells);
			} else {
				deps.requestInsightRepaint();
			}
		};

		const commitCellValue = async (rowId: string, colField: string, value: unknown): Promise<GridCommitResult> => {
			try {
				deps.setCellValue(rowId, colField, value);
				return { success: true, rowId, colField, committedValue: value };
			} catch (e) {
				return { success: false, rowId, colField, error: String(e) };
			}
		};

		// Validation module
		const validationConfig = _normalizeModuleConfig(config.validation);
		if (validationConfig) {
			const validationDeps: ValidationModuleDeps<TRowData> = {
				ctx: deps.ctx,
				getRowModel: deps.getRowModel,
				data: deps.data,
				getApi: deps.getApi,
				requestRepaint,
			};
			this.validationModule = new ValidationIntegrityModule<TRowData>(validationConfig, validationDeps);
		} else {
			this.validationModule = null;
		}

		// Conflict module (created before liveStream since liveStream references it)
		const conflictConfig = _normalizeModuleConfig(config.conflicts);
		if (conflictConfig) {
			this.conflictModule = new ConflictIntegrityModule<TRowData>(conflictConfig, {
				commitCellValue,
				validateCell: this.validationModule ? (rowId, colField) => this.validationModule!.validateCell(rowId, colField) : undefined,
				canEdit: (rowId, colField) => deps.capabilityManager.can('edit', { rowId, colField }).allowed,
				requestRepaint,
			});
		} else {
			this.conflictModule = null;
		}

		// Live stream module
		const liveStreamConfig = _normalizeModuleConfig(config.liveStream);
		if (liveStreamConfig) {
			this.liveStreamModule = new LiveStreamIntegrityModule<TRowData>(liveStreamConfig, {
				commitCells: deps.commitCells,
				applyRowPatch: deps.applyRowPatch,
				getRawCellValue: (rowId, colField) => deps.data.getRawCellValue(rowId, colField),
				isCellDirty: (rowId, colField) => this._isCellDirty(rowId, colField),
				getConflictModule: () => this.conflictModule,
				requestRepaint,
				scheduler: deps.scheduler,
			});
		} else {
			this.liveStreamModule = null;
		}

		// Quality module
		const qualityConfig = _normalizeModuleConfig(config.quality);
		if (qualityConfig) {
			this.qualityModule = new QualityIntegrityModule<TRowData>(qualityConfig, {
				getApi: deps.getApi,
			});
		} else {
			this.qualityModule = null;
		}

		// Diff module
		const diffConfig = _normalizeModuleConfig(config.diff);
		if (diffConfig) {
			this.diffModule = new DiffIntegrityModule<TRowData>(diffConfig, {
				getColumns: () => deps.ctx.getState().columns,
				commitCellValue,
				validateCell: this.validationModule ? (rowId, colField) => this.validationModule!.validateCell(rowId, colField) : undefined,
				canEdit: (rowId, colField) => deps.capabilityManager.can('edit', { rowId, colField }).allowed,
				requestRepaint,
			});
		} else {
			this.diffModule = null;
		}
	}

	// ── GridInsightLayer ────────────────────────────────────────────────────────

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const decs: GridCellDecoration[] = [];
		_pushAll(decs, this.conflictModule?.getCellDecorations(rowId, colField));
		_pushAll(decs, this._getValidationCellDecorations(rowId, colField));
		_pushAll(decs, this.diffModule?.getCellDecorations(rowId, colField));
		_pushAll(decs, this.liveStreamModule?.getCellDecorations(rowId, colField));
		_pushAll(decs, this.qualityModule?.getCellDecorations(rowId, colField));
		_pushAll(decs, this._getPublishedIssueCellDecorations(rowId, colField));
		return decs;
	}

	getRowDecorations(rowId: string): readonly GridRowDecoration[] {
		const decs: GridRowDecoration[] = [];
		_pushAll(decs, this.diffModule?.getRowDecorations(rowId));
		return decs;
	}

	getDiagnostics(): unknown {
		return {
			summary: this._summary,
			modules: {
				validation: this.validationModule?.getDiagnostics() ?? null,
				quality: this.qualityModule?.getDiagnostics() ?? null,
				diff: this.diffModule?.getDiagnostics() ?? null,
				liveStream: this.liveStreamModule?.getDiagnostics() ?? null,
				conflicts: this.conflictModule?.getDiagnostics() ?? null,
			},
			publishedIssues: Object.fromEntries(Array.from(this.publishedIssues.entries()).map(([k, v]) => [k, v.length])),
			serverReport: this.serverReport
				? { scope: this.serverReport.scope, complete: this.serverReport.complete, issues: this.serverReport.issues.length }
				: null,
		};
	}

	destroy(): void {
		this.validationModule?.destroy();
		this.qualityModule?.destroy();
		this.diffModule?.destroy();
		this.liveStreamModule?.destroy();
		this.conflictModule?.destroy();
		this.publishedIssues.clear();
	}

	// ── Public API (GridIntegrityApi) ──────────────────────────────────────────

	buildApi(): GridIntegrityApi<TRowData> {
		return {
			run: (options) => this.run(options),
			getSummary: () => this.getSummary(),
			getIssues: (filter) => this.getIssues(filter),
			getCellIssues: (rowId, colField) => this.getCellIssues(rowId, colField),
			getRowIssues: (rowId) => this.getRowIssues(rowId),
			getBlockingIssues: () => this.getBlockingIssues(),
			canSubmit: () => this.canSubmit(),
			publishIssues: (source, issues) => this.publishIssues(source, issues),
			publishServerReport: (report) => this.publishServerReport(report),
			clearIssues: (filter) => this.clearIssues(filter),
			validateCell: (rowId, colField) => this.validateCell(rowId, colField),
			validateRow: (rowId) => this.validateRow(rowId),
			validateGrid: (options) => this.validateGrid(options),
			setDiffModel: (model) => this.setDiffModel(model),
			clearDiff: () => this.clearDiff(),
			getDiffResult: () => this.getDiffResult(),
			acceptCellDiff: (rowId, colField) => this.acceptCellDiff(rowId, colField),
			createStream: (options) => this.createStream(options),
			getStreamState: () => this.getStreamState(),
			getConflicts: () => this.getConflicts(),
			resolveConflict: (conflictId, options) => this.resolveConflict(conflictId, options),
			clearConflict: (conflictId) => this.clearConflict(conflictId),
		};
	}

	// ── Integrity run ──────────────────────────────────────────────────────────

	async run(options?: GridIntegrityRunOptions): Promise<GridIntegrityRunResult> {
		const scope = options?.scope ?? this._defaultScope();
		const moduleIds = options?.modules ?? 'enabled';

		const rowsResult = this.deps.rowProvider.getRowsForIntegrityScope(scope);
		const rows = rowsResult.status === 'ok' ? rowsResult.rows : [];
		const complete = rowsResult.status === 'ok' ? rowsResult.complete : false;
		const state = this.deps.ctx.getState();
		const api = this.deps.getApi();

		const collectedIssues: GridIntegrityIssue[] = [];

		const context = {
			scope,
			rows,
			complete,
			columns: state.columns,
			api,
			existingIssues: collectedIssues as readonly GridIntegrityIssue[],
		};

		const shouldRunModule = (id: GridIntegrityModuleId) =>
			moduleIds === 'enabled' ? true : (moduleIds as readonly GridIntegrityModuleId[]).includes(id);

		if (shouldRunModule('validation') && this.validationModule?.isEnabled()) {
			const issues = await this.validationModule.run(context);
			for (const i of issues) collectedIssues.push(i);
		}

		if (shouldRunModule('quality') && this.qualityModule?.isEnabled()) {
			const qualityContext = { ...context, existingIssues: collectedIssues as readonly GridIntegrityIssue[] };
			const issues = await this.qualityModule.run(qualityContext);
			for (const i of issues) collectedIssues.push(i);
		}

		if (shouldRunModule('diff') && this.diffModule?.isEnabled()) {
			const issues = this.diffModule.run(context);
			for (const i of issues) collectedIssues.push(i);
		}

		if (shouldRunModule('liveStream') && this.liveStreamModule?.isEnabled()) {
			const issues = this.liveStreamModule.run(context);
			for (const i of issues) collectedIssues.push(i);
		}

		if (shouldRunModule('conflicts') && this.conflictModule?.isEnabled()) {
			const issues = this.conflictModule.run(context);
			for (const i of issues) collectedIssues.push(i);
		}

		// Include published issues
		for (const [, issues] of this.publishedIssues) {
			for (const i of issues) collectedIssues.push(i);
		}

		// Server report
		if (this.serverReport) {
			for (const i of this.serverReport.issues) collectedIssues.push(i);
		}

		const summary = _buildSummary(collectedIssues, 'clean');
		this._summary = summary;
		this.deps.requestInsightRepaint();

		return { summary, issues: collectedIssues };
	}

	// ── Issue registry ─────────────────────────────────────────────────────────

	getSummary(): GridIntegritySummary {
		return this._summary;
	}

	getIssues(filter?: GridIntegrityIssueFilter): readonly GridIntegrityIssue[] {
		const all = this._collectAllIssues();
		if (!filter) return all;
		return all.filter((i) => _matchesFilter(i, filter));
	}

	getCellIssues(rowId: string, colField: string): readonly GridIntegrityIssue[] {
		return this._collectAllIssues().filter((i) => i.rowId === rowId && i.colField === colField);
	}

	getRowIssues(rowId: string): readonly GridIntegrityIssue[] {
		return this._collectAllIssues().filter((i) => i.rowId === rowId);
	}

	getBlockingIssues(): readonly GridIntegrityIssue[] {
		return this._collectAllIssues().filter((i) => i.blocking);
	}

	canSubmit(): boolean {
		return this.getBlockingIssues().length === 0;
	}

	publishIssues(source: GridIntegrityIssueSource, issues: readonly GridIntegrityIssue[]): void {
		const existing = this.publishedIssues.get(source) ?? [];
		const stamped = issues.map((i) => ({ ...i, id: i.id || nextIssueId(), source }));
		this.publishedIssues.set(source, [...existing, ...stamped]);
		this._rebuildSummary();
		this.deps.requestInsightRepaint();
	}

	publishServerReport(report: ServerIntegrityReport): void {
		this.serverReport = report;
		this._rebuildSummary();
		this.deps.requestInsightRepaint();
	}

	clearIssues(filter?: GridIntegrityIssueFilter): void {
		if (!filter) {
			this.qualityModule?.clearIssues();
			this.publishedIssues.clear();
			this.serverReport = null;
		} else {
			const sources = filter.source ? (Array.isArray(filter.source) ? filter.source : [filter.source]) : null;
			if (!sources || sources.includes('dataQuality')) this.qualityModule?.clearIssues();
			for (const [source, issues] of this.publishedIssues) {
				const kept = issues.filter((i) => !_matchesFilter(i, filter));
				if (kept.length === 0) this.publishedIssues.delete(source);
				else this.publishedIssues.set(source, kept);
			}
		}
		this._rebuildSummary();
		this.deps.requestInsightRepaint();
	}

	// ── Validation shortcuts ───────────────────────────────────────────────────

	async validateCell(rowId: string, colField: string): Promise<readonly GridIntegrityIssue[]> {
		if (!this.validationModule) return _EMPTY;
		return this.validationModule.validateCell(rowId, colField);
	}

	async validateRow(rowId: string): Promise<readonly GridIntegrityIssue[]> {
		if (!this.validationModule) return _EMPTY;
		return this.validationModule.validateRow(rowId);
	}

	async validateGrid(options?: { scope?: GridIntegrityScope }): Promise<GridIntegrityRunResult> {
		return this.run({ modules: ['validation'], scope: options?.scope });
	}

	// ── Diff shortcuts ─────────────────────────────────────────────────────────

	setDiffModel(model: GridDiffModel<TRowData> | null): void {
		if (!this.diffModule) throw new Error('[DataIntegrity] Diff module is not enabled. Add diff: true to dataIntegrity config.');
		this.diffModule.setDiffModel(model);
		this._rebuildSummary();
	}

	clearDiff(): void {
		this.diffModule?.clearDiff();
		this._rebuildSummary();
	}

	getDiffResult(): GridDiffResult | null {
		return this.diffModule?.getDiffResult() ?? null;
	}

	getCellDiff(rowId: string, colField: string): GridCellDiff | null {
		return this.diffModule?.getCellDiff(rowId, colField) ?? null;
	}

	async acceptCellDiff(rowId: string, colField: string): Promise<GridDiffAcceptResult> {
		if (!this.diffModule) return { status: 'unsupported', reason: 'Diff module is not enabled' };
		return this.diffModule.acceptCellDiff(rowId, colField);
	}

	// ── Live stream shortcuts ──────────────────────────────────────────────────

	createStream(options?: GridLiveStreamOptions<TRowData>): GridTransactionStreamHandle<TRowData> {
		if (!this.liveStreamModule) {
			throw new Error('[DataIntegrity] Live stream module is not enabled. Add liveStream: true to dataIntegrity config.');
		}
		return this.liveStreamModule.createStream(options);
	}

	getStreamState(): GridTransactionStreamState | null {
		return this.liveStreamModule?.getStreamState() ?? null;
	}

	// ── Conflict shortcuts ─────────────────────────────────────────────────────

	getConflicts(): readonly GridCellConflict[] {
		return this.conflictModule?.getConflicts() ?? [];
	}

	async resolveConflict(conflictId: string, options: ResolveConflictOptions): Promise<ConflictResolutionResult> {
		if (!this.conflictModule) return { status: 'notFound' };
		return this.conflictModule.resolveConflict(conflictId, options);
	}

	clearConflict(conflictId: string): void {
		this.conflictModule?.clearConflict(conflictId);
	}

	// ── Used by ValidationManager for inline error display ────────────────────

	getCellErrorMessage(rowId: string, colField: string): string | null {
		return this.validationModule?.getCellErrorMessage(rowId, colField) ?? null;
	}

	// ── Private ────────────────────────────────────────────────────────────────

	private _collectAllIssues(): GridIntegrityIssue[] {
		const all: GridIntegrityIssue[] = [];
		const vm = this.validationModule?.getIssues();
		if (vm) for (const i of vm) all.push(i);
		const qm = this.qualityModule?.getIssues();
		if (qm) for (const i of qm) all.push(i);
		const dm = this.diffModule?.getIssues();
		if (dm) for (const i of dm) all.push(i);
		const lm = this.liveStreamModule?.getIssues();
		if (lm) for (const i of lm) all.push(i);
		const cm = this.conflictModule?.getIssues();
		if (cm) for (const i of cm) all.push(i);
		for (const [, issues] of this.publishedIssues) for (const i of issues) all.push(i);
		if (this.serverReport) for (const i of this.serverReport.issues) all.push(i);
		return all;
	}

	private _rebuildSummary(): void {
		this._summary = _buildSummary(this._collectAllIssues(), 'clean');
	}

	private _defaultScope(): GridIntegrityScope {
		const rowModel = this.deps.getRowModel();
		const type = (rowModel as { type?: string } | null)?.type;
		return type === 'client' ? 'allRows' : 'loadedRows';
	}

	private _isCellDirty(rowId: string, colField: string): boolean {
		// Check active editing
		const editState = this.deps.ctx.getState().activeEdit;
		if (editState?.rowId === rowId && editState?.colField === colField) return true;
		// Check existing conflicts (a conflicted cell is locally dirty)
		if (this.conflictModule?.getCellConflict(rowId, colField)) return true;
		return false;
	}

	private _getPublishedIssueCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const decs: GridCellDecoration[] = [];
		for (const issues of this.publishedIssues.values()) {
			for (const issue of issues) {
				if (issue.rowId === rowId && issue.colField === colField) {
					decs.push({
						layerId: 'dataIntegrity',
						kind: issue.type,
						severity: issue.severity,
						className: _publishedIssueClass(issue.source, issue.severity),
						title: issue.message,
						data: issue,
					});
				}
			}
		}
		return decs;
	}

	private _getValidationCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const issue = this.validationModule?.getCellError(rowId, colField);
		if (!issue) return _EMPTY_DECS;
		return [
			{
				layerId: 'dataIntegrity',
				kind: 'validationError',
				severity: issue.severity,
				className: issue.severity === 'error' ? 'og-cell-integrity-error og-cell-validation-error' : 'og-cell-integrity-warning',
				title: issue.message,
				data: issue,
			},
		];
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _normalizeModuleConfig<T extends object>(config: T | boolean | undefined): T | null {
	if (!config) return null;
	if (config === true) return {} as T;
	return config;
}

function _matchesFilter(issue: GridIntegrityIssue, filter: GridIntegrityIssueFilter): boolean {
	if (filter.rowId !== undefined && issue.rowId !== filter.rowId) return false;
	if (filter.colField !== undefined && issue.colField !== filter.colField) return false;
	if (filter.severity !== undefined && issue.severity !== filter.severity) return false;
	if (filter.blockingOnly && !issue.blocking) return false;
	if (filter.source !== undefined) {
		const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
		if (!sources.includes(issue.source)) return false;
	}
	if (filter.type !== undefined) {
		const types = Array.isArray(filter.type) ? filter.type : [filter.type];
		if (!types.includes(issue.type)) return false;
	}
	return true;
}

function _publishedIssueClass(source: GridIntegrityIssueSource, severity: GridIntegritySeverity): string {
	if (source === 'conflict') return 'og-cell-conflict';
	if (severity === 'error') return 'og-cell-insight-error';
	if (severity === 'warning') return 'og-cell-insight-warning';
	return 'og-cell-insight-info';
}

function _buildSummary(issues: readonly GridIntegrityIssue[], baseStatus: GridIntegritySummary['status']): GridIntegritySummary {
	const blocking = issues.filter((i) => i.blocking).length;
	const errors = issues.filter((i) => i.severity === 'error').length;
	const warnings = issues.filter((i) => i.severity === 'warning').length;

	const bySource: Partial<Record<GridIntegrityIssueSource, number>> = {};
	for (const issue of issues) {
		bySource[issue.source] = (bySource[issue.source] ?? 0) + 1;
	}

	let status: GridIntegritySummary['status'] = baseStatus;
	if (blocking > 0) status = 'blocked';
	else if (errors > 0) status = 'blocked';
	else if (warnings > 0) status = 'warning';
	else if (issues.length === 0) status = 'clean';

	return {
		status,
		totalIssues: issues.length,
		blockingIssues: blocking,
		warnings,
		errors,
		bySource,
	};
}

function _cleanSummary(): GridIntegritySummary {
	return { status: 'clean', totalIssues: 0, blockingIssues: 0, warnings: 0, errors: 0, bySource: {} };
}

function _pushAll<T>(target: T[], source: readonly T[] | undefined): void {
	if (!source) return;
	for (const item of source) target.push(item);
}

const _EMPTY: readonly GridIntegrityIssue[] = [];
const _EMPTY_DECS: readonly GridCellDecoration[] = [];

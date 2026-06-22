import type { ColumnDef } from '../../columnDef.js';
import type { GridApi } from '../../api/GridApi.js';

// ── Issue model ───────────────────────────────────────────────────────────────

export type GridIntegrityIssueSource = 'validation' | 'serverValidation' | 'dataQuality' | 'diff' | 'liveStream' | 'conflict' | 'system';

export type GridIntegrityIssueType =
	| 'invalidValue'
	| 'missingRequired'
	| 'rowValidation'
	| 'serverRejected'
	| 'duplicate'
	| 'outlier'
	| 'typeMismatch'
	| 'formulaError'
	| 'inconsistentFormat'
	| 'diffChanged'
	| 'diffAdded'
	| 'diffRemoved'
	| 'streamSkipped'
	| 'conflict'
	| 'custom';

export type GridIntegritySeverity = 'info' | 'warning' | 'error';

export interface GridIntegrityIssue {
	readonly id: string;
	readonly source: GridIntegrityIssueSource;
	readonly type: GridIntegrityIssueType;
	readonly severity: GridIntegritySeverity;

	readonly rowId?: string;
	readonly colField?: string;

	readonly message: string;
	readonly value?: unknown;

	/**
	 * Blocking issues prevent unsafe operations: submit, apply import,
	 * accept unsafe diff, resolve conflict, unsafe remote overwrite.
	 */
	readonly blocking?: boolean;

	readonly createdAt: number;
	readonly data?: unknown;
}

// ── Commit result ─────────────────────────────────────────────────────────────

/** Result returned by integrity-initiated cell writes (diff accept, conflict resolve). */
export type GridCommitResult =
	| { readonly status: 'applied'; readonly rowId: string; readonly colField: string; readonly value: unknown }
	| { readonly status: 'notFound'; readonly reason: string }
	| { readonly status: 'validationFailed'; readonly issues: readonly GridIntegrityIssue[] }
	| { readonly status: 'capabilityDenied'; readonly reason: string }
	| { readonly status: 'blocked'; readonly reason: string; readonly issues?: readonly GridIntegrityIssue[] }
	| { readonly status: 'failed'; readonly error: unknown };

// ── Validate proposal ─────────────────────────────────────────────────────────

export interface GridValidateCellProposalParams {
	readonly rowId: string;
	readonly colField: string;
	readonly proposedValue: unknown;
	readonly source?: 'edit' | 'diffAccept' | 'conflictResolve' | 'paste' | 'api';
}

// ── Issue filter ──────────────────────────────────────────────────────────────

export interface GridIntegrityIssueFilter {
	readonly source?: GridIntegrityIssueSource | readonly GridIntegrityIssueSource[];
	readonly type?: GridIntegrityIssueType | readonly GridIntegrityIssueType[];
	readonly severity?: GridIntegritySeverity;
	readonly rowId?: string;
	readonly colField?: string;
	readonly blockingOnly?: boolean;
}

// ── Summary ───────────────────────────────────────────────────────────────────

export interface GridIntegritySummary {
	readonly status: 'clean' | 'warning' | 'blocked' | 'checking';
	readonly totalIssues: number;
	readonly blockingIssues: number;
	readonly warnings: number;
	readonly errors: number;
	readonly bySource: Partial<Record<GridIntegrityIssueSource, number>>;
}

// ── Scope ─────────────────────────────────────────────────────────────────────

export type GridIntegrityScope = 'allRows' | 'loadedRows' | 'filteredRows' | 'selectedRows' | 'visibleRows' | 'currentPage' | 'serverProvided';

// ── Row provider (row-model-aware data access) ────────────────────────────────

export interface GridIntegrityRowRef<TRowData> {
	readonly rowId: string;
	readonly row: TRowData;
	readonly rowIndex?: number;
	readonly source: 'client' | 'infiniteLoaded' | 'serverPage' | 'selected' | 'visible' | 'serverProvided';
}

export type GridIntegrityRowsResult<TRowData> =
	| {
			readonly status: 'ok';
			readonly scope: GridIntegrityScope;
			readonly rows: readonly GridIntegrityRowRef<TRowData>[];
			readonly complete: boolean;
			readonly message?: string;
	  }
	| {
			readonly status: 'unsupported';
			readonly scope: GridIntegrityScope;
			readonly reason: string;
	  };

export interface GridIntegrityRowProvider<TRowData> {
	getRowsForIntegrityScope(scope: GridIntegrityScope): GridIntegrityRowsResult<TRowData>;
}

// ── Run options/result ────────────────────────────────────────────────────────

export type GridIntegrityModuleId = 'validation' | 'quality' | 'diff' | 'liveStream' | 'conflicts';

export interface GridIntegrityRunOptions {
	readonly modules?: 'enabled' | readonly GridIntegrityModuleId[];
	readonly scope?: GridIntegrityScope;
}

export interface GridIntegrityRunResult {
	readonly summary: GridIntegritySummary;
	readonly issues: readonly GridIntegrityIssue[];
}

// ── Module interface ──────────────────────────────────────────────────────────

export interface GridIntegrityRunContext<TRowData> {
	readonly scope: GridIntegrityScope;
	readonly rows: readonly GridIntegrityRowRef<TRowData>[];
	readonly complete: boolean;
	readonly columns: readonly ColumnDef<TRowData>[];
	readonly api: GridApi<TRowData>;
	readonly existingIssues: readonly GridIntegrityIssue[];
}

export interface GridIntegrityModule<TRowData> {
	readonly id: GridIntegrityModuleId;

	isEnabled(): boolean;

	run?(context: GridIntegrityRunContext<TRowData>): Promise<readonly GridIntegrityIssue[]> | readonly GridIntegrityIssue[];

	getIssues?(): readonly GridIntegrityIssue[];

	clearIssues?(): void;

	getDiagnostics?(): unknown;

	destroy?(): void;
}

// ── Validation config ─────────────────────────────────────────────────────────

export interface GridIntegrityRuleResult {
	readonly message: string;
	readonly fields?: readonly string[];
	readonly value?: unknown;
	readonly data?: unknown;
}

export interface GridCellIntegrityRule<TRowData> {
	readonly id: string;
	readonly field: string;
	readonly severity?: GridIntegritySeverity;
	readonly blocking?: boolean;

	validate(params: {
		rowId: string;
		row: TRowData;
		field: string;
		value: unknown;
		api: GridApi<TRowData>;
	}): GridIntegrityRuleResult | null | Promise<GridIntegrityRuleResult | null>;
}

export interface GridRowIntegrityRule<TRowData> {
	readonly id: string;
	readonly severity?: GridIntegritySeverity;
	readonly blocking?: boolean;

	validate(params: {
		rowId: string;
		row: TRowData;
		api: GridApi<TRowData>;
	}): GridIntegrityRuleResult | null | Promise<GridIntegrityRuleResult | null>;
}

export interface GridValidationIntegrityOptions<TRowData> {
	readonly enabled?: boolean;

	readonly validateOnEdit?: boolean;
	readonly validateOnBlur?: boolean;
	readonly validateOnSubmit?: boolean;
	readonly validateOnPaste?: boolean;
	readonly validateOnFill?: boolean;
	readonly showInlineErrors?: boolean;

	readonly defaultScope?: GridIntegrityScope;

	readonly cellRules?: readonly GridCellIntegrityRule<TRowData>[];
	readonly rowRules?: readonly GridRowIntegrityRule<TRowData>[];
}

// ── Quality config ────────────────────────────────────────────────────────────

export interface GridDataQualityRuleContext<TRowData> {
	readonly scope: GridIntegrityScope;
	readonly rows: readonly GridIntegrityRowRef<TRowData>[];
	readonly columns: readonly ColumnDef<TRowData>[];
	readonly api: GridApi<TRowData>;
	readonly complete: boolean;
}

export interface GridDataQualityRule<TRowData> {
	readonly id: string;
	readonly label: string;

	run(context: GridDataQualityRuleContext<TRowData>): readonly GridIntegrityIssue[] | Promise<readonly GridIntegrityIssue[]>;
}

export interface GridQualityIntegrityOptions<TRowData> {
	readonly enabled?: boolean;
	readonly rules?: readonly GridDataQualityRule<TRowData>[];
	readonly includeValidationIssues?: boolean;
	readonly defaultScope?: GridIntegrityScope;
}

// ── Diff config ───────────────────────────────────────────────────────────────

export interface GridDiffDataset<TRowData> {
	readonly rows: readonly TRowData[];
	readonly getRowId?: (row: TRowData) => string;
}

export interface GridDiffOptions {
	readonly compareFields?: readonly string[];
	readonly ignoreFields?: readonly string[];
}

export interface GridDiffModel<TRowData> {
	readonly base: GridDiffDataset<TRowData>;
	readonly compare: GridDiffDataset<TRowData>;
	readonly options?: GridDiffOptions;
}

export interface GridDiffResult {
	readonly addedRows: readonly string[];
	readonly removedRows: readonly string[];
	readonly changedRows: readonly string[];
	readonly changedCells: readonly GridCellDiff[];
}

export interface GridCellDiff {
	readonly rowId: string;
	readonly colField: string;
	readonly oldValue: unknown;
	readonly newValue: unknown;
	readonly status: 'changed' | 'added' | 'removed';
}

export type GridDiffAcceptResult =
	| { status: 'accepted' }
	| { status: 'notFound'; reason: string }
	| { status: 'unsupported'; reason: string }
	| { status: 'validationFailed'; issues: readonly GridIntegrityIssue[] }
	| { status: 'capabilityDenied'; reason: string }
	| { status: 'failed'; error: unknown };

export interface GridDiffIntegrityOptions {
	readonly enabled?: boolean;
	readonly validateChangedValues?: boolean;
}

// ── Live stream config ────────────────────────────────────────────────────────

export interface GridLiveStreamIntegrityOptions {
	readonly enabled?: boolean;
	readonly dirtyCellPolicy?: 'skip' | 'markConflict' | 'remoteWins';
	readonly flashChanges?: boolean;
}

// ── Conflict config ───────────────────────────────────────────────────────────

export interface GridConflictIntegrityOptions {
	readonly enabled?: boolean;
	readonly validateBeforeResolve?: boolean;
	readonly checkCapabilitiesBeforeResolve?: boolean;
}

export type GridConflictSource = 'liveStream' | 'serverRefresh' | 'collaboration' | 'import';

export interface GridCellConflict {
	readonly id: string;
	readonly rowId: string;
	readonly colField: string;
	readonly baseValue: unknown;
	readonly localValue: unknown;
	readonly remoteValue: unknown;
	readonly localVersion?: string | number;
	readonly remoteVersion?: string | number;
	readonly source: GridConflictSource;
	readonly createdAt: number;
	readonly message?: string;
}

export interface ResolveConflictOptions {
	readonly strategy: 'local' | 'remote' | 'custom';
	readonly value?: unknown;
}

export type ConflictResolutionResult =
	| { status: 'resolved' }
	| { status: 'blocked'; reason: string; issues?: readonly GridIntegrityIssue[] }
	| { status: 'validationFailed'; issues: readonly GridIntegrityIssue[] }
	| { status: 'capabilityDenied'; reason: string }
	| { status: 'notFound' }
	| { status: 'failed'; error: unknown };

// ── Top-level dataIntegrity config ────────────────────────────────────────────

export interface GridDataIntegrityConfig<TRowData> {
	readonly validation?: GridValidationIntegrityOptions<TRowData> | boolean;
	readonly quality?: GridQualityIntegrityOptions<TRowData> | boolean;
	readonly diff?: GridDiffIntegrityOptions | boolean;
	readonly liveStream?: GridLiveStreamIntegrityOptions | boolean;
	readonly conflicts?: GridConflictIntegrityOptions | boolean;
}

// ── Server-provided report ────────────────────────────────────────────────────

export interface ServerIntegrityReport {
	readonly scope: 'serverProvided';
	readonly generatedAt: number;
	readonly issues: readonly GridIntegrityIssue[];
	readonly complete: boolean;
	readonly totalRowsChecked?: number;
}

// ── Integrity API interface ───────────────────────────────────────────────────

export interface GridIntegrityApi<TRowData> {
	run(options?: GridIntegrityRunOptions): Promise<GridIntegrityRunResult>;

	getSummary(): GridIntegritySummary;

	getIssues(filter?: GridIntegrityIssueFilter): readonly GridIntegrityIssue[];

	getCellIssues(rowId: string, colField: string): readonly GridIntegrityIssue[];

	getRowIssues(rowId: string): readonly GridIntegrityIssue[];

	getBlockingIssues(): readonly GridIntegrityIssue[];

	canSubmit(): boolean;

	publishIssues(source: GridIntegrityIssueSource, issues: readonly GridIntegrityIssue[]): void;

	publishServerReport(report: ServerIntegrityReport): void;

	clearIssues(filter?: GridIntegrityIssueFilter): void;

	validateCell(rowId: string, colField: string): Promise<readonly GridIntegrityIssue[]>;

	validateCellProposal(params: GridValidateCellProposalParams): Promise<readonly GridIntegrityIssue[]>;

	validateRow(rowId: string): Promise<readonly GridIntegrityIssue[]>;

	validateGrid(options?: { scope?: GridIntegrityScope }): Promise<GridIntegrityRunResult>;

	setDiffModel(model: GridDiffModel<TRowData> | null): void;

	clearDiff(): void;

	getDiffResult(): GridDiffResult | null;

	acceptCellDiff(rowId: string, colField: string): Promise<GridDiffAcceptResult>;

	createStream(options?: GridLiveStreamOptions<TRowData>): GridTransactionStreamHandle<TRowData>;

	getStreamState(): GridTransactionStreamState | null;

	getConflicts(): readonly GridCellConflict[];

	resolveConflict(conflictId: string, options: ResolveConflictOptions): Promise<ConflictResolutionResult>;

	clearConflict(conflictId: string): void;
}

// ── Stream types (kept minimal; module owns the full impl) ────────────────────

export interface GridLiveStreamOptions<TRowData> {
	readonly batchMs?: number;
	readonly maxBatchSize?: number;
	readonly coalesceBy?: 'cell' | 'row';
	readonly history?: 'suppress' | 'grouped';
	readonly flashChanges?: boolean;
	readonly dirtyCellPolicy?: 'skip' | 'markConflict' | 'remoteWins';
	readonly sortPolicy?: 'live' | 'defer';
	readonly filterPolicy?: 'live' | 'defer';
}

export interface GridLiveStreamUpdate<TRowData> {
	readonly cells?: readonly GridCellStreamUpdate[];
	readonly rows?: readonly GridRowStreamUpdate<TRowData>[];
}

export interface GridCellStreamUpdate {
	readonly rowId: string;
	readonly colField: string;
	readonly value: unknown;
	readonly version?: string | number;
	readonly source?: string;
}

export interface GridRowStreamUpdate<TRowData> {
	readonly rowId: string;
	readonly patch: Partial<TRowData>;
	readonly version?: string | number;
	readonly source?: string;
}

export interface GridTransactionStreamState {
	readonly paused: boolean;
	readonly pendingUpdates: number;
	readonly committedBatches: number;
	readonly skippedDirtyUpdates: number;
	readonly droppedUpdates: number;
	readonly lastFlushDurationMs: number | null;
	readonly lastError: string | null;
	readonly backpressureActive: boolean;
}

export interface GridTransactionStreamHandle<TRowData> {
	push(update: GridLiveStreamUpdate<TRowData>): void;
	pushCells(updates: readonly GridCellStreamUpdate[]): void;
	pushRows(updates: readonly GridRowStreamUpdate<TRowData>[]): void;
	pause(): void;
	resume(): void;
	flush(): void;
	destroy(): void;
	getState(): GridTransactionStreamState;
}

// ── Repaint request ───────────────────────────────────────────────────────────

export interface IntegrityRepaintRequest {
	readonly reason: string;
	readonly cells?: readonly { rowId: string; colField: string }[];
	readonly rows?: readonly string[];
	readonly full?: boolean;
}

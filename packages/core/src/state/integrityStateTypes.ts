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
	readonly blocking?: boolean;
	readonly createdAt: number;
	readonly data?: unknown;
}

export interface GridIntegritySummary {
	readonly status: 'clean' | 'warning' | 'blocked' | 'checking';
	readonly totalIssues: number;
	readonly blockingIssues: number;
	readonly warnings: number;
	readonly errors: number;
	readonly bySource: Partial<Record<GridIntegrityIssueSource, number>>;
}

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

export interface GridCellDiff {
	readonly rowId: string;
	readonly colField: string;
	readonly oldValue: unknown;
	readonly newValue: unknown;
	readonly status: 'changed' | 'added' | 'removed';
}

export interface GridDiffResult {
	readonly addedRows: readonly string[];
	readonly removedRows: readonly string[];
	readonly changedRows: readonly string[];
	readonly changedCells: readonly GridCellDiff[];
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

export interface ServerIntegrityReport {
	readonly scope: 'serverProvided';
	readonly generatedAt: number;
	readonly issues: readonly GridIntegrityIssue[];
	readonly complete: boolean;
	readonly totalRowsChecked?: number;
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

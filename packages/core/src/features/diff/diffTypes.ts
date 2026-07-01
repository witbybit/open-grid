export interface GridDiffDataset<TRowData> {
	readonly id: string;
	readonly label: string;
	readonly rows: readonly TRowData[];
	readonly getRowId?: (row: TRowData) => string;
}

export interface GridDiffOptions {
	readonly compareFields?: readonly string[];
	readonly ignoreFields?: readonly string[];
}

export interface GridDiffModel<TRowData> {
	readonly id: string;
	readonly mode: 'inline';
	readonly base: GridDiffDataset<TRowData>;
	readonly compare: GridDiffDataset<TRowData>;
	readonly options?: GridDiffOptions;
}

export interface GridCellDiff {
	readonly rowId: string;
	readonly colField: string;
	readonly oldValue: unknown;
	readonly newValue: unknown;
	readonly status: 'added' | 'removed' | 'changed';
}

export interface GridDiffResult {
	readonly addedRows: readonly string[];
	readonly removedRows: readonly string[];
	readonly changedRows: readonly string[];
	readonly changedCells: readonly GridCellDiff[];
}

export interface GridDiffDiagnostics {
	readonly active: boolean;
	readonly addedRows: number;
	readonly removedRows: number;
	readonly changedRows: number;
	readonly changedCells: number;
	readonly lastComputedAt: number | null;
}

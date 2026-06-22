import type { ColumnDef } from '../../columnDef.js';

export type DataQualityIssueType =
	| 'validation'
	| 'missing'
	| 'duplicate'
	| 'outlier'
	| 'typeMismatch'
	| 'formulaError'
	| 'inconsistentFormat'
	| 'custom';

export interface DataQualityIssue {
	readonly id: string;
	readonly type: DataQualityIssueType;
	readonly severity: 'info' | 'warning' | 'error';
	readonly rowId?: string;
	readonly colField?: string;
	readonly message: string;
	readonly value?: unknown;
	readonly groupKey?: string;
	readonly suggestedFix?: DataQualityFix;
}

export interface DataQualityFix {
	readonly id: string;
	readonly label: string;
	readonly kind: 'setCellValue' | 'batchCellValues' | 'applyTransaction' | 'custom';
}

export interface DataQualityReport {
	readonly id: string;
	readonly generatedAt: number;
	readonly scope: 'loadedRows' | 'filteredRows' | 'selectedRows' | 'allClientRows' | 'serverProvided';

	readonly issues: readonly DataQualityIssue[];

	readonly summary: {
		readonly totalIssues: number;
		readonly errors: number;
		readonly warnings: number;
		readonly infos: number;
	};
}

export interface DataQualityRuleContext<TRowData> {
	readonly rows: readonly TRowData[];
	readonly columns: readonly ColumnDef<TRowData>[];
	readonly getRowId: (row: TRowData) => string;
}

export interface DataQualityRule<TRowData> {
	readonly id: string;
	readonly label: string;

	run(context: DataQualityRuleContext<TRowData>): readonly DataQualityIssue[] | Promise<readonly DataQualityIssue[]>;
}

export interface DataQualityDiagnostics {
	readonly active: boolean;
	readonly scope: string | null;
	readonly totalIssues: number;
	readonly errors: number;
	readonly warnings: number;
	readonly infos: number;
	readonly lastRunAt: number | null;
	readonly lastError: string | null;
}

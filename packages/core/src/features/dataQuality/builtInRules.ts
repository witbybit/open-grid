import type { DataQualityIssue, DataQualityRule, DataQualityRuleContext } from './dataQualityTypes.js';

let _issueSeq = 0;
function nextId(prefix: string): string {
	return `${prefix}-${++_issueSeq}`;
}

function isEmpty(value: unknown): boolean {
	return value === null || value === undefined || value === '';
}

/**
 * Built-in rule: flags cells in columns marked `required: true` that have
 * null / undefined / empty-string values. This is a quality check, not a
 * validator — it does not block edits.
 */
export const missingRequiredRule: DataQualityRule<unknown> = {
	id: '__built_in_missing_required',
	label: 'Missing required values',

	run<TRowData>(context: DataQualityRuleContext<TRowData>): readonly DataQualityIssue[] {
		const requiredCols = context.columns.filter((c) => (c as unknown as { required?: boolean }).required === true);
		if (requiredCols.length === 0) return [];

		const issues: DataQualityIssue[] = [];
		for (const row of context.rows) {
			const rowId = context.getRowId(row);
			for (const col of requiredCols) {
				const value = (row as Record<string, unknown>)[col.field];
				if (isEmpty(value)) {
					issues.push({
						id: nextId('missing'),
						type: 'missing',
						severity: 'error',
						rowId,
						colField: col.field,
						message: `${col.header || col.field} is required`,
						value,
					});
				}
			}
		}
		return issues;
	},
} as DataQualityRule<unknown>;

/**
 * Creates a rule that flags duplicate values in a specific column.
 * All rows sharing the same non-empty value are flagged.
 */
export function createDuplicateValueRule<TRowData>(
	colField: string,
	options?: {
		severity?: 'info' | 'warning' | 'error';
		ignoreEmpty?: boolean;
		label?: string;
	}
): DataQualityRule<TRowData> {
	const severity = options?.severity ?? 'warning';
	const ignoreEmpty = options?.ignoreEmpty ?? true;

	return {
		id: `__built_in_duplicate_${colField}`,
		label: options?.label ?? `Duplicate values in ${colField}`,

		run(context: DataQualityRuleContext<TRowData>): readonly DataQualityIssue[] {
			const valueCounts = new Map<unknown, string[]>();

			for (const row of context.rows) {
				const value = (row as Record<string, unknown>)[colField];
				if (ignoreEmpty && isEmpty(value)) continue;
				const rowId = context.getRowId(row);
				const existing = valueCounts.get(value);
				if (existing) existing.push(rowId);
				else valueCounts.set(value, [rowId]);
			}

			const issues: DataQualityIssue[] = [];
			for (const [value, rowIds] of valueCounts) {
				if (rowIds.length > 1) {
					for (const rowId of rowIds) {
						issues.push({
							id: nextId('duplicate'),
							type: 'duplicate',
							severity,
							rowId,
							colField,
							message: `Duplicate value "${value}" in ${colField}`,
							value,
							groupKey: String(value),
						});
					}
				}
			}
			return issues;
		},
	};
}

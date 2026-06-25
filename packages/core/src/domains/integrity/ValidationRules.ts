import type { RowId } from '../rows/RowId.js';

// ---------------------------------------------------------------------------
// Issue types
// ---------------------------------------------------------------------------

export type IntegritySeverity = 'error' | 'warning' | 'info';

export interface GridIntegrityIssue {
	readonly severity: IntegritySeverity;
	readonly rowId: RowId;
	readonly field: string;
	readonly message: string;
}

// ---------------------------------------------------------------------------
// Cell validator contract
// ---------------------------------------------------------------------------

export interface CellValidatorContext {
	readonly value: unknown;
	readonly rowData: unknown;
	readonly field: string;
	readonly rowId: RowId;
}

export type CellValidator = (ctx: CellValidatorContext) => string | null;

// Returns null for valid, error message string for invalid.

// ---------------------------------------------------------------------------
// Row-level integrity rule
// ---------------------------------------------------------------------------

export interface RowIntegrityRule<TRow = unknown> {
	id: string;
	severity?: IntegritySeverity;
	/** Evaluate the rule against a row. Return null for valid, message for invalid. */
	evaluate: (row: TRow, rowId: RowId) => string | null;
}

// ---------------------------------------------------------------------------
// Built-in cell validators
// ---------------------------------------------------------------------------

export function required(message?: string): CellValidator {
	return ({ value }) => (value == null || value === '' ? (message ?? 'This field is required') : null);
}

export function email(message?: string): CellValidator {
	const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return ({ value }) => {
		if (value == null || value === '') return null;
		return re.test(String(value)) ? null : (message ?? 'Invalid email address');
	};
}

export function minValue(min: number, message?: string): CellValidator {
	return ({ value }) => {
		if (value == null || value === '') return null;
		const n = Number(value);
		if (isNaN(n)) return message ?? `Must be a number >= ${min}`;
		return n >= min ? null : (message ?? `Must be >= ${min}`);
	};
}

export function maxValue(max: number, message?: string): CellValidator {
	return ({ value }) => {
		if (value == null || value === '') return null;
		const n = Number(value);
		if (isNaN(n)) return message ?? `Must be a number <= ${max}`;
		return n <= max ? null : (message ?? `Must be <= ${max}`);
	};
}

export function isNumber(message?: string): CellValidator {
	return ({ value }) => {
		if (value == null || value === '') return null;
		return isNaN(Number(value)) ? (message ?? 'Must be a number') : null;
	};
}

export function isDate(message?: string): CellValidator {
	return ({ value }) => {
		if (value == null || value === '') return null;
		const d = new Date(value as string);
		return isNaN(d.getTime()) ? (message ?? 'Invalid date') : null;
	};
}

export function oneOf(allowed: readonly unknown[], message?: string): CellValidator {
	return ({ value }) => {
		if (value == null || value === '') return null;
		return allowed.includes(value) ? null : (message ?? `Must be one of: ${allowed.join(', ')}`);
	};
}

export function regex(pattern: RegExp, message?: string): CellValidator {
	return ({ value }) => {
		if (value == null || value === '') return null;
		return pattern.test(String(value)) ? null : (message ?? `Value does not match required pattern`);
	};
}

export function customCellRule(fn: (value: unknown, row: unknown) => string | null): CellValidator {
	return ({ value, rowData }) => fn(value, rowData);
}

export function duplicateValueRule(getColumnValues: () => unknown[], message?: string): CellValidator {
	return ({ value }) => {
		if (value == null || value === '') return null;
		const all = getColumnValues();
		const count = all.filter((v) => v === value).length;
		return count > 1 ? (message ?? 'Duplicate value') : null;
	};
}

// Convenience bundle for consumers
export const ValidationRules = {
	required,
	email,
	minValue,
	maxValue,
	isNumber,
	isDate,
	oneOf,
	regex,
	customCellRule,
	duplicateValueRule,
};

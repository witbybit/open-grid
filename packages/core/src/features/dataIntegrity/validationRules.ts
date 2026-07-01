import type { GridCellIntegrityRule, GridIntegrityRuleResult } from './integrityTypes.js';

/**
 * Built-in validation rule helpers.
 * Each returns a GridCellIntegrityRule ready for use in dataIntegrity.validation.cellRules.
 */

export function required<TRowData>(field: string): GridCellIntegrityRule<TRowData> {
	return {
		id: `required:${field}`,
		field,
		severity: 'error',
		blocking: true,
		validate({ value }): GridIntegrityRuleResult | null {
			if (value === null || value === undefined || value === '') {
				return { message: `${field} is required` };
			}
			return null;
		},
	};
}

export function email<TRowData>(field: string): GridCellIntegrityRule<TRowData> {
	return {
		id: `email:${field}`,
		field,
		severity: 'error',
		blocking: true,
		validate({ value }): GridIntegrityRuleResult | null {
			if (value === null || value === undefined || value === '') return null;
			const str = String(value);
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
				return { message: `${field} must be a valid email address`, value };
			}
			return null;
		},
	};
}

export function min<TRowData>(field: string, minValue: number): GridCellIntegrityRule<TRowData> {
	return {
		id: `min:${field}:${minValue}`,
		field,
		severity: 'error',
		blocking: true,
		validate({ value }): GridIntegrityRuleResult | null {
			if (value === null || value === undefined || value === '') return null;
			const n = Number(value);
			if (isNaN(n) || n < minValue) {
				return { message: `${field} must be at least ${minValue}`, value };
			}
			return null;
		},
	};
}

export function max<TRowData>(field: string, maxValue: number): GridCellIntegrityRule<TRowData> {
	return {
		id: `max:${field}:${maxValue}`,
		field,
		severity: 'error',
		blocking: true,
		validate({ value }): GridIntegrityRuleResult | null {
			if (value === null || value === undefined || value === '') return null;
			const n = Number(value);
			if (isNaN(n) || n > maxValue) {
				return { message: `${field} must be at most ${maxValue}`, value };
			}
			return null;
		},
	};
}

export function number<TRowData>(field: string): GridCellIntegrityRule<TRowData> {
	return {
		id: `number:${field}`,
		field,
		severity: 'error',
		blocking: true,
		validate({ value }): GridIntegrityRuleResult | null {
			if (value === null || value === undefined || value === '') return null;
			if (isNaN(Number(value))) {
				return { message: `${field} must be a number`, value };
			}
			return null;
		},
	};
}

export function date<TRowData>(field: string): GridCellIntegrityRule<TRowData> {
	return {
		id: `date:${field}`,
		field,
		severity: 'error',
		blocking: true,
		validate({ value }): GridIntegrityRuleResult | null {
			if (value === null || value === undefined || value === '') return null;
			const d = new Date(value as string | number);
			if (isNaN(d.getTime())) {
				return { message: `${field} must be a valid date`, value };
			}
			return null;
		},
	};
}

export function oneOf<TRowData>(field: string, values: readonly unknown[]): GridCellIntegrityRule<TRowData> {
	return {
		id: `oneOf:${field}`,
		field,
		severity: 'error',
		blocking: true,
		validate({ value }): GridIntegrityRuleResult | null {
			if (!values.includes(value)) {
				return { message: `${field} must be one of: ${values.join(', ')}`, value };
			}
			return null;
		},
	};
}

export function regex<TRowData>(field: string, pattern: RegExp, message?: string): GridCellIntegrityRule<TRowData> {
	return {
		id: `regex:${field}`,
		field,
		severity: 'error',
		blocking: true,
		validate({ value }): GridIntegrityRuleResult | null {
			if (value === null || value === undefined || value === '') return null;
			if (!pattern.test(String(value))) {
				return { message: message ?? `${field} does not match required pattern`, value };
			}
			return null;
		},
	};
}

export function customCellRule<TRowData>(config: GridCellIntegrityRule<TRowData>): GridCellIntegrityRule<TRowData> {
	return config;
}

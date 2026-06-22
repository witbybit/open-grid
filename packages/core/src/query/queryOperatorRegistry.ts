/**
 * Operator registry for the query builder.
 *
 * Wraps the existing TEXT_OPS / NUMBER_OPS / DATE_OPS metadata from filterOperations.ts
 * and adds evaluate functions that operate on raw cell values. The UI uses the registry
 * to populate operator dropdowns; the evaluator uses it at runtime.
 */
import { TEXT_OPS, NUMBER_OPS, DATE_OPS } from '../filterOperations.js';

export interface QueryEvaluateParams {
	readonly cellValue: unknown;
	readonly value?: unknown;
	readonly valueTo?: unknown;
}

export interface QueryOperatorDefinition {
	readonly id: string;
	readonly label: string;
	readonly symbol: string;
	/** Column filter types this operator applies to (e.g. ['text', 'string']). */
	readonly columnTypes: readonly string[];
	/** How many value inputs this operator needs: 0 = none, 1 = one, 2 = two (range), 'many' = array. */
	readonly valueArity: 0 | 1 | 2 | 'many';
	evaluate(params: QueryEvaluateParams): boolean;
}

// ── Low-level evaluate helpers ────────────────────────────────────────────────

function isBlank(v: unknown): boolean {
	return v == null || v === '';
}

function parseCellDate(v: unknown): Date | null {
	if (v == null || v === '') return null;
	if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
	const d = new Date(String(v));
	return isNaN(d.getTime()) ? null : d;
}

function stripTime(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ── Text operator evaluators ─────────────────────────────────────────────────

const TEXT_EVALS: Record<string, (cv: unknown, v: unknown) => boolean> = {
	contains: (cv, v) =>
		String(cv ?? '')
			.toLowerCase()
			.includes(String(v ?? '').toLowerCase()),
	notContains: (cv, v) =>
		!String(cv ?? '')
			.toLowerCase()
			.includes(String(v ?? '').toLowerCase()),
	equals: (cv, v) => String(cv ?? '').toLowerCase() === String(v ?? '').toLowerCase(),
	notEquals: (cv, v) => String(cv ?? '').toLowerCase() !== String(v ?? '').toLowerCase(),
	startsWith: (cv, v) =>
		String(cv ?? '')
			.toLowerCase()
			.startsWith(String(v ?? '').toLowerCase()),
	endsWith: (cv, v) =>
		String(cv ?? '')
			.toLowerCase()
			.endsWith(String(v ?? '').toLowerCase()),
	blank: (cv) => isBlank(cv),
	notBlank: (cv) => !isBlank(cv),
};

// ── Number operator evaluators ───────────────────────────────────────────────

const NUMBER_EVALS: Record<string, (cv: unknown, v: unknown, vt: unknown) => boolean> = {
	equals: (cv, v) => {
		const n = Number(cv);
		return !isNaN(n) && !isBlank(cv) && n === Number(v);
	},
	notEquals: (cv, v) => {
		const n = Number(cv);
		return !isNaN(n) && !isBlank(cv) && n !== Number(v);
	},
	gt: (cv, v) => {
		const n = Number(cv);
		return !isNaN(n) && !isBlank(cv) && n > Number(v);
	},
	gte: (cv, v) => {
		const n = Number(cv);
		return !isNaN(n) && !isBlank(cv) && n >= Number(v);
	},
	lt: (cv, v) => {
		const n = Number(cv);
		return !isNaN(n) && !isBlank(cv) && n < Number(v);
	},
	lte: (cv, v) => {
		const n = Number(cv);
		return !isNaN(n) && !isBlank(cv) && n <= Number(v);
	},
	inRange: (cv, v, vt) => {
		const n = Number(cv);
		if (isNaN(n) || isBlank(cv)) return false;
		return n >= Number(v) && (vt === undefined || vt === null ? true : n <= Number(vt));
	},
	blank: (cv) => isBlank(cv),
	notBlank: (cv) => !isBlank(cv),
};

// ── Date operator evaluators ─────────────────────────────────────────────────

const DATE_EVALS: Record<string, (cv: unknown, v: unknown, vt: unknown) => boolean> = {
	equals: (cv, v) => {
		const d = parseCellDate(cv),
			f = parseCellDate(v);
		return !!d && !!f && stripTime(d).getTime() === stripTime(f).getTime();
	},
	before: (cv, v) => {
		const d = parseCellDate(cv),
			f = parseCellDate(v);
		return !!d && !!f && d < f;
	},
	after: (cv, v) => {
		const d = parseCellDate(cv),
			f = parseCellDate(v);
		return !!d && !!f && d > f;
	},
	inRange: (cv, v, vt) => {
		const d = parseCellDate(cv),
			f = parseCellDate(v);
		if (!d || !f) return false;
		const to = parseCellDate(vt);
		return d >= f && (!to || d <= to);
	},
	blank: (cv) => isBlank(cv),
	notBlank: (cv) => !isBlank(cv),
};

// ── Set/select operator evaluators ───────────────────────────────────────────

const SET_EVALS: Record<string, (cv: unknown, v: unknown) => boolean> = {
	in: (cv, v) => {
		if (!Array.isArray(v) || v.length === 0) return false;
		if (cv == null || cv === '') return v.includes(null);
		const s = String(cv).toLowerCase();
		return v.some((item) => item !== null && String(item).toLowerCase() === s);
	},
	notIn: (cv, v) => {
		if (!Array.isArray(v) || v.length === 0) return true;
		if (cv == null || cv === '') return !v.includes(null);
		const s = String(cv).toLowerCase();
		return !v.some((item) => item !== null && String(item).toLowerCase() === s);
	},
	blank: (cv) => isBlank(cv),
	notBlank: (cv) => !isBlank(cv),
};

// ── Build registry ────────────────────────────────────────────────────────────

const _registry = new Map<string, QueryOperatorDefinition>();

function _reg(def: QueryOperatorDefinition): void {
	_registry.set(`${def.columnTypes[0]}:${def.id}`, def);
}

for (const op of TEXT_OPS) {
	const fn = TEXT_EVALS[op.value];
	if (!fn) continue;
	_reg({
		id: op.value,
		label: op.label,
		symbol: op.symbol,
		columnTypes: ['text', 'string'],
		valueArity: op.noValue ? 0 : 1,
		evaluate: ({ cellValue, value }) => fn(cellValue, value),
	});
}

for (const op of NUMBER_OPS) {
	const fn = NUMBER_EVALS[op.value];
	if (!fn) continue;
	_reg({
		id: op.value,
		label: op.label,
		symbol: op.symbol,
		columnTypes: ['number'],
		valueArity: op.noValue ? 0 : op.range ? 2 : 1,
		evaluate: ({ cellValue, value, valueTo }) => fn(cellValue, value, valueTo),
	});
}

for (const op of DATE_OPS) {
	const fn = DATE_EVALS[op.value];
	if (!fn) continue;
	_reg({
		id: op.value,
		label: op.label,
		symbol: op.symbol,
		columnTypes: ['date'],
		valueArity: op.noValue ? 0 : op.range ? 2 : 1,
		evaluate: ({ cellValue, value, valueTo }) => fn(cellValue, value, valueTo),
	});
}

const SET_OP_META: Record<string, { label: string; symbol: string; arity: 0 | 'many' }> = {
	in: { label: 'In', symbol: '∈', arity: 'many' },
	notIn: { label: 'Not in', symbol: '∉', arity: 'many' },
	blank: { label: 'Is blank', symbol: '∅', arity: 0 },
	notBlank: { label: 'Not blank', symbol: '!∅', arity: 0 },
};

for (const [opId, meta] of Object.entries(SET_OP_META)) {
	const fn = SET_EVALS[opId];
	if (!fn) continue;
	_reg({
		id: opId,
		label: meta.label,
		symbol: meta.symbol,
		columnTypes: ['set', 'select', 'multi-select', 'single-select', 'async-multi-select', 'async-single-select'],
		valueArity: meta.arity,
		evaluate: ({ cellValue, value }) => fn(cellValue, value),
	});
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up an operator by column type + operator id.
 * Returns null when the operator is unknown for the given type.
 * Falls back to text operators when columnType is unknown.
 */
export function getQueryOperator(columnType: string, operatorId: string): QueryOperatorDefinition | null {
	return _registry.get(`${columnType}:${operatorId}`) ?? _registry.get(`text:${operatorId}`) ?? null;
}

/** All operators available for the given column type. */
export function getQueryOperatorsForType(columnType: string): QueryOperatorDefinition[] {
	const results: QueryOperatorDefinition[] = [];
	for (const [key, def] of _registry.entries()) {
		if (key.startsWith(`${columnType}:`)) results.push(def);
	}
	if (results.length === 0) {
		// fall back to text operators for unknown types
		for (const [key, def] of _registry.entries()) {
			if (key.startsWith('text:')) results.push(def);
		}
	}
	return results;
}

export { _registry as _queryOperatorRegistry };

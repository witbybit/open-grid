import type { GridEventListener } from '../../kernel/GridEvent.js';
import type { RowId } from '../rows/RowId.js';
import type { CellValidator, GridIntegrityIssue, IntegritySeverity, RowIntegrityRule } from './ValidationRules.js';

// ---------------------------------------------------------------------------
// Column validation rule registration
// ---------------------------------------------------------------------------

export interface ColumnValidationConfig {
	readonly field: string;
	readonly columnId: string;
	readonly validators: readonly CellValidator[];
	readonly severity?: IntegritySeverity;
}

// ---------------------------------------------------------------------------
// Row data accessor (injected; DataIntegrityManager owns no row storage)
// ---------------------------------------------------------------------------

export interface IntegrityDataPort<TRow> {
	getRowIds(): RowId[];
	getRow(rowId: RowId): TRow | null;
	getCellValue(rowId: RowId, field: string): unknown;
}

// ---------------------------------------------------------------------------
// DataIntegrityManager
// ---------------------------------------------------------------------------

/**
 * Tracks active validation issues across all rows and columns. Re-evaluates on every
 * `rows.replaced` or `rows.changed` kernel event. Issues are queryable by row, cell, or severity.
 */
export class DataIntegrityManager<TRow = unknown> {
	private readonly columnRules: ColumnValidationConfig[] = [];
	private readonly rowRules: RowIntegrityRule<TRow>[] = [];

	// issue store: rowId → field → issue (first error wins per cell)
	private readonly cellIssues = new Map<RowId, Map<string, GridIntegrityIssue>>();
	private readonly rowIssueMessages = new Map<RowId, GridIntegrityIssue[]>();

	private readonly listeners = new Set<() => void>();

	constructor(private readonly port: IntegrityDataPort<TRow>) {}

	// ---------------------------------------------------------------------------
	// Rule registration
	// ---------------------------------------------------------------------------

	addColumnValidation(config: ColumnValidationConfig): void {
		this.columnRules.push(config);
	}

	addRowRule(rule: RowIntegrityRule<TRow>): void {
		this.rowRules.push(rule);
	}

	removeColumnValidation(field: string): void {
		const idx = this.columnRules.findIndex((r) => r.field === field);
		if (idx >= 0) this.columnRules.splice(idx, 1);
	}

	removeRowRule(ruleId: string): void {
		const idx = this.rowRules.findIndex((r) => r.id === ruleId);
		if (idx >= 0) this.rowRules.splice(idx, 1);
	}

	// ---------------------------------------------------------------------------
	// Kernel subscription: auto-revalidate on row changes
	// ---------------------------------------------------------------------------

	/**
	 * Wire this to kernel.subscribe(). Call the returned disposer to unsubscribe.
	 */
	subscribeToKernel(subscribe: (listener: GridEventListener) => () => void): () => void {
		return subscribe((event) => {
			if (event.type === 'rows.replaced' || event.type === 'rows.changed' || event.type === 'cells.changed') {
				this.revalidate();
			}
		});
	}

	// ---------------------------------------------------------------------------
	// Manual revalidation
	// ---------------------------------------------------------------------------

	revalidate(): void {
		this.cellIssues.clear();
		this.rowIssueMessages.clear();

		const rowIds = this.port.getRowIds();

		for (const rowId of rowIds) {
			const row = this.port.getRow(rowId);
			if (!row) continue;

			// Cell-level validation
			for (const colRule of this.columnRules) {
				const value = this.port.getCellValue(rowId, colRule.field);
				for (const validator of colRule.validators) {
					const msg = validator({ value, rowData: row, field: colRule.field, rowId });
					if (msg) {
						const issue: GridIntegrityIssue = {
							severity: colRule.severity ?? 'error',
							rowId,
							field: colRule.field,
							message: msg,
						};
						let rowMap = this.cellIssues.get(rowId);
						if (!rowMap) { rowMap = new Map(); this.cellIssues.set(rowId, rowMap); }
						if (!rowMap.has(colRule.field)) rowMap.set(colRule.field, issue);
						break; // first failing validator per cell
					}
				}
			}

			// Row-level rules
			for (const rule of this.rowRules) {
				const msg = rule.evaluate(row, rowId);
				if (msg) {
					const issue: GridIntegrityIssue = {
						severity: rule.severity ?? 'warning',
						rowId,
						field: '',
						message: msg,
					};
					const existing = this.rowIssueMessages.get(rowId) ?? [];
					existing.push(issue);
					this.rowIssueMessages.set(rowId, existing);
				}
			}
		}

		this.notify();
	}

	// ---------------------------------------------------------------------------
	// Query
	// ---------------------------------------------------------------------------

	getCellIssue(rowId: RowId, field: string): GridIntegrityIssue | null {
		return this.cellIssues.get(rowId)?.get(field) ?? null;
	}

	getRowIssues(rowId: RowId): GridIntegrityIssue[] {
		const cell = Array.from(this.cellIssues.get(rowId)?.values() ?? []);
		const row = this.rowIssueMessages.get(rowId) ?? [];
		return [...cell, ...row];
	}

	getAllIssues(): GridIntegrityIssue[] {
		const out: GridIntegrityIssue[] = [];
		for (const rowMap of this.cellIssues.values()) {
			out.push(...rowMap.values());
		}
		for (const issues of this.rowIssueMessages.values()) {
			out.push(...issues);
		}
		return out;
	}

	getIssuesByField(field: string): GridIntegrityIssue[] {
		return this.getAllIssues().filter((i) => i.field === field);
	}

	getIssuesBySeverity(severity: IntegritySeverity): GridIntegrityIssue[] {
		return this.getAllIssues().filter((i) => i.severity === severity);
	}

	hasIssues(): boolean {
		return this.cellIssues.size > 0 || this.rowIssueMessages.size > 0;
	}

	// ---------------------------------------------------------------------------
	// Change notifications for UI refresh
	// ---------------------------------------------------------------------------

	subscribe = (fn: () => void): (() => void) => {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	};

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}

	destroy(): void {
		this.listeners.clear();
		this.cellIssues.clear();
		this.rowIssueMessages.clear();
	}
}

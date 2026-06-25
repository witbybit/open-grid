import type { RowId } from '../rows/RowId.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComputedColumnDef<TRow = unknown> {
	/** The output field name this rule writes. */
	readonly field: string;
	/** Fields (of other columns) this computation reads. */
	readonly dependencies: readonly string[];
	/** Pure function: receives dependency values + raw row data, returns computed value. */
	readonly compute: (deps: Readonly<Record<string, unknown>>, rowId: RowId, rowData: TRow) => unknown;
}

export interface DagEnginePort<TRow> {
	getLoadedRows(): ReadonlyArray<{ id: RowId; data: TRow }>;
	getCellValue(rowId: RowId, field: string): unknown;
	setCellValue(rowId: RowId, field: string, value: unknown): void;
}

// ---------------------------------------------------------------------------
// DagEngine
// ---------------------------------------------------------------------------

/**
 * Manages computed columns as a dependency DAG. Columns are registered with their
 * source field dependencies; when recompute() is called the engine evaluates them
 * in topological (dependency) order so upstream values are ready before downstream
 * columns read them. Cycle detection short-circuits with an error.
 */
export class DagEngine<TRow = unknown> {
	private readonly defs = new Map<string, ComputedColumnDef<TRow>>();
	/** Memoized topological order (invalidated on add/remove). */
	private _order: string[] | null = null;
	private _hasCycle = false;

	addComputed(def: ComputedColumnDef<TRow>): void {
		this.defs.set(def.field, def);
		this._order = null;
	}

	removeComputed(field: string): void {
		if (this.defs.delete(field)) this._order = null;
	}

	hasComputed(field: string): boolean {
		return this.defs.has(field);
	}

	getComputedFields(): readonly string[] {
		return [...this.defs.keys()];
	}

	hasCycle(): boolean {
		this._ensureOrder();
		return this._hasCycle;
	}

	/**
	 * Compute all computed columns for a single row in topological order.
	 * Returns a map of field → computed value.
	 */
	computeRow(rowId: RowId, data: TRow, getCellValue: (field: string) => unknown): Map<string, unknown> {
		const order = this._ensureOrder();
		const computed = new Map<string, unknown>();

		for (const field of order) {
			const def = this.defs.get(field)!;
			const deps: Record<string, unknown> = {};
			for (const dep of def.dependencies) {
				// Prefer a freshly computed value if available (in-order evaluation)
				deps[dep] = computed.has(dep) ? computed.get(dep) : getCellValue(dep);
			}
			computed.set(field, def.compute(deps, rowId, data));
		}

		return computed;
	}

	/**
	 * Recompute all computed columns for all rows via the port.
	 * Writes results back via `port.setCellValue`.
	 */
	recomputeAll(port: DagEnginePort<TRow>): void {
		if (this.defs.size === 0) return;
		const rows = port.getLoadedRows();
		for (const row of rows) {
			const computed = this.computeRow(row.id, row.data, (field) => port.getCellValue(row.id, field));
			for (const [field, value] of computed) {
				port.setCellValue(row.id, field, value);
			}
		}
	}

	/**
	 * Recompute only the given rows (called after targeted row mutations).
	 */
	recomputeRows(rowIds: ReadonlyArray<RowId>, port: DagEnginePort<TRow>): void {
		if (this.defs.size === 0) return;
		const rows = port.getLoadedRows().filter((r) => rowIds.includes(r.id));
		for (const row of rows) {
			const computed = this.computeRow(row.id, row.data, (field) => port.getCellValue(row.id, field));
			for (const [field, value] of computed) {
				port.setCellValue(row.id, field, value);
			}
		}
	}

	private _ensureOrder(): string[] {
		if (this._order !== null) return this._order;
		const result = topoSort([...this.defs.values()]);
		this._hasCycle = result.hasCycle;
		this._order = result.order;
		return this._order;
	}
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

interface TopoResult {
	order: string[];
	hasCycle: boolean;
}

function topoSort(defs: ComputedColumnDef[]): TopoResult {
	const computedFields = new Set(defs.map((d) => d.field));
	// Build adjacency: dep → [dependents that read dep]
	const adj = new Map<string, string[]>();
	const inDegree = new Map<string, number>();

	for (const def of defs) {
		inDegree.set(def.field, 0);
	}
	for (const def of defs) {
		for (const dep of def.dependencies) {
			if (!computedFields.has(dep)) continue; // external field, not computed
			if (!adj.has(dep)) adj.set(dep, []);
			adj.get(dep)!.push(def.field);
			inDegree.set(def.field, (inDegree.get(def.field) ?? 0) + 1);
		}
	}

	const queue: string[] = [];
	for (const [field, deg] of inDegree) {
		if (deg === 0) queue.push(field);
	}

	const order: string[] = [];
	while (queue.length > 0) {
		const field = queue.shift()!;
		order.push(field);
		for (const dependent of adj.get(field) ?? []) {
			const newDeg = (inDegree.get(dependent) ?? 1) - 1;
			inDegree.set(dependent, newDeg);
			if (newDeg === 0) queue.push(dependent);
		}
	}

	return {
		order,
		hasCycle: order.length < defs.length,
	};
}

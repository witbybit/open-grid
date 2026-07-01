import type { GridInsightLayer, GridCellDecoration, GridRowDecoration } from '../../insights/insightTypes.js';
import type { ColumnDef } from '../../columnDef.js';
import type { GridCellDiff, GridDiffDiagnostics, GridDiffModel, GridDiffResult } from './diffTypes.js';

export type { GridCellDiff, GridDiffDiagnostics, GridDiffModel, GridDiffResult };
export type { GridDiffDataset, GridDiffOptions } from './diffTypes.js';

export interface GridDiffManagerDeps {
	getState: () => { columns: readonly ColumnDef<unknown>[] };
	requestInsightRepaint: () => void;
}

const _EMPTY_DECS: readonly GridCellDecoration[] = [];
const _EMPTY_ROW_DECS: readonly GridRowDecoration[] = [];

export class GridDiffManager<TRowData> implements GridInsightLayer {
	public readonly id = 'diff' as const;

	private model: GridDiffModel<TRowData> | null = null;
	private result: GridDiffResult | null = null;
	private lastComputedAt: number | null = null;

	// Decoration caches keyed by `rowId\0colField` or rowId
	private readonly cellDecMap = new Map<string, GridCellDecoration[]>();
	private readonly rowDecMap = new Map<string, GridRowDecoration[]>();

	// Flat map for getCellDiff lookup
	private readonly cellDiffMap = new Map<string, GridCellDiff>();

	constructor(private readonly deps: GridDiffManagerDeps) {}

	// ── GridInsightLayer ────────────────────────────────────────────────────────

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		return this.cellDecMap.get(`${rowId}\0${colField}`) ?? _EMPTY_DECS;
	}

	getRowDecorations(rowId: string): readonly GridRowDecoration[] {
		return this.rowDecMap.get(rowId) ?? _EMPTY_ROW_DECS;
	}

	getDiagnostics(): GridDiffDiagnostics {
		return {
			active: this.model !== null,
			addedRows: this.result?.addedRows.length ?? 0,
			removedRows: this.result?.removedRows.length ?? 0,
			changedRows: this.result?.changedRows.length ?? 0,
			changedCells: this.result?.changedCells.length ?? 0,
			lastComputedAt: this.lastComputedAt,
		};
	}

	destroy(): void {
		this.clear();
	}

	// ── Public API ──────────────────────────────────────────────────────────────

	setDiffModel(model: GridDiffModel<TRowData> | null): void {
		this.model = model;
		if (model === null) {
			this._clearMaps();
			this.result = null;
			this.lastComputedAt = null;
		} else {
			this._compute(model);
		}
		this.deps.requestInsightRepaint();
	}

	getDiffModel(): GridDiffModel<TRowData> | null {
		return this.model;
	}

	getDiffResult(): GridDiffResult | null {
		return this.result;
	}

	getCellDiff(rowId: string, colField: string): GridCellDiff | null {
		return this.cellDiffMap.get(`${rowId}\0${colField}`) ?? null;
	}

	/**
	 * Removes the diff decoration for a single cell without mutating data.
	 * Used by rejectCellDiff (ignore this change) and acceptCellDiff (after commit).
	 */
	rejectCellDiff(rowId: string, colField: string): void {
		const cellKey = `${rowId}\0${colField}`;
		this.cellDecMap.delete(cellKey);
		this.cellDiffMap.delete(cellKey);
		// Remove from result's changedCells
		if (this.result) {
			const changedCells = this.result.changedCells.filter((c) => !(c.rowId === rowId && c.colField === colField));
			const changedRows = changedCells.some((c) => c.rowId === rowId)
				? this.result.changedRows
				: this.result.changedRows.filter((id) => id !== rowId);
			this.result = { ...this.result, changedCells, changedRows };
			// If no more changed decs for this row, remove the row decoration
			if (!changedRows.includes(rowId)) {
				const rowDecs = this.rowDecMap.get(rowId)?.filter((d) => d.kind !== 'changed') ?? [];
				if (rowDecs.length === 0) this.rowDecMap.delete(rowId);
				else this.rowDecMap.set(rowId, rowDecs);
			}
		}
		this.deps.requestInsightRepaint();
	}

	clear(): void {
		this.model = null;
		this.result = null;
		this.lastComputedAt = null;
		this._clearMaps();
		this.deps.requestInsightRepaint();
	}

	// ── Private ─────────────────────────────────────────────────────────────────

	private _clearMaps(): void {
		this.cellDecMap.clear();
		this.rowDecMap.clear();
		this.cellDiffMap.clear();
	}

	private _compute(model: GridDiffModel<TRowData>): void {
		this._clearMaps();

		const { base, compare, options } = model;

		// Resolve effective row-id getter
		const getBaseRowId = base.getRowId ?? compare.getRowId ?? _defaultId;
		const getCompareRowId = compare.getRowId ?? base.getRowId ?? _defaultId;

		// Build ID → row maps
		const baseMap = new Map<string, TRowData>();
		for (const row of base.rows) baseMap.set(getBaseRowId(row), row);

		const compareMap = new Map<string, TRowData>();
		for (const row of compare.rows) compareMap.set(getCompareRowId(row), row);

		// Resolve columns to compare
		const stateColumns = this.deps.getState().columns;
		let fields: string[];
		if (options?.compareFields?.length) {
			fields = options.compareFields.slice() as string[];
		} else {
			const ignore = new Set(options?.ignoreFields ?? []);
			fields = stateColumns.map((c) => c.field).filter((f) => f && !ignore.has(f)) as string[];
		}

		// Added rows — in compare but not base
		const addedRows: string[] = [];
		for (const id of compareMap.keys()) {
			if (!baseMap.has(id)) addedRows.push(id);
		}

		// Removed rows — in base but not compare
		const removedRows: string[] = [];
		for (const id of baseMap.keys()) {
			if (!compareMap.has(id)) removedRows.push(id);
		}

		// Changed rows/cells — in both, but field values differ
		const changedRows = new Set<string>();
		const changedCells: GridCellDiff[] = [];

		for (const [id, baseRow] of baseMap) {
			const compareRow = compareMap.get(id);
			if (!compareRow) continue; // removed — handled above
			for (const field of fields) {
				const oldValue = (baseRow as Record<string, unknown>)[field];
				const newValue = (compareRow as Record<string, unknown>)[field];
				if (!Object.is(oldValue, newValue)) {
					const diff: GridCellDiff = { rowId: id, colField: field, oldValue, newValue, status: 'changed' };
					changedCells.push(diff);
					changedRows.add(id);
					this.cellDiffMap.set(`${id}\0${field}`, diff);
				}
			}
		}

		this.result = {
			addedRows,
			removedRows,
			changedRows: Array.from(changedRows),
			changedCells,
		};
		this.lastComputedAt = Date.now();

		// Build decoration maps
		for (const cellDiff of changedCells) {
			const key = `${cellDiff.rowId}\0${cellDiff.colField}`;
			let list = this.cellDecMap.get(key);
			if (!list) {
				list = [];
				this.cellDecMap.set(key, list);
			}
			list.push({
				layerId: 'diff',
				kind: 'changed',
				severity: 'warning',
				className: 'og-cell-diff-changed',
				title: `Old: ${_fmt(cellDiff.oldValue)}\nNew: ${_fmt(cellDiff.newValue)}`,
				data: cellDiff,
			});
		}

		for (const rowId of addedRows) {
			this.rowDecMap.set(rowId, [
				{
					layerId: 'diff',
					kind: 'added',
					severity: 'info',
					className: 'og-row-diff-added',
					data: { rowId },
				},
			]);
			// Decorate all visible cells of added row
			for (const field of fields) {
				const key = `${rowId}\0${field}`;
				const compareRow = compareMap.get(rowId);
				const newValue = compareRow ? (compareRow as Record<string, unknown>)[field] : undefined;
				const addedDiff: GridCellDiff = { rowId, colField: field, oldValue: undefined, newValue, status: 'added' };
				this.cellDiffMap.set(key, addedDiff);
				let list = this.cellDecMap.get(key);
				if (!list) {
					list = [];
					this.cellDecMap.set(key, list);
				}
				list.push({
					layerId: 'diff',
					kind: 'added',
					severity: 'info',
					className: 'og-cell-diff-added',
					data: addedDiff,
				});
			}
		}

		// Row decorations for changed rows
		for (const rowId of changedRows) {
			let list = this.rowDecMap.get(rowId);
			if (!list) {
				list = [];
				this.rowDecMap.set(rowId, list);
			}
			list.push({
				layerId: 'diff',
				kind: 'changed',
				severity: 'warning',
				className: 'og-row-diff-changed',
				data: { rowId },
			});
		}
	}
}

function _defaultId(row: unknown): string {
	return JSON.stringify(row);
}

function _fmt(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	return String(value);
}

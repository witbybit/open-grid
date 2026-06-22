import type { GridInsightLayer, GridCellDecoration } from '../../insights/insightTypes.js';
import type { GridCellConflict, ConflictDiagnostics, ResolveConflictOptions } from './conflictTypes.js';

export type { GridCellConflict, ConflictDiagnostics, ResolveConflictOptions };
export type { GridConflictSource } from './conflictTypes.js';

export interface GridConflictManagerDeps {
	setCellValue(rowId: string, colField: string, value: unknown): void;
	requestInsightRepaint(): void;
}

const _EMPTY: readonly GridCellDecoration[] = [];

let _seq = 0;
function nextConflictId(): string {
	return `conflict-${++_seq}`;
}

export class GridConflictManager<TRowData = unknown> implements GridInsightLayer {
	public readonly id = 'conflict' as const;

	private readonly conflicts = new Map<string, GridCellConflict>();
	private readonly cellIndex = new Map<string, string>(); // `rowId\0colField` → conflictId
	private _resolvedConflicts = 0;
	private _lastConflictAt: number | null = null;

	constructor(private readonly deps: GridConflictManagerDeps) {}

	// ── GridInsightLayer ────────────────────────────────────────────────────────

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const id = this.cellIndex.get(`${rowId}\0${colField}`);
		if (!id) return _EMPTY;
		const conflict = this.conflicts.get(id);
		if (!conflict) return _EMPTY;
		return [
			{
				layerId: 'conflict',
				kind: 'conflict',
				severity: 'error',
				className: 'og-cell-conflict',
				title: `Conflict: local ${_fmt(conflict.localValue)} vs remote ${_fmt(conflict.remoteValue)}`,
				data: conflict,
			},
		];
	}

	getDiagnostics(): ConflictDiagnostics {
		return {
			activeConflicts: this.conflicts.size,
			resolvedConflicts: this._resolvedConflicts,
			lastConflictAt: this._lastConflictAt,
		};
	}

	destroy(): void {
		this.clearAllConflicts();
	}

	// ── Public API ──────────────────────────────────────────────────────────────

	addConflict(partial: Omit<GridCellConflict, 'id' | 'createdAt'>): GridCellConflict {
		const cellKey = `${partial.rowId}\0${partial.colField}`;
		// Remove existing conflict for same cell before adding new one
		const existingId = this.cellIndex.get(cellKey);
		if (existingId) this.conflicts.delete(existingId);

		const conflict: GridCellConflict = { ...partial, id: nextConflictId(), createdAt: Date.now() };
		this.conflicts.set(conflict.id, conflict);
		this.cellIndex.set(cellKey, conflict.id);
		this._lastConflictAt = conflict.createdAt;
		this.deps.requestInsightRepaint();
		return conflict;
	}

	getConflicts(): readonly GridCellConflict[] {
		return Array.from(this.conflicts.values());
	}

	getConflict(rowId: string, colField: string): GridCellConflict | null {
		const id = this.cellIndex.get(`${rowId}\0${colField}`);
		return id ? (this.conflicts.get(id) ?? null) : null;
	}

	resolveConflict(conflictId: string, options: ResolveConflictOptions): void {
		const conflict = this.conflicts.get(conflictId);
		if (!conflict) return;

		if (options.strategy === 'remote') {
			this.deps.setCellValue(conflict.rowId, conflict.colField, conflict.remoteValue);
		} else if (options.strategy === 'custom') {
			this.deps.setCellValue(conflict.rowId, conflict.colField, options.value);
		}
		// 'local' strategy: no mutation, just clear

		this._clearConflict(conflictId, conflict);
		this._resolvedConflicts++;
	}

	clearConflict(conflictId: string): void {
		const conflict = this.conflicts.get(conflictId);
		if (!conflict) return;
		this._clearConflict(conflictId, conflict);
	}

	clearAllConflicts(): void {
		this.conflicts.clear();
		this.cellIndex.clear();
		this.deps.requestInsightRepaint();
	}

	// ── Private ─────────────────────────────────────────────────────────────────

	private _clearConflict(id: string, conflict: GridCellConflict): void {
		this.conflicts.delete(id);
		this.cellIndex.delete(`${conflict.rowId}\0${conflict.colField}`);
		this.deps.requestInsightRepaint();
	}
}

function _fmt(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	return String(value);
}

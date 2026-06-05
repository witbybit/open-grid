import type { GridCellPointer } from '../store.js';

export interface InvalidationFrame {
	full: boolean;
	cellsByRowId: Map<string, Set<string>>;
	rows: Set<string>;
	columns: Set<string>;
	headers: boolean;
	overlay: boolean;
	geometry: boolean;
	viewport: boolean;
	reasons: string[];
}

export class InvalidationManager {
	private full = false;
	private cellsByRowId = new Map<string, Set<string>>();
	private rows = new Set<string>();
	private columns = new Set<string>();
	private headers = false;
	private overlay = false;
	private geometry = false;
	private viewport = false;
	private reasons: string[] = [];

	public invalidateFull(reason?: string): void {
		this.full = true;
		this.addReason(reason);
	}

	public invalidateCell(rowId: string, colId: string, reason?: string): void {
		if (!this.full) {
			let cols = this.cellsByRowId.get(rowId);
			if (!cols) {
				cols = new Set<string>();
				this.cellsByRowId.set(rowId, cols);
			}
			cols.add(colId);
		}
		this.addReason(reason);
	}

	public invalidateCells(cells: GridCellPointer[], reason?: string): void {
		for (const cell of cells) {
			this.invalidateCell(cell.rowId, cell.colField, reason);
		}
	}

	public invalidateRow(rowId: string, reason?: string): void {
		if (!this.full) {
			this.rows.add(rowId);
		}
		this.addReason(reason);
	}

	public invalidateRows(rowIds: string[], reason?: string): void {
		for (const rowId of rowIds) {
			this.invalidateRow(rowId, reason);
		}
	}

	public invalidateColumn(colId: string, reason?: string): void {
		if (!this.full) {
			this.columns.add(colId);
		}
		this.addReason(reason);
	}

	public invalidateColumns(colIds: string[], reason?: string): void {
		for (const colId of colIds) {
			this.invalidateColumn(colId, reason);
		}
	}

	public invalidateHeaders(reason?: string): void {
		this.headers = true;
		this.addReason(reason);
	}

	public invalidateOverlay(reason?: string): void {
		this.overlay = true;
		this.addReason(reason);
	}

	public invalidateGeometry(reason?: string): void {
		this.geometry = true;
		this.addReason(reason);
	}

	public invalidateViewport(reason?: string): void {
		this.viewport = true;
		this.addReason(reason);
	}

	public consume(): InvalidationFrame {
		const frame: InvalidationFrame = {
			full: this.full,
			cellsByRowId: this.full ? new Map() : this.cloneCellsByRowId(),
			rows: this.full ? new Set() : new Set(this.rows),
			columns: this.full ? new Set() : new Set(this.columns),
			headers: this.full ? false : this.headers,
			overlay: this.full ? false : this.overlay,
			geometry: this.full ? false : this.geometry,
			viewport: this.full ? false : this.viewport,
			reasons: this.reasons.slice(),
		};
		this.reset();
		return frame;
	}

	private cloneCellsByRowId(): Map<string, Set<string>> {
		const next = new Map<string, Set<string>>();
		for (const [rowId, colIds] of this.cellsByRowId) {
			next.set(rowId, new Set(colIds));
		}
		return next;
	}

	private addReason(reason?: string): void {
		if (reason && !this.reasons.includes(reason)) {
			this.reasons.push(reason);
		}
	}

	private reset(): void {
		this.full = false;
		this.cellsByRowId.clear();
		this.rows.clear();
		this.columns.clear();
		this.headers = false;
		this.overlay = false;
		this.geometry = false;
		this.viewport = false;
		this.reasons = [];
	}
}

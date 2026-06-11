import type { GridCellPointer } from '../store.js';

export type GridInvalidationReason =
	| 'aggDefs'
	| 'cell'
	| 'column order'
	| 'column reorder toggle'
	| 'column resize'
	| 'columns'
	| 'data'
	| 'edit started'
	| 'edit stopped'
	| 'enableStickyGroupRows'
	| 'filter'
	| 'focus'
	| 'geometry'
	| 'groupBy'
	| 'group expansion'
	| 'headers'
	| 'overlay'
	| 'resize'
	| 'row model registered'
	| 'row resize'
	| 'selection'
	| 'set data'
	| 'showGroupFooter'
	| 'sort'
	| 'state'
	| 'style slots'
	| 'viewport'
	| (string & {});

export interface GridInvalidationBase {
	reason?: GridInvalidationReason;
}

export type GridInvalidation =
	| (GridInvalidationBase & { kind: 'full' })
	| (GridInvalidationBase & { kind: 'cell'; rowId: string; colId: string })
	| (GridInvalidationBase & { kind: 'row'; rowId: string })
	| (GridInvalidationBase & { kind: 'row-range'; startIndex: number; endIndex: number })
	| (GridInvalidationBase & { kind: 'column'; colId: string })
	| (GridInvalidationBase & { kind: 'group'; groupId: string })
	| (GridInvalidationBase & { kind: 'headers' })
	| (GridInvalidationBase & { kind: 'overlay' })
	| (GridInvalidationBase & { kind: 'geometry' })
	| (GridInvalidationBase & { kind: 'viewport' });

export interface InvalidatedRowRange {
	startIndex: number;
	endIndex: number;
	reason?: GridInvalidationReason;
}

export interface InvalidationFrame {
	full: boolean;
	cellsByRowId: Map<string, Set<string>>;
	rows: Set<string>;
	rowRanges: InvalidatedRowRange[];
	columns: Set<string>;
	groups: Set<string>;
	headers: boolean;
	overlay: boolean;
	geometry: boolean;
	viewport: boolean;
	reasons: GridInvalidationReason[];
	invalidations: GridInvalidation[];
}

export class InvalidationManager {
	private full = false;
	private cellsByRowId = new Map<string, Set<string>>();
	private rows = new Set<string>();
	private rowRanges: InvalidatedRowRange[] = [];
	private columns = new Set<string>();
	private groups = new Set<string>();
	private headers = false;
	private overlay = false;
	private geometry = false;
	private viewport = false;
	private reasons: GridInvalidationReason[] = [];
	private invalidationKeys = new Set<string>();
	private invalidations: GridInvalidation[] = [];

	public invalidate(invalidation: GridInvalidation): void {
		this.addReason(invalidation.reason);
		this.addInvalidation(this.getInvalidationKey(invalidation), invalidation);

		switch (invalidation.kind) {
			case 'full':
				this.full = true;
				break;
			case 'cell':
				if (!this.full) this.addCell(invalidation.rowId, invalidation.colId);
				break;
			case 'row':
				if (!this.full) this.rows.add(invalidation.rowId);
				break;
			case 'row-range':
				if (!this.full) this.addRowRange(invalidation.startIndex, invalidation.endIndex, invalidation.reason);
				break;
			case 'column':
				if (!this.full) this.columns.add(invalidation.colId);
				break;
			case 'group':
				if (!this.full) this.groups.add(invalidation.groupId);
				break;
			case 'headers':
				if (!this.full) this.headers = true;
				break;
			case 'overlay':
				if (!this.full) this.overlay = true;
				break;
			case 'geometry':
				if (!this.full) this.geometry = true;
				break;
			case 'viewport':
				if (!this.full) this.viewport = true;
				break;
		}
	}

	public invalidateFull(reason?: GridInvalidationReason): void {
		this.full = true;
		this.addReason(reason);
		this.addInvalidation('full', { kind: 'full', reason });
	}

	public invalidateCell(rowId: string, colId: string, reason?: GridInvalidationReason): void {
		if (!this.full) this.addCell(rowId, colId);
		this.addReason(reason);
		if (reason !== 'cell') {
			this.addInvalidation(`cell\0${rowId}\0${colId}`, { kind: 'cell', rowId, colId, reason });
		}
	}

	public invalidateCells(cells: GridCellPointer[], reason?: GridInvalidationReason): void {
		for (const cell of cells) {
			this.invalidateCell(cell.rowId, cell.colField, reason);
		}
	}

	public invalidateRow(rowId: string, reason?: GridInvalidationReason): void {
		if (!this.full) this.rows.add(rowId);
		this.addReason(reason);
		if (reason !== 'cell') {
			this.addInvalidation(`row\0${rowId}`, { kind: 'row', rowId, reason });
		}
	}

	public invalidateRows(rowIds: string[], reason?: GridInvalidationReason): void {
		for (const rowId of rowIds) {
			this.invalidateRow(rowId, reason);
		}
	}

	public invalidateRowRange(startIndex: number, endIndex: number, reason?: GridInvalidationReason): void {
		const range = this.normalizeRowRange(startIndex, endIndex);
		if (!this.full) this.addRowRange(range.startIndex, range.endIndex, reason);
		this.addReason(reason);
		this.addInvalidation(`row-range\0${range.startIndex}\0${range.endIndex}`, { kind: 'row-range', ...range, reason });
	}

	public invalidateColumn(colId: string, reason?: GridInvalidationReason): void {
		if (!this.full) this.columns.add(colId);
		this.addReason(reason);
		this.addInvalidation(`column\0${colId}`, { kind: 'column', colId, reason });
	}

	public invalidateColumns(colIds: string[], reason?: GridInvalidationReason): void {
		for (const colId of colIds) {
			this.invalidateColumn(colId, reason);
		}
	}

	public invalidateGroup(groupId: string, reason?: GridInvalidationReason): void {
		if (!this.full) this.groups.add(groupId);
		this.addReason(reason);
		this.addInvalidation(`group\0${groupId}`, { kind: 'group', groupId, reason });
	}

	public invalidateHeaders(reason?: GridInvalidationReason): void {
		if (!this.full) this.headers = true;
		this.addReason(reason);
		this.addInvalidation('headers', { kind: 'headers', reason });
	}

	public invalidateOverlay(reason?: GridInvalidationReason): void {
		if (!this.full) this.overlay = true;
		this.addReason(reason);
		this.addInvalidation('overlay', { kind: 'overlay', reason });
	}

	public invalidateGeometry(reason?: GridInvalidationReason): void {
		if (!this.full) this.geometry = true;
		this.addReason(reason);
		this.addInvalidation('geometry', { kind: 'geometry', reason });
	}

	public invalidateViewport(reason?: GridInvalidationReason): void {
		if (!this.full) this.viewport = true;
		this.addReason(reason);
		this.addInvalidation('viewport', { kind: 'viewport', reason });
	}

	public consume(): InvalidationFrame {
		const frame: InvalidationFrame = {
			full: this.full,
			cellsByRowId: this.full ? new Map() : this.cloneCellsByRowId(),
			rows: this.full ? new Set() : new Set(this.rows),
			rowRanges: this.full ? [] : this.rowRanges.map((range) => ({ ...range })),
			columns: this.full ? new Set() : new Set(this.columns),
			groups: this.full ? new Set() : new Set(this.groups),
			headers: this.full ? false : this.headers,
			overlay: this.full ? false : this.overlay,
			geometry: this.full ? false : this.geometry,
			viewport: this.full ? false : this.viewport,
			reasons: this.reasons.slice(),
			invalidations: this.invalidations.slice(),
		};
		this.reset();
		return frame;
	}

	private addCell(rowId: string, colId: string): void {
		let cols = this.cellsByRowId.get(rowId);
		if (!cols) {
			cols = new Set<string>();
			this.cellsByRowId.set(rowId, cols);
		}
		cols.add(colId);
	}

	private addRowRange(startIndex: number, endIndex: number, reason?: GridInvalidationReason): void {
		const { startIndex: start, endIndex: end } = this.normalizeRowRange(startIndex, endIndex);
		const existing = this.rowRanges.find((range) => range.startIndex === start && range.endIndex === end);
		if (!existing) {
			this.rowRanges.push({ startIndex: start, endIndex: end, reason });
		}
	}

	private addInvalidation(key: string, invalidation: GridInvalidation): void {
		if (!this.invalidationKeys.has(key)) {
			this.invalidationKeys.add(key);
			this.invalidations.push(
				invalidation.kind === 'row-range'
					? { ...invalidation, ...this.normalizeRowRange(invalidation.startIndex, invalidation.endIndex) }
					: invalidation
			);
		}
	}

	private getInvalidationKey(invalidation: GridInvalidation): string {
		switch (invalidation.kind) {
			case 'cell':
				return `cell\0${invalidation.rowId}\0${invalidation.colId}`;
			case 'row':
				return `row\0${invalidation.rowId}`;
			case 'row-range': {
				const range = this.normalizeRowRange(invalidation.startIndex, invalidation.endIndex);
				return `row-range\0${range.startIndex}\0${range.endIndex}`;
			}
			case 'column':
				return `column\0${invalidation.colId}`;
			case 'group':
				return `group\0${invalidation.groupId}`;
			default:
				return invalidation.kind;
		}
	}

	private normalizeRowRange(startIndex: number, endIndex: number): { startIndex: number; endIndex: number } {
		return {
			startIndex: Math.max(0, Math.min(startIndex, endIndex)),
			endIndex: Math.max(0, Math.max(startIndex, endIndex)),
		};
	}

	private cloneCellsByRowId(): Map<string, Set<string>> {
		const next = new Map<string, Set<string>>();
		for (const [rowId, colIds] of this.cellsByRowId) {
			next.set(rowId, new Set(colIds));
		}
		return next;
	}

	private addReason(reason?: GridInvalidationReason): void {
		if (reason && !this.reasons.includes(reason)) {
			this.reasons.push(reason);
		}
	}

	private reset(): void {
		this.full = false;
		this.cellsByRowId.clear();
		this.rows.clear();
		this.rowRanges = [];
		this.columns.clear();
		this.groups.clear();
		this.headers = false;
		this.overlay = false;
		this.geometry = false;
		this.viewport = false;
		this.reasons = [];
		this.invalidationKeys.clear();
		this.invalidations = [];
	}
}

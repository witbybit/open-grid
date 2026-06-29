import type { CellContentMode } from './cellSlot.js';

export interface CellDisplaySnapshot {
	rowId: string;
	colField: string;
	rowVersion: number;
	globalVersion: number;
	className: string;
	contentMode: CellContentMode;
	formattedValue: string;
	title: string;
	validationError?: string;
}

function buildCellSnapshotKey(rowId: string, colField: string): string {
	return `${rowId}\0${colField}`;
}

export class CellDisplaySnapshotStore {
	private readonly snapshots = new Map<string, CellDisplaySnapshot>();

	public get(rowId: string, colField: string): CellDisplaySnapshot | undefined {
		return this.snapshots.get(buildCellSnapshotKey(rowId, colField));
	}

	public set(snapshot: CellDisplaySnapshot): void {
		this.snapshots.set(buildCellSnapshotKey(snapshot.rowId, snapshot.colField), snapshot);
	}

	public delete(rowId: string, colField: string): void {
		this.snapshots.delete(buildCellSnapshotKey(rowId, colField));
	}

	public clear(): void {
		this.snapshots.clear();
	}
}

import type { CellContentMode } from './cellSlot.js';
import type { GridCellDecoration } from '../insights/insightTypes.js';

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

export interface CellDecorationSnapshotMetadata {
	classNameSuffix: string;
	insightTitle: string;
	validationError?: string;
}

export function collectCellDecorationSnapshotMetadata(decorations: readonly GridCellDecoration[]): CellDecorationSnapshotMetadata {
	let classNameSuffix = '';
	let insightTitle = '';
	let validationError: string | undefined;
	for (const decoration of decorations) {
		if (decoration.className) classNameSuffix += ` ${decoration.className}`;
		if (decoration.title) insightTitle = insightTitle ? `${insightTitle}\n${decoration.title}` : decoration.title;
		if (decoration.kind === 'validationError' && decoration.title) validationError = decoration.title;
	}
	return { classNameSuffix, insightTitle, validationError };
}

export function mergeCellSnapshotTitle(tooltipText: string | null, insightTitle: string): string {
	if (tooltipText && insightTitle) return `${tooltipText}\n${insightTitle}`;
	return tooltipText || insightTitle || '';
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

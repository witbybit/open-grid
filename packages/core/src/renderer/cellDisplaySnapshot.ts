import type { CellContentMode } from './cellSlot.js';
import type { GridCellDecoration } from '../insights/insightTypes.js';

export type CellDisplayContentKind = CellContentMode | 'portal-live' | 'portal-frozen' | 'impostor';

export interface CellDisplaySnapshot {
	rowId: string;
	colField: string;
	rowVersion: number;
	globalVersion: number;
	insightVersion: number;
	baseClassName: string;
	stateClassName: string;
	decorationClassName: string;
	classTokens: readonly string[];
	className: string;
	contentKind: CellDisplayContentKind;
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

function normalizeClassNameSegment(className: string): string {
	return className.trim().split(/\s+/).filter(Boolean).join(' ');
}

function tokenizeClassName(className: string): string[] {
	const normalized = normalizeClassNameSegment(className);
	if (!normalized) return [];
	return normalized.split(' ');
}

export function joinCellSnapshotClassNameParts(...parts: Array<string | undefined>): {
	className: string;
	classTokens: readonly string[];
} {
	const classTokens: string[] = [];
	for (const part of parts) {
		if (!part) continue;
		for (const token of tokenizeClassName(part)) {
			if (!classTokens.includes(token)) classTokens.push(token);
		}
	}
	return { className: classTokens.join(' '), classTokens };
}

export interface CreateCellDisplaySnapshotOptions {
	rowId: string;
	colField: string;
	rowVersion: number;
	globalVersion: number;
	insightVersion: number;
	baseClassName: string;
	stateClassName?: string;
	decorationClassName?: string;
	contentKind: CellDisplayContentKind;
	contentMode: CellContentMode;
	formattedValue: string;
	title: string;
	validationError?: string;
}

export function createCellDisplaySnapshot(options: CreateCellDisplaySnapshotOptions): CellDisplaySnapshot {
	const baseClassName = normalizeClassNameSegment(options.baseClassName);
	const stateClassName = normalizeClassNameSegment(options.stateClassName ?? '');
	const decorationClassName = normalizeClassNameSegment(options.decorationClassName ?? '');
	const { className, classTokens } = joinCellSnapshotClassNameParts(baseClassName, stateClassName, decorationClassName);
	return {
		rowId: options.rowId,
		colField: options.colField,
		rowVersion: options.rowVersion,
		globalVersion: options.globalVersion,
		insightVersion: options.insightVersion,
		baseClassName,
		stateClassName,
		decorationClassName,
		classTokens,
		className,
		contentKind: options.contentKind,
		contentMode: options.contentMode,
		formattedValue: options.formattedValue,
		title: options.title,
		validationError: options.validationError,
	};
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

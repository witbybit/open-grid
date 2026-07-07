import type { GridWriteResult } from './api/GridApi.js';
import type { GridIntegrityIssue } from './features/dataIntegrity/integrityTypes.js';
import type { RowLoadState, RowNodeKind } from './rowModel.js';

export interface RowNodeSelectionOptions {
	clearOthers?: boolean;
	rangeAnchor?: string;
}

export interface GridRowNodeValidationState {
	readonly issues: readonly GridIntegrityIssue[];
	readonly valid: boolean;
}

/**
 * Public row-node facade exposed to consumers.
 *
 * This is intentionally NOT the internal mutable row-model/cache node. Implementations must route
 * writes and refresh/integrity actions back through the grid's authoritative APIs so row version
 * bumps, invalidation, validation, integrity, and renderer refresh ownership remain centralized.
 */
export interface GridRowNode<TRowData = unknown> {
	readonly id: string;
	readonly kind: RowNodeKind;

	readonly data: TRowData | undefined;
	readonly rowIndex: number | null;

	readonly loaded: boolean;
	readonly loading: boolean;
	readonly failed: boolean;
	readonly placeholder: boolean;
	readonly loadState: RowLoadState;

	readonly selectable: boolean;
	readonly selected: boolean;

	readonly expandable: boolean;
	readonly expanded: boolean;

	readonly editable: boolean;

	getData(): TRowData | undefined;
	getValue<TValue = unknown>(field: string): TValue | undefined;
	getDisplayValue(field: string): string;

	setSelected(selected: boolean, options?: RowNodeSelectionOptions): GridWriteResult;
	setExpanded(expanded: boolean): GridWriteResult;
	ensureVisible(position?: 'top' | 'middle' | 'bottom' | 'nearest'): GridWriteResult;

	setData(data: TRowData): GridWriteResult;
	updateData(partial: Partial<TRowData>): GridWriteResult;
	setDataValue(field: string, value: unknown): GridWriteResult;

	refresh(): GridWriteResult;
	retryLoad(): GridWriteResult;

	getValidationState?(): GridRowNodeValidationState;
	validate?(): Promise<GridWriteResult>;
	getIntegrityIssues?(): readonly GridIntegrityIssue[];
	refreshIntegrity?(): Promise<GridWriteResult>;
}

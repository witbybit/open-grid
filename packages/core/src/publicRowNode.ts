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

export interface GridRowNodeFacadeSource<TRowData = unknown> {
	getRowId(data: TRowData): string;
	getRawRowById(rowId: string): TRowData | null;
	getCellValue(rowId: string, field: string): unknown;
	getVisualIndexByRowId(rowId: string): number | null;
	getVisualRowCount(): number;
	getSelectedRowIds(): string[];
	isDetailExpanded(rowId: string): boolean;
	selectRows(rowIds: string[], options?: { mode?: 'add' | 'replace' }): void;
	deselectRows(rowIds: string[]): void;
	scrollToRow(rowId: string, options?: { select?: boolean }): void;
	setCellValue(rowId: string, field: string, value: unknown): GridWriteResult;
	applyTransaction(input: { update?: TRowData[] }): unknown;
	refreshRows(): void;
	getRowModelType(): 'client' | 'infinite' | 'server';
}

function appliedResult(changeId: number): GridWriteResult {
	return { status: 'applied', changeId, faults: [] };
}

function rejectedResult(reason: string): GridWriteResult {
	return { status: 'rejected', reason };
}

export function createGridRowNodeFacade<TRowData>(
	source: GridRowNodeFacadeSource<TRowData>,
	input: {
		id: string;
		kind: RowNodeKind;
		rowIndex: number | null;
		loadState: RowLoadState;
		data?: TRowData;
		selectable?: boolean;
		selected?: boolean;
		expandable?: boolean;
		expanded?: boolean;
		editable?: boolean;
	}
): GridRowNode<TRowData> {
	const getCurrentData = (): TRowData | undefined => source.getRawRowById(input.id) ?? input.data;
	const isWriteableLoadedDataRow = (): boolean => input.kind === 'data' && input.loadState.kind === 'loaded' && getCurrentData() !== undefined;

	return {
		get id() {
			return input.id;
		},
		get kind() {
			return input.kind;
		},
		get data() {
			return getCurrentData();
		},
		get rowIndex() {
			const visualIndex = source.getVisualIndexByRowId(input.id);
			return visualIndex ?? input.rowIndex;
		},
		get loaded() {
			return input.loadState.kind === 'loaded';
		},
		get loading() {
			return input.loadState.kind === 'loading';
		},
		get failed() {
			return input.loadState.kind === 'failed';
		},
		get placeholder() {
			return input.loadState.kind === 'placeholder';
		},
		get loadState() {
			return input.loadState;
		},
		get selectable() {
			return input.selectable ?? input.kind === 'data';
		},
		get selected() {
			return source.getSelectedRowIds().includes(input.id);
		},
		get expandable() {
			return input.expandable ?? false;
		},
		get expanded() {
			return input.expanded ?? source.isDetailExpanded(input.id);
		},
		get editable() {
			return input.editable ?? input.kind === 'data';
		},
		getData() {
			return getCurrentData();
		},
		getValue<TValue = unknown>(field: string): TValue | undefined {
			if (input.loadState.kind !== 'loaded') return undefined;
			return source.getCellValue(input.id, field) as TValue | undefined;
		},
		getDisplayValue(field: string): string {
			const value = this.getValue(field);
			return value == null ? '' : String(value);
		},
		setSelected(selected: boolean): GridWriteResult {
			if (!this.selectable) return rejectedResult(`Row '${input.id}' is not selectable.`);
			if (selected) source.selectRows([input.id], { mode: 'add' });
			else source.deselectRows([input.id]);
			return appliedResult(Date.now());
		},
		setExpanded(expanded: boolean): GridWriteResult {
			if (!this.expandable) return rejectedResult(`Row '${input.id}' is not expandable.`);
			return expanded === this.expanded ? { status: 'noop' } : rejectedResult(`Row '${input.id}' expansion bridge is not implemented yet.`);
		},
		ensureVisible(position?: 'top' | 'middle' | 'bottom' | 'nearest'): GridWriteResult {
			void position;
			source.scrollToRow(input.id);
			return appliedResult(Date.now());
		},
		setData(data: TRowData): GridWriteResult {
			if (!isWriteableLoadedDataRow()) return rejectedResult(`Row '${input.id}' is not writable in its current state.`);
			source.applyTransaction({ update: [data] });
			return appliedResult(Date.now());
		},
		updateData(partial: Partial<TRowData>): GridWriteResult {
			const current = getCurrentData();
			if (!isWriteableLoadedDataRow() || current == null) return rejectedResult(`Row '${input.id}' is not writable in its current state.`);
			source.applyTransaction({ update: [{ ...(current as object), ...(partial as object) } as TRowData] });
			return appliedResult(Date.now());
		},
		setDataValue(field: string, value: unknown): GridWriteResult {
			if (!isWriteableLoadedDataRow()) return rejectedResult(`Row '${input.id}' is not writable in its current state.`);
			return source.setCellValue(input.id, field, value);
		},
		refresh(): GridWriteResult {
			source.refreshRows();
			return appliedResult(Date.now());
		},
		retryLoad(): GridWriteResult {
			return rejectedResult(`Row '${input.id}' does not currently support retryLoad.`);
		},
	};
}

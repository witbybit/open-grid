import type { RowNode } from './rowNode.js';
import type { ColumnDef } from './columnDef.js';
import type { GroupPathItem } from './rows/visualRowIds.js';

export interface DataVisualRow<T> {
	kind: 'data';
	id: string;
	rowId: string;
	node: RowNode<T>;
	depth: number;
	height?: number;
	selectable?: true;
	editable?: true;
}

export interface GroupVisualRow<T> {
	kind: 'group';
	id: string;
	groupId: string;
	field: string;
	key: unknown;
	keyString: string;
	path: GroupPathItem[];
	depth: number;
	expanded: boolean;
	childCount: number;
	leafCount: number;
	aggregateValues?: Record<string, unknown>;
	aggregate?: Record<string, unknown>;
	height?: number;
	selectable?: boolean;
	editable?: false;
}

export interface DetailVisualRow<T> {
	kind: 'detail';
	id: string;
	parentId: string;
	parentRowId?: string;
	depth: number;
	height: number;
	render: unknown;
	selectable?: false;
	editable?: false;
}

export interface FooterVisualRow<T> {
	kind: 'footer';
	id: string;
	parentGroupId: string;
	depth: number;
	aggregateValues?: Record<string, unknown>;
	aggregate?: Record<string, unknown>;
	height?: number;
	editable?: false;
}

export interface LoadingVisualRow {
	kind: 'loading';
	id: string;
	rowIndex: number;
	height?: number;
	editable?: false;
}

export type VisualRow<TRowData = unknown> =
	| DataVisualRow<TRowData>
	| GroupVisualRow<TRowData>
	| DetailVisualRow<TRowData>
	| FooterVisualRow<TRowData>
	| LoadingVisualRow;

export function isDataVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): row is DataVisualRow<TRowData> {
	return row?.kind === 'data';
}

export function isFullWidthVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	return row?.kind === 'detail' || row?.kind === 'loading';
}

export function isSelectableVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	if (row?.kind === 'data') return true;
	if (row?.kind === 'group') return row.selectable !== false;
	return false;
}

export function isEditableVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	return row?.kind === 'data';
}

export function canEditCell<TRowData>(row: VisualRow<TRowData> | null | undefined, column: ColumnDef<TRowData> | null | undefined): boolean {
	return row?.kind === 'data' && !!column;
}

export function canFocusVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	return !!row && row.kind !== 'loading';
}

export function isDataCellSelectable<TRowData>(row: VisualRow<TRowData> | null | undefined, column: ColumnDef<TRowData> | null | undefined): boolean {
	return row?.kind === 'data' && !!column;
}

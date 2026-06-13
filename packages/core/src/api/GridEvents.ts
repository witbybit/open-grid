import type { AggregationDef } from '../rows/stages/aggregateStage.js';
import type { FilterModel, SortModel } from '../rowModel.js';
import type { RowNode } from '../rowNode.js';
import type { GridCellPointer, GridSelectionState, SelectionChangeResult, RowSelectionChangeResult, GridCellClickParams } from './GridApi.js';
import type { ColumnDef } from '../columnDef.js';
import type { RuntimeFault } from '../diagnostics/RuntimeFaultReporter.js';

export interface GridEvent<T = unknown> {
	type: string;
	payload: T;
}

export type GridEventListener<T = unknown> = (event: GridEvent<T>) => void;

export enum GridEventName {
	aggDefsChanged = 'aggDefsChanged',
	cellClicked = 'cellClicked',
	cellInvalidated = 'cellInvalidated',
	cellsCopied = 'cellsCopied',
	cellValueChanged = 'cellValueChanged',
	columnOrderChanged = 'columnOrderChanged',
	columnReorderToggled = 'columnReorderToggled',
	columnResized = 'columnResized',
	columnsChanged = 'columnsChanged',
	editStarted = 'editStarted',
	editStopped = 'editStopped',
	enableStickyGroupRowsChanged = 'enableStickyGroupRowsChanged',
	filterChanged = 'filterChanged',
	focusChanged = 'focusChanged',
	groupByChanged = 'groupByChanged',
	groupColumnAdded = 'groupColumnAdded',
	groupColumnRemoved = 'groupColumnRemoved',
	groupColumnMoved = 'groupColumnMoved',
	renderInvalidated = 'renderInvalidated',
	rowResized = 'rowResized',
	rowSelectionChanged = 'rowSelectionChanged',
	rowsUpdated = 'rowsUpdated',
	runtimeFault = 'runtimeFault',
	selectionChanged = 'selectionChanged',
	paginationChanged = 'paginationChanged',
	serverBlockLoaded = 'serverBlockLoaded',
	serverBlockLoadFailed = 'serverBlockLoadFailed',
	showGroupFooterChanged = 'showGroupFooterChanged',
	sortChanged = 'sortChanged',
}

export interface GridEventPayloadMap<TRowData = unknown> {
	[GridEventName.aggDefsChanged]: { aggDefs: AggregationDef<TRowData>[] | undefined };
	[GridEventName.cellClicked]: GridCellClickParams<TRowData>;
	[GridEventName.cellInvalidated]: { rowId: string; colField: string };
	[GridEventName.cellsCopied]: { cells: Array<{ rowId: string; colField: string }> };
	[GridEventName.cellValueChanged]: { rowId: string; colField: string; oldValue: unknown; newValue: unknown };
	[GridEventName.columnOrderChanged]: { columns: ColumnDef<TRowData>[]; columnFields: string[] };
	[GridEventName.columnReorderToggled]: { enabled: boolean };
	[GridEventName.columnResized]: { colField: string; width: number };
	[GridEventName.columnsChanged]: { columns: ColumnDef<TRowData>[]; columnFields: string[] };
	[GridEventName.editStarted]: { rowId: string; colField: string };
	[GridEventName.editStopped]: { rowId: string; colField: string; cancel: boolean };
	[GridEventName.enableStickyGroupRowsChanged]: { enableStickyGroupRows: boolean | undefined };
	[GridEventName.filterChanged]: { filterModel: FilterModel | null };
	[GridEventName.focusChanged]: { focus: GridCellPointer | null; selection: GridSelectionState };
	[GridEventName.groupByChanged]: { groupBy: string[] | undefined };
	[GridEventName.groupColumnAdded]: { colId: string; index: number; groupBy: string[] };
	[GridEventName.groupColumnRemoved]: { colId: string; groupBy: string[] };
	[GridEventName.groupColumnMoved]: { colId: string; fromIndex: number; toIndex: number; groupBy: string[] };
	[GridEventName.renderInvalidated]: { reason: string };
	[GridEventName.rowResized]: { rowId: string; height: number };
	[GridEventName.rowSelectionChanged]: RowSelectionChangeResult;
	[GridEventName.rowsUpdated]: {
		changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
		changedNodes: RowNode<TRowData>[];
		addedNodes?: RowNode<TRowData>[];
		removedNodes?: RowNode<TRowData>[];
	};
	[GridEventName.paginationChanged]: {
		page: number;
		pageCount: number;
		totalRows: number;
		pageSize: number;
	};
	[GridEventName.runtimeFault]: RuntimeFault;
	[GridEventName.selectionChanged]: { selection: GridSelectionState; result: SelectionChangeResult };
	[GridEventName.serverBlockLoaded]: {
		blockIndex: number;
		loadedBlockStart: number;
		loadedBlockEnd: number;
		totalRecords: number;
		durationMs: number;
	};
	[GridEventName.serverBlockLoadFailed]: {
		blockIndex: number;
		startRow: number;
		endRow: number;
		message: string;
	};
	[GridEventName.showGroupFooterChanged]: { showGroupFooter: boolean | undefined };
	[GridEventName.sortChanged]: { sortModel: SortModel | null };
}

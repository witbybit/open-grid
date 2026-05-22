import type { ColumnDef, GridCellPointer, GridCellRange } from '../store.js';
import type { SortModel, FilterModel } from '../rowModel.js';

export type GridCommandType =
	| 'SET_DATA'
	| 'FOCUS_CELL'
	| 'SELECT_CELL'
	| 'SET_COLUMN_WIDTH'
	| 'SET_ROW_HEIGHT'
	| 'SET_SORT_MODEL'
	| 'SET_FILTER_MODEL'
	| 'SET_CELL_VALUE'
	| 'START_EDIT'
	| 'STOP_EDIT';

export interface GridCommandPayloads<TRowData = any> {
	SET_DATA: {
		columns?: ColumnDef<TRowData>[];
		defaultColWidth?: number;
		defaultRowHeight?: number;
	};
	FOCUS_CELL: {
		rowId: string | null;
		colField: string | null;
	};
	SELECT_CELL: {
		start: GridCellPointer | null;
		end: GridCellPointer | null;
	};
	SET_COLUMN_WIDTH: {
		colField: string;
		width: number;
	};
	SET_ROW_HEIGHT: {
		rowId: string;
		height: number;
	};
	SET_SORT_MODEL: {
		sortModel: SortModel | null;
	};
	SET_FILTER_MODEL: {
		filterModel: FilterModel | null;
	};
	SET_CELL_VALUE: {
		rowId: string;
		colField: string;
		value: unknown;
		undoable?: boolean;
	};
	START_EDIT: {
		rowId: string;
		colField: string;
	};
	STOP_EDIT: {
		cancel?: boolean;
	};
}

export interface GridCommand<T extends GridCommandType = GridCommandType, TRowData = any> {
	type: T;
	payload: GridCommandPayloads<TRowData>[T];
}

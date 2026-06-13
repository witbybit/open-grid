import type { GridEventListener, GridEventPayloadMap } from '../api/GridEvents.js';
import { GridEventName } from '../api/GridEvents.js';
import type { ColumnDef, CompiledGridPlan } from '../columnDef.js';
import type { FormulaCellCoordinate } from '../calculations/dagEngine.js';
import type { GeometryModel } from '../models/GeometryModel.js';
import type { RowModel } from '../rowModel.js';
import type { GridState } from '../state/GridState.js';
import type { RuntimeFault } from '../diagnostics/RuntimeFaultReporter.js';

export interface DataModelRuntime<TRowData = unknown> {
	getState: () => GridState<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	getColumnDef: (colField: string) => ColumnDef<TRowData> | undefined;
	hasFormula: (rowId: string, colField: string) => boolean;
	getFormula: (rowId: string, colField: string) => string | undefined;
	getCachedFormulaValue: (rowId: string, colField: string) => { hasCached: boolean; value: unknown };
	evaluateFormulaCell: (rowId: string, colField: string, getRawValue: (rId: string, cField: string) => unknown) => unknown;
	syncFormulaForCell: (rowId: string, colField: string, value: unknown) => void;
	isScrolling: () => boolean;
	isScrollFrameActive: () => boolean;
	recordGetCellValueDuringScroll: () => void;
	recordValueGetterDuringScroll: () => void;
	recordFormulaDuringScroll: () => void;
}

export interface ColumnModelRuntime<TRowData = unknown> {
	geometry: GeometryModel;
	updateCompiledGetters: (columns: ColumnDef<TRowData>[]) => void;
	getPinnedColumnCounts: () => { left: number; right: number };
	getGeometryVersion: () => number;
}

export interface CellAccessRuntime<TRowData = unknown> {
	getRowModel: () => RowModel<TRowData> | null;
	getColumnIndex: (colField: string) => number;
	getColumnDef: (colField: string) => ColumnDef<TRowData> | undefined;
	getCellValue: (rowId: string, colField: string) => unknown;
	getRawCellValue: (rowId: string, colField: string) => unknown;
	getState: () => GridState<TRowData>;
	isRowSelected: (rowIndex: number) => boolean;
	isRowLoading: (rowId: string) => boolean;
}

export type RowsUpdatedPayload<TRowData = unknown> = GridEventPayloadMap<TRowData>[GridEventName.rowsUpdated];

export interface RowModelRuntimeBase<TRowData = unknown> {
	getState: () => GridState<TRowData>;
	initializeModel: (model: { columns?: ColumnDef<TRowData>[]; getRowId?: ((row: TRowData) => string) | undefined }) => void;
	registerRowModel: (rowModel: RowModel<TRowData>) => void;
	addEventListener: <K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	) => () => void;
	getRowId: (row: TRowData) => string;
	getColumnDef: (colField: string) => ColumnDef<TRowData> | undefined;
	getCellValue: (rowId: string, colField: string) => unknown;
	bumpGlobalVersion: () => void;
	reportRowPipelineFault: (operation: string, error: unknown, context?: Record<string, unknown>) => RuntimeFault;
}

export interface RowModelMutationRuntime<TRowData = unknown> {
	clearFormulas: () => void;
	syncFormulaForCell: (rowId: string, colField: string, value: unknown) => void;
	invalidateFormulaCell: (rowId: string, colField: string) => FormulaCellCoordinate[];
	getValueGetterDependents: (colField: string) => string[];
	hasValueGetter: (colField: string) => boolean;
	notifyBulkCellChange: (changes: Map<string, Set<string>>) => void;
	dispatchRowsUpdated: (payload: RowsUpdatedPayload<TRowData>) => void;
}

export interface ClientRowModelRuntime<TRowData = unknown> extends RowModelRuntimeBase<TRowData>, RowModelMutationRuntime<TRowData> {
	updateExpansion: (updater: (expansion: GridState<TRowData>['expansion']) => GridState<TRowData>['expansion']) => void;
}

export interface ServerRowModelRuntime<TRowData = unknown> extends RowModelRuntimeBase<TRowData> {
	clearFormulas: () => void;
	isScrollingFast: () => boolean;
	getScrollVelocity: () => { vx: number; vy: number };
	setLoadingState: (loading: boolean) => void;
	dispatchServerBlockLoaded: (payload: GridEventPayloadMap<TRowData>[GridEventName.serverBlockLoaded]) => void;
	dispatchServerBlockLoadFailed: (payload: GridEventPayloadMap<TRowData>[GridEventName.serverBlockLoadFailed]) => void;
	dispatchPaginationChanged: (payload: GridEventPayloadMap<TRowData>[GridEventName.paginationChanged]) => void;
	reportBlockLoadFailure: (blockIndex: number, error: unknown) => void;
}

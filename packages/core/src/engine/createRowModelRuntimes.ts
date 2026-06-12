import { GridEventName } from '../api/GridEvents.js';
import type { GridState } from '../state/GridState.js';
import type { GridStore } from '../store.js';
import type { ClientRowModelRuntime, ServerRowModelRuntime } from './runtimePorts.js';

function initializeRowModelState<TRowData>(
	store: GridStore<TRowData>,
	model: { columns?: GridState<TRowData>['columns']; getRowId?: ((row: TRowData) => string) | undefined }
): void {
	const nextState: Partial<GridState<TRowData>> = {};
	if (model.columns) nextState.columns = model.columns;
	if (model.getRowId !== undefined) nextState.getRowId = model.getRowId;
	if (Object.keys(nextState).length > 0) store.setState(nextState);
}

export function createClientRowModelRuntime<TRowData>(store: GridStore<TRowData>): ClientRowModelRuntime<TRowData> {
	return {
		getState: store.getState,
		initializeModel: (model) => initializeRowModelState(store, model),
		registerRowModel: store.registerRowModel,
		addEventListener: store.addEventListener,
		getRowId: store.getRowId,
		getColumnDef: store.getColumnDef,
		getCellValue: store.getCellValue,
		bumpGlobalVersion: () => store.setState((s) => ({ globalVersion: s.globalVersion + 1 })),
		updateExpansion: (updater) => store.setState((s) => ({ expansion: updater(s.expansion) })),
		clearFormulas: () => store.engine.clearFormulas(),
		syncFormulaForCell: (rowId, colField, value) => store.engine.syncFormulaForCell(rowId, colField, value),
		invalidateFormulaCell: (rowId, colField) => store.engine.invalidateFormulaCell(rowId, colField),
		getValueGetterDependents: (colField) => store.engine.getValueGetterDependents(colField),
		hasValueGetter: (colField) => store.engine.hasValueGetter(colField),
		notifyBulkCellChange: (changes) => store.engine.notifyBulkCellChange(changes),
		dispatchRowsUpdated: (payload) => store.dispatchEvent(GridEventName.rowsUpdated, payload),
	};
}

export function createServerRowModelRuntime<TRowData>(store: GridStore<TRowData>): ServerRowModelRuntime<TRowData> {
	return {
		getState: store.getState,
		initializeModel: (model) => initializeRowModelState(store, model),
		registerRowModel: store.registerRowModel,
		addEventListener: store.addEventListener,
		getRowId: store.getRowId,
		getColumnDef: store.getColumnDef,
		getCellValue: store.getCellValue,
		bumpGlobalVersion: () => store.setState((s) => ({ globalVersion: s.globalVersion + 1 })),
		clearFormulas: () => store.engine.clearFormulas(),
		isScrollingFast: () => store.engine.isScrollingFast(),
		getScrollVelocity: () => store.engine.getScrollVelocity(),
		setLoadingState: (loading) => store.setState((s) => ({ loading, globalVersion: s.globalVersion + 1 })),
		dispatchServerBlockLoaded: (payload) => store.dispatchEvent(GridEventName.serverBlockLoaded, payload),
		reportBlockLoadFailure: (blockIndex, error) => console.error(`GridEngine: Failed to fetch row block ${blockIndex}`, error),
	};
}

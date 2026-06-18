import { GridEventName } from '../api/GridEvents.js';
import type { ClientRowModelRuntime, RowModelRuntimeStoreBridge, ServerRowModelRuntime } from './runtimePorts.js';

export function createClientRowModelRuntime<TRowData>(store: RowModelRuntimeStoreBridge<TRowData>): ClientRowModelRuntime<TRowData> {
	return {
		getState: store.getState,
		initializeModel: (model) => store.engine.initializeRowModelState(model),
		registerRowModel: store.registerRowModel,
		addEventListener: store.addEventListener,
		getRowId: store.getRowId,
		getColumnDef: store.getColumnDef,
		getCellValue: store.getCellValue,
		bumpGlobalVersion: () => store.engine.bumpRowModelGlobalVersion(),
		reportRowPipelineFault: (operation, error, context) =>
			store.reportRuntimeFault({
				source: 'row-pipeline',
				operation,
				error,
				context,
			}),
		updateExpansion: (updater) => store.engine.updateExpansionState(updater),
		clearFormulas: () => store.engine.clearFormulas(),
		syncFormulaForCell: (rowId, colField, value) => store.engine.syncFormulaForCell(rowId, colField, value),
		invalidateFormulaCell: (rowId, colField) => store.engine.invalidateFormulaCell(rowId, colField),
		getValueGetterDependents: (colField) => store.engine.getValueGetterDependents(colField),
		hasValueGetter: (colField) => store.engine.hasValueGetter(colField),
		notifyBulkCellChange: (changes) => store.engine.notifyBulkCellChange(changes),
		dispatchRowsUpdated: (payload) => store.dispatchEvent(GridEventName.rowsUpdated, payload),
		getInstrumentation: () => store.getInstrumentation(),
	};
}

export function createServerRowModelRuntime<TRowData>(store: RowModelRuntimeStoreBridge<TRowData>): ServerRowModelRuntime<TRowData> {
	return {
		getState: store.getState,
		initializeModel: (model) => store.engine.initializeRowModelState(model),
		registerRowModel: store.registerRowModel,
		addEventListener: store.addEventListener,
		getRowId: store.getRowId,
		getColumnDef: store.getColumnDef,
		getCellValue: store.getCellValue,
		bumpGlobalVersion: () => store.engine.bumpRowModelGlobalVersion(),
		reportRowPipelineFault: (operation, error, context) =>
			store.reportRuntimeFault({
				source: 'row-pipeline',
				operation,
				error,
				context,
			}),
		clearFormulas: () => store.engine.clearFormulas(),
		isScrollingFast: () => store.engine.isScrollingFast(),
		getScrollVelocity: () => store.engine.getScrollVelocity(),
		setLoadingState: (loading) => store.engine.setRowModelLoadingState(loading),
		dispatchServerBlockLoaded: (payload) => store.dispatchEvent(GridEventName.serverBlockLoaded, payload),
		dispatchServerBlockLoadFailed: (payload) => store.dispatchEvent(GridEventName.serverBlockLoadFailed, payload),
		dispatchPaginationChanged: (payload) => {
			store.engine.setServerPaginationState(payload);
			store.dispatchEvent(GridEventName.paginationChanged, payload);
		},
		reportBlockLoadFailure: (blockIndex, error) =>
			store.reportRuntimeFault({
				source: 'server-row-model',
				operation: 'fetch-block',
				error,
				context: { blockIndex },
			}),
		getInstrumentation: () => store.getInstrumentation(),
	};
}

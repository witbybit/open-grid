import { GridEventName } from '../api/GridEvents.js';
import type { ClientRowModelRuntime, InfiniteRowModelRuntime, RowModelRuntimeStoreBridge, ServerPageRowModelRuntime } from './runtimePorts.js';

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

export function createInfiniteRowModelRuntime<TRowData>(store: RowModelRuntimeStoreBridge<TRowData>): InfiniteRowModelRuntime<TRowData> {
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
		dispatchInfiniteBlockLoaded: (payload) => {
			store.dispatchEvent(GridEventName.infiniteBlockLoaded, payload);
		},
		dispatchInfiniteBlockLoadFailed: (payload) => {
			store.dispatchEvent(GridEventName.infiniteBlockLoadFailed, payload);
		},
		dispatchPaginationChanged: (payload) => {
			store.engine.setServerPaginationState(payload);
			store.dispatchEvent(GridEventName.paginationChanged, payload);
		},
		reportBlockLoadFailure: (blockIndex, error) =>
			store.reportRuntimeFault({
				source: 'infinite-row-model',
				operation: 'fetch-block',
				error,
				context: { blockIndex },
			}),
		getInstrumentation: () => store.getInstrumentation(),
	};
}

export function createServerPageRowModelRuntime<TRowData>(store: RowModelRuntimeStoreBridge<TRowData>): ServerPageRowModelRuntime<TRowData> {
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
		setLoadingState: (loading) => store.engine.setRowModelLoadingState(loading),
		dispatchServerPageLoadingStarted: (payload) => store.dispatchEvent(GridEventName.serverPageLoadingStarted, payload),
		dispatchServerPageLoaded: (payload) => {
			store.dispatchEvent(GridEventName.serverPageLoaded, payload);
			store.dispatchEvent(GridEventName.serverPageChanged, payload);
		},
		dispatchServerPageLoadFailed: (payload) => store.dispatchEvent(GridEventName.serverPageLoadFailed, payload),
		setServerPageState: (state) => store.engine.setServerPageState(state),
		getInstrumentation: () => store.getInstrumentation(),
	};
}

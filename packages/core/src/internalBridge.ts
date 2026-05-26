import type { GridEngine } from './engine/GridEngine.js';
import type { GridApi, InternalGridApi } from './store.js';

export interface InternalGridBridge<TRowData = unknown> {
	__getEngine(): GridEngine<TRowData>;
	__getInternalApi(): InternalGridApi<TRowData>;
}

export function getEngineFromApi<TRowData>(api: GridApi<TRowData>): GridEngine<TRowData> {
	const bridge = api as GridApi<TRowData> & InternalGridBridge<TRowData>;

	if (typeof bridge.__getEngine !== 'function') {
		throw new Error('Invalid OpenGrid api instance.');
	}

	return bridge.__getEngine();
}

export function getInternalApiFromApi<TRowData>(api: GridApi<TRowData>): InternalGridApi<TRowData> {
	const bridge = api as GridApi<TRowData> & InternalGridBridge<TRowData>;

	if (typeof bridge.__getInternalApi !== 'function') {
		throw new Error('Invalid OpenGrid api instance.');
	}

	return bridge.__getInternalApi();
}

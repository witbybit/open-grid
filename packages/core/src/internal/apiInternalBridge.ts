import type { GridApi, GridPluginController } from '../api/GridApi.js';
import type { GridStore } from '../store.js';

const apiStoreMap = new WeakMap<GridApi<unknown>, GridStore<unknown>>();

export function registerGridInternalStore<TRowData>(api: GridApi<TRowData>, store: GridStore<TRowData>): void {
	apiStoreMap.set(api as GridApi<unknown>, store as GridStore<unknown>);
}

export function resolveGridInternalStore<TRowData>(api: GridApi<TRowData>): GridStore<TRowData> {
	const store = apiStoreMap.get(api as GridApi<unknown>);
	if (!store) {
		throw new Error('Invalid GridApi. This API was not created by Open Grid.');
	}
	return store as GridStore<TRowData>;
}

export function resolveGridPluginController<TRowData>(api: GridApi<TRowData>): GridPluginController<TRowData> {
	return resolveGridInternalStore(api).getPluginController();
}

import type { GridApi, GridPluginController, InternalGridApi } from '../api/GridApi.js';
import type { GridEngine } from '../engine/GridEngine.js';

export interface GridInternalRuntime<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	api: InternalGridApi<TRowData>;
	pluginController: GridPluginController<TRowData>;
	setContainerElement(container: HTMLElement): void;
}

const apiRuntimeMap = new WeakMap<GridApi<unknown>, GridInternalRuntime<unknown>>();

export function registerGridInternalRuntime<TRowData>(api: GridApi<TRowData>, runtime: GridInternalRuntime<TRowData>): void {
	apiRuntimeMap.set(api as GridApi<unknown>, runtime as GridInternalRuntime<unknown>);
}

export function resolveGridInternalRuntime<TRowData>(api: GridApi<TRowData>): GridInternalRuntime<TRowData> {
	const runtime = apiRuntimeMap.get(api as GridApi<unknown>);
	if (!runtime) {
		throw new Error('Invalid GridApi. This API was not created by Open Grid.');
	}
	return runtime as GridInternalRuntime<TRowData>;
}

export function resolveGridPluginController<TRowData>(api: GridApi<TRowData>): GridPluginController<TRowData> {
	return resolveGridInternalRuntime(api).pluginController;
}

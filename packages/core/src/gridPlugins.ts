import { GridContextMenuPlugin, type GridContextMenuOptions } from './contextMenu.js';
import type { GridInteractionHandle, GridNavigationOptions } from './interaction/GridInteractionController.js';
import type { GridApi, GridCellPointer } from './api/GridApi.js';
import { resolveGridInteractionController, resolveGridPluginController } from './internal/apiInternalBridge.js';

export type GridNavigationHandle = GridInteractionHandle;

export interface GridContextMenuHandle<TRowData = unknown> {
	setOptions(options: GridContextMenuOptions<TRowData>): void;
	show(rowId: string, colField: string, clientX: number, clientY: number): void;
	showPointer(pointer: GridCellPointer, clientX: number, clientY: number): void;
	dispose(): void;
}

export function registerGridNavigation<TRowData>(api: GridApi<TRowData>, options: GridNavigationOptions = {}): GridNavigationHandle {
	const controller = resolveGridInteractionController(api);
	controller.updateOptions(options);
	return controller;
}

export function registerGridContextMenu<TRowData>(
	api: GridApi<TRowData>,
	options: GridContextMenuOptions<TRowData> = {}
): GridContextMenuHandle<TRowData> {
	const pluginController = resolveGridPluginController(api);
	const plugin = new GridContextMenuPlugin<TRowData>(options);
	pluginController.registerPlugin(plugin);

	return {
		setOptions: (nextOptions) => plugin.setOptions(nextOptions),
		show: (rowId, colField, clientX, clientY) => plugin.show(rowId, colField, clientX, clientY),
		showPointer: (pointer, clientX, clientY) => plugin.showPointer(pointer, clientX, clientY),
		dispose() {
			pluginController.unregisterPlugin(plugin.name);
		},
	};
}

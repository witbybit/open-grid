import { GridContextMenuPlugin, type GridContextMenuOptions } from './contextMenu.js';
import type { GridApi, GridCellPointer } from './api/GridApi.js';
import { resolveGridPluginController } from './internal/apiInternalBridge.js';

export interface GridContextMenuHandle<TRowData = unknown> {
	setOptions(options: GridContextMenuOptions<TRowData>): void;
	show(rowId: string, colField: string, clientX: number, clientY: number): void;
	showPointer(pointer: GridCellPointer, clientX: number, clientY: number): void;
	dispose(): void;
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

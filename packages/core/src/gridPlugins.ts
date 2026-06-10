import { getStoreFromApi } from './createGrid.js';
import { GridContextMenuPlugin, type GridContextMenuOptions } from './contextMenu.js';
import { GridNavigationController, type GridNavigationOptions } from './navigation.js';
import type { GridApi } from './store.js';

export interface GridNavigationHandle {
	handleKeyDown(event: KeyboardEvent): void;
	handleMouseDown(rowId: string, colField: string, event: MouseEvent): void;
	handleClick(rowId: string, colField: string, event: MouseEvent): void;
	handleMouseEnter(rowId: string, colField: string): void;
	handleMouseUp(): void;
	setCellEditing(rowId: string, colField: string, isEditing: boolean): void;
	dispose(): void;
}

export interface GridContextMenuHandle<TRowData = unknown> {
	setOptions(options: GridContextMenuOptions<TRowData>): void;
	show(rowId: string, colField: string, clientX: number, clientY: number): void;
	dispose(): void;
}

export function registerGridNavigation<TRowData>(api: GridApi<TRowData>, options: GridNavigationOptions = {}): GridNavigationHandle {
	const internalApi = getStoreFromApi(api);
	const controller = new GridNavigationController<TRowData>(options);
	internalApi.registerPlugin(controller);

	return {
		handleKeyDown: controller.handleKeyDown,
		handleMouseDown: controller.handleMouseDown,
		handleClick: controller.handleClick,
		handleMouseEnter: controller.handleMouseEnter,
		handleMouseUp: controller.handleMouseUp,
		setCellEditing: controller.setCellEditing.bind(controller),
		dispose() {
			controller.dispose();
			internalApi.unregisterPlugin(controller.name);
		},
	};
}

export function registerGridContextMenu<TRowData>(
	api: GridApi<TRowData>,
	options: GridContextMenuOptions<TRowData> = {}
): GridContextMenuHandle<TRowData> {
	const internalApi = getStoreFromApi(api);
	const plugin = new GridContextMenuPlugin<TRowData>(options);
	internalApi.registerPlugin(plugin);

	return {
		setOptions: (nextOptions) => plugin.setOptions(nextOptions),
		show: (rowId, colField, clientX, clientY) => plugin.show(rowId, colField, clientX, clientY),
		dispose() {
			internalApi.unregisterPlugin(plugin.name);
		},
	};
}

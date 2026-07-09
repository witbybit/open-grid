import { GridEventName, type GridEventPayloadMap } from '../api/GridEvents.js';
import { areCellPointersEqual } from './cellPointer.js';
import type { GridApi, GridCellClickParams, GridCellPointer } from '../api/GridApi.js';
import type { GridCellAccess } from '../api/GridApi.js';
import type { GridInteractionHandle } from './GridInteractionController.js';

export interface GridInteractionEventTarget<TRowData = unknown> {
	cellEl: HTMLElement;
	pointer: GridCellPointer;
	access: GridCellAccess<TRowData> | null;
}

export interface GridInteractionEventRouterDeps<TRowData = unknown> {
	getApi(): GridApi<TRowData>;
	getInteraction(): GridInteractionHandle | null;
	isEventWithinGrid(target: EventTarget | null): boolean;
	resolveCellTarget(event: MouseEvent): GridInteractionEventTarget<TRowData> | null;
	focusCellElement(cellEl: HTMLElement): void;
	isContextMenuEnabled(): boolean;
	showContextMenu(pointer: GridCellPointer, clientX: number, clientY: number): void;
	onCellClick?(params: GridCellClickParams<TRowData>): void;
}

export interface GridInteractionEventRouter {
	handleWindowKeyDown(event: KeyboardEvent): void;
	handleWindowMouseUp(): void;
	handleDocumentMouseDown(event: MouseEvent): void;
	handleContainerFocusIn(event: FocusEvent): void;
	handleContainerFocusOut(event: FocusEvent): void;
	handleContainerMouseDown(event: MouseEvent): void;
	handleContainerMouseOver(event: MouseEvent): void;
	handleContainerClick(event: MouseEvent): void;
	handleContainerDoubleClick(event: MouseEvent): void;
	handleContainerContextMenu(event: MouseEvent): void;
}

export function createGridInteractionEventRouter<TRowData>(deps: GridInteractionEventRouterDeps<TRowData>): GridInteractionEventRouter {
	let isGridActive = false;

	const buildCellClickParams = (target: GridInteractionEventTarget<TRowData>, event: MouseEvent): GridCellClickParams<TRowData> | null => {
		const { access, pointer } = target;
		if (!access) return null;
		return {
			rowId: access.rowId,
			rowIndex: access.rowIndex,
			row: access.row,
			node: access.node,
			colField: access.colField,
			colIndex: access.colIndex,
			column: access.column,
			value: access.value,
			api: deps.getApi(),
			event,
		};
	};

	const dispatchCellClick = (target: GridInteractionEventTarget<TRowData>, event: MouseEvent): void => {
		const params = buildCellClickParams(target, event);
		if (!params) return;
		deps.onCellClick?.(params);
		deps.getApi().dispatchEvent(GridEventName.cellClicked, params as GridEventPayloadMap<TRowData>[GridEventName.cellClicked]);
	};

	return {
		handleWindowKeyDown(event) {
			const interaction = deps.getInteraction();
			if (!interaction) return;
			const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
			if (deps.isEventWithinGrid(activeEl) || isGridActive) {
				interaction.handleKeyDown(event);
			}
		},

		handleWindowMouseUp() {
			deps.getInteraction()?.handleMouseUp();
		},

		handleDocumentMouseDown(event) {
			isGridActive = deps.isEventWithinGrid(event.target);
		},

		handleContainerFocusIn(event) {
			if (deps.isEventWithinGrid(event.target)) {
				isGridActive = true;
			}
		},

		handleContainerFocusOut(event) {
			if (!deps.isEventWithinGrid(event.relatedTarget)) {
				isGridActive = false;
			}
		},

		handleContainerMouseDown(event) {
			const interaction = deps.getInteraction();
			if (!interaction) return;
			const target = deps.resolveCellTarget(event);
			if (!target) return;

			isGridActive = true;
			const state = deps.getApi().getStateSnapshot();
			if (areCellPointersEqual(state.activeEdit, target.pointer)) return;

			const colDef = target.access?.column;
			if (colDef && (colDef.canDrag !== undefined || colDef.disableCellRangeSelection)) return;

			deps.focusCellElement(target.cellEl);
			interaction.handleMouseDown(target.pointer, event);
		},

		handleContainerMouseOver(event) {
			const interaction = deps.getInteraction();
			if (!interaction) return;
			const target = deps.resolveCellTarget(event);
			if (!target) return;
			if (event.relatedTarget && target.cellEl.contains(event.relatedTarget as Node)) return;
			interaction.handleMouseEnter(target.pointer);
		},

		handleContainerClick(event) {
			const target = deps.resolveCellTarget(event);
			if (!target) return;
			dispatchCellClick(target, event);

			const interaction = deps.getInteraction();
			if (!interaction) return;
			const state = deps.getApi().getStateSnapshot();
			if (areCellPointersEqual(state.activeEdit, target.pointer)) return;
			interaction.handleClick(target.pointer, event);
		},

		handleContainerDoubleClick(event) {
			const interaction = deps.getInteraction();
			if (!interaction) return;
			const target = deps.resolveCellTarget(event);
			if (!target) return;

			const state = deps.getApi().getStateSnapshot();
			if (areCellPointersEqual(state.activeEdit, target.pointer)) return;
			interaction.setCellEditing(target.pointer.rowId, target.pointer.columnInstanceId ?? target.pointer.colField, true, 'mouse');
		},

		handleContainerContextMenu(event) {
			if (!deps.isContextMenuEnabled()) return;
			const target = deps.resolveCellTarget(event);
			if (!target) return;
			event.preventDefault();
			deps.showContextMenu(target.pointer, event.clientX, event.clientY);
		},
	};
}

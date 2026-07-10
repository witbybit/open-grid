import type { GridCellPointer } from '../api/GridApi.js';
import type { GridInteractionHandle } from './GridInteractionController.js';

export interface GridViewportInteractionRouterDeps {
	getInteraction(): GridInteractionHandle | null;
	resolveCellPointer(target: Element): GridCellPointer | null;
}

export interface GridViewportInteractionRouter {
	handleViewportMouseDown(event: MouseEvent): void;
	handleViewportClick(event: MouseEvent): void;
}

export function createGridViewportInteractionRouter(deps: GridViewportInteractionRouterDeps): GridViewportInteractionRouter {
	return {
		handleViewportMouseDown(event) {
			deps.getInteraction()?.handleViewportMouseDown(event);
		},

		handleViewportClick(event) {
			const interaction = deps.getInteraction();
			if (!interaction || event.defaultPrevented || event.button !== 0) return;

			const target = event.target as HTMLElement | null;
			if (!target) return;

			const checkbox = target.closest<HTMLInputElement>('input.og-row-checkbox');
			if (checkbox) {
				event.stopPropagation();
				const rowId = checkbox.dataset.rowId;
				if (rowId) interaction.handleRowCheckboxClick(rowId, checkbox.checked, event);
				return;
			}

			if (interaction.isRowSelectionIgnoredTarget(target)) return;

			const pointer = deps.resolveCellPointer(target);
			if (!pointer) return;

			interaction.handleDataRowClick(pointer, event);
		},
	};
}

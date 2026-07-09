import type { ActiveEditState, GridCellPointer, GridSelectionSource, GridSelectionState } from '../api/GridApi.js';
import type { InternalGridState } from '../state/GridState.js';

export interface GridFocusState {
	cell: GridCellPointer | null;
	origin: GridSelectionSource | null;
	version: number;
}

export interface GridEditState {
	active: ActiveEditState | null;
}

export interface GridCellSelectionDomainState {
	selection: GridSelectionState;
}

export interface GridRowSelectionState {
	selectedRowIds: readonly string[];
}

export interface GridInteractionState {
	focus: GridFocusState;
	activeEdit: GridEditState;
	cellSelection: GridCellSelectionDomainState;
	rowSelection: GridRowSelectionState;
}

type InteractionStateReadable<TRowData> = Pick<InternalGridState<TRowData>, 'selection' | 'activeEdit' | 'interaction'> & {
	selectedRowIds: readonly string[];
};

export function buildInteractionState(input: {
	selection: GridSelectionState;
	activeEdit: ActiveEditState | null;
	selectedRowIds: readonly string[];
}): GridInteractionState {
	return {
		focus: {
			cell: input.selection.focus,
			origin: input.selection.focusOrigin ?? input.selection.source ?? null,
			version: input.selection.version ?? 0,
		},
		activeEdit: {
			active: input.activeEdit,
		},
		cellSelection: {
			selection: input.selection,
		},
		rowSelection: {
			selectedRowIds: input.selectedRowIds,
		},
	};
}

export function readInteractionState<TRowData>(state: InteractionStateReadable<TRowData>): GridInteractionState {
	if (isInteractionStateCurrent(state)) {
		return state.interaction!;
	}
	return buildInteractionState({
		selection: state.selection,
		activeEdit: state.activeEdit,
		selectedRowIds: state.selectedRowIds,
	});
}

export function isInteractionStateCurrent<TRowData>(state: InteractionStateReadable<TRowData>): boolean {
	const interaction = state.interaction;
	if (!interaction) return false;
	return (
		interaction.cellSelection.selection === state.selection &&
		interaction.activeEdit.active === state.activeEdit &&
		interaction.rowSelection.selectedRowIds === state.selectedRowIds &&
		interaction.focus.cell === state.selection.focus &&
		interaction.focus.origin === (state.selection.focusOrigin ?? state.selection.source ?? null) &&
		interaction.focus.version === (state.selection.version ?? 0)
	);
}

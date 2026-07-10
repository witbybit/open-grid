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

function normalizeSelectionState(selection: GridSelectionState | undefined): GridSelectionState {
	return (
		selection ?? {
			focus: null,
			anchor: null,
			range: null,
			bounds: null,
			source: 'api',
			focusOrigin: null,
			version: 0,
		}
	);
}

export function buildInteractionState(input: {
	selection?: GridSelectionState;
	activeEdit: ActiveEditState | null;
	selectedRowIds: readonly string[];
}): GridInteractionState {
	const selection = normalizeSelectionState(input.selection);
	return {
		focus: {
			cell: selection.focus,
			origin: selection.focusOrigin ?? selection.source ?? null,
			version: selection.version ?? 0,
		},
		activeEdit: {
			active: input.activeEdit,
		},
		cellSelection: {
			selection,
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
	const selection = normalizeSelectionState(state.selection);
	return (
		interaction.cellSelection.selection === selection &&
		interaction.activeEdit.active === state.activeEdit &&
		interaction.rowSelection.selectedRowIds === state.selectedRowIds &&
		interaction.focus.cell === selection.focus &&
		interaction.focus.origin === (selection.focusOrigin ?? selection.source ?? null) &&
		interaction.focus.version === (selection.version ?? 0)
	);
}

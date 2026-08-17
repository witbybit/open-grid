import type { ActiveEditState, GridCellPointer, GridSelectionState } from '../api/GridApi.js';
import type { ColumnDef } from '../columnDef.js';
import type { CanonicalGridCellPointer } from '../api/GridApi.js';
import type { CanonicalGridSelectionState } from '../interaction/interactionState.js';

export function normalizeInitialSelection<TRowData>(
	selection: GridSelectionState | null,
	columns: readonly ColumnDef<TRowData>[],
	resolveCanonicalCellPointer: (pointer: GridCellPointer | null, columns: readonly ColumnDef<TRowData>[]) => CanonicalGridCellPointer | null,
	createEmptySelection: () => CanonicalGridSelectionState,
	createCellSelection: (pointer: CanonicalGridCellPointer, source: GridSelectionState['source']) => CanonicalGridSelectionState,
	createSelectionRange: (
		start: CanonicalGridCellPointer,
		end: CanonicalGridCellPointer,
		source: GridSelectionState['source']
	) => CanonicalGridSelectionState
): CanonicalGridSelectionState {
	if (!selection) return createEmptySelection();
	const focus = resolveCanonicalCellPointer(selection.focus, columns);
	if (!focus) {
		return {
			...createEmptySelection(),
			source: selection.source,
			focusOrigin: selection.focusOrigin ?? null,
		};
	}
	const anchor = resolveCanonicalCellPointer(selection.anchor, columns);
	const rangeStart = resolveCanonicalCellPointer(selection.range?.start ?? null, columns);
	const rangeEnd = resolveCanonicalCellPointer(selection.range?.end ?? null, columns);
	const normalizedStart = rangeStart ?? anchor;
	if (normalizedStart && rangeEnd) {
		const normalized = createSelectionRange(normalizedStart, rangeEnd, selection.source);
		return {
			...normalized,
			range: { start: normalizedStart, end: rangeEnd },
			focus: rangeEnd,
			focusOrigin: selection.focusOrigin ?? normalized.focusOrigin,
		};
	}
	const normalized = createCellSelection(focus, selection.source);
	return {
		...normalized,
		focusOrigin: selection.focusOrigin ?? normalized.focusOrigin,
	};
}

export function normalizeInitialActiveEdit<TRowData>(
	activeEdit: GridCellPointer | ActiveEditState | null,
	columns: readonly ColumnDef<TRowData>[],
	resolveCanonicalCellPointer: (pointer: GridCellPointer | null, columns: readonly ColumnDef<TRowData>[]) => CanonicalGridCellPointer | null
): ActiveEditState | null {
	if (!activeEdit) return null;
	const pointer = resolveCanonicalCellPointer(activeEdit, columns);
	if (!pointer?.columnInstanceId || !pointer.colId) return null;
	return {
		...activeEdit,
		rowId: pointer.rowId,
		colField: pointer.colField,
		colId: pointer.colId,
		columnInstanceId: pointer.columnInstanceId,
	};
}

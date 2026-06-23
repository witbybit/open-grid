import type { RowId } from '../rows/RowId.js';
import type { SelectionChangeSet } from './SelectionChangeSet.js';
import { EMPTY_SELECTION } from './SelectionState.js';
import type { SelectionState } from './SelectionState.js';

/**
 * Row selection engine (ARCHITECTURE.md §3 R11). Structural: each command computes the next state
 * and returns a {@link SelectionChangeSet}; it publishes nothing. Operates on `RowId`s — never on
 * visual/loading/placeholder rows (R5). Range selection takes an explicit ordered slice from the
 * caller (the visual model owns order), keeping this model independent of the pipeline.
 */
export class SelectionModel {
	private state: SelectionState = EMPTY_SELECTION;

	getState(): SelectionState {
		return this.state;
	}

	isSelected(rowId: RowId): boolean {
		return this.state.selectedRowIds.has(rowId);
	}

	/** Replace (default) or add to the selection. The last id becomes the range anchor. */
	selectRows(rowIds: readonly RowId[], mode: 'replace' | 'add' = 'replace'): SelectionChangeSet {
		const next = mode === 'add' ? new Set(this.state.selectedRowIds) : new Set<RowId>();
		for (const id of rowIds) next.add(id);
		const anchor = rowIds.length > 0 ? rowIds[rowIds.length - 1]! : this.state.anchorRowId;
		return this.commit(next, anchor);
	}

	deselectRows(rowIds: readonly RowId[]): SelectionChangeSet {
		const next = new Set(this.state.selectedRowIds);
		for (const id of rowIds) next.delete(id);
		return this.commit(next, this.state.anchorRowId);
	}

	toggleRow(rowId: RowId): SelectionChangeSet {
		const next = new Set(this.state.selectedRowIds);
		if (next.has(rowId)) {
			next.delete(rowId);
			return this.commit(next, this.state.anchorRowId);
		}
		next.add(rowId);
		return this.commit(next, rowId);
	}

	/** Select exactly the given ordered slice (caller derives it from the visual model). */
	selectRange(orderedRowIds: readonly RowId[]): SelectionChangeSet {
		const next = new Set(orderedRowIds);
		const anchor = this.state.anchorRowId ?? (orderedRowIds.length > 0 ? orderedRowIds[0]! : null);
		return this.commit(next, anchor);
	}

	clear(): SelectionChangeSet {
		return this.commit(new Set<RowId>(), null);
	}

	private commit(nextSelected: Set<RowId>, anchorRowId: RowId | null): SelectionChangeSet {
		const previous = this.state;
		const addedRows: RowId[] = [];
		const removedRows: RowId[] = [];
		for (const id of nextSelected) {
			if (!previous.selectedRowIds.has(id)) addedRows.push(id);
		}
		for (const id of previous.selectedRowIds) {
			if (!nextSelected.has(id)) removedRows.push(id);
		}
		const next: SelectionState = { selectedRowIds: nextSelected, anchorRowId };
		this.state = next;
		return { domain: 'selection', addedRows, removedRows, previous, next };
	}
}

export function isEmptySelectionChange(changeSet: SelectionChangeSet): boolean {
	return changeSet.addedRows.length === 0 && changeSet.removedRows.length === 0;
}

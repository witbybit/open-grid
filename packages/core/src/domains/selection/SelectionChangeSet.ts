import type { GridChangeSet } from '../../kernel/GridChangeSet.js';
import type { RowId } from '../rows/RowId.js';
import type { SelectionState } from './SelectionState.js';

export interface SelectionChangeSet extends GridChangeSet {
	readonly domain: 'selection';
	readonly addedRows: readonly RowId[];
	readonly removedRows: readonly RowId[];
	readonly previous: SelectionState;
	readonly next: SelectionState;
}

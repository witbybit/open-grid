import type { ColumnModel } from '../models/ColumnModel.js';
import type { InternalGridState } from '../state/GridState.js';
import type { GridChange, GridCommitResult } from '../engine/GridChangeApplier.js';

export interface GridFeatureContext<TRowData = unknown> {
	columns: ColumnModel<TRowData>;
	getState: () => InternalGridState<TRowData>;
	applyChange: (change: GridChange<TRowData>) => GridCommitResult;
}

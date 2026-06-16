import type { ColumnModel } from '../models/ColumnModel.js';
import type { GridState } from '../state/GridState.js';
import type { GridChange } from '../engine/GridChangeApplier.js';

export interface GridFeatureContext<TRowData = unknown> {
	columns: ColumnModel<TRowData>;
	getState: () => GridState<TRowData>;
	applyChange: (change: GridChange<TRowData>) => void;
}

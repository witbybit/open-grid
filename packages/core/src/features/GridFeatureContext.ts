import type { StateManager } from '../state/StateManager.js';
import type { InvalidationManager } from '../renderer/invalidationManager.js';
import type { EventBus } from '../events/EventBus.js';
import type { CommandHistory } from '../commands/CommandHistory.js';
import type { ColumnModel } from '../models/ColumnModel.js';
import type { GridChangeApplier } from '../engine/GridChangeApplier.js';

export interface GridFeatureContext<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	columns: ColumnModel<TRowData>;
	invalidation: InvalidationManager;
	eventBus: EventBus<TRowData>;
	changeApplier: GridChangeApplier<TRowData>;
	commandHistory: CommandHistory;
	requestRender: (reason: string) => void;
}

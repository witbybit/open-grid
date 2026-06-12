import type { GridStateUpdater, GridEventPayloadMap } from '../store.js';
import type { StateManager } from '../state/StateManager.js';
import type { InvalidationManager, GridInvalidation } from '../renderer/invalidationManager.js';
import type { EventBus } from '../events/EventBus.js';
import type { CommandHistory } from '../commands/CommandHistory.js';

export interface GridChange<TRowData = unknown> {
	reason: string;
	state?: GridStateUpdater<TRowData>;
	invalidations?: GridInvalidation[];
	events?: Array<{
		type: keyof GridEventPayloadMap<TRowData>;
		payload: GridEventPayloadMap<TRowData>[keyof GridEventPayloadMap<TRowData>];
	}>;
	undo?: GridChange<TRowData>;
	redo?: GridChange<TRowData>;
	requestRender?: boolean;
}

export interface GridChangeApplierDeps<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	invalidation: InvalidationManager;
	eventBus: EventBus<TRowData>;
	commandHistory: CommandHistory;
	requestRender: (reason: string) => void;
}

export class GridChangeApplier<TRowData = unknown> {
	constructor(private readonly deps: GridChangeApplierDeps<TRowData>) {}

	apply(change: GridChange<TRowData>): void {
		// 1. Apply state patch
		if (change.state !== undefined) {
			this.deps.stateManager.setState(change.state);
		}
		// 2. Apply invalidations
		if (change.invalidations) {
			for (const inv of change.invalidations) {
				this.deps.invalidation.invalidate(inv);
			}
		}
		// 3. Dispatch events
		if (change.events) {
			for (const ev of change.events) {
				this.deps.eventBus.dispatchEvent(
					ev.type as keyof GridEventPayloadMap<TRowData>,
					ev.payload as GridEventPayloadMap<TRowData>[keyof GridEventPayloadMap<TRowData>]
				);
			}
		}
		// 4. Register undo/redo
		if (change.undo && change.redo) {
			this.deps.commandHistory.add({
				undo: () => this.apply(change.undo!),
				redo: () => this.apply(change.redo!),
			});
		}
		// 5. Request render (default true)
		if (change.requestRender !== false) {
			this.deps.requestRender(change.reason);
		}
	}
}

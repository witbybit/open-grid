import type { GridEngine } from './GridEngine.js';
import type { StateManager } from '../state/StateManager.js';
import type { CommandBus } from '../commands/CommandBus.js';
import type { EventBus } from '../events/EventBus.js';

export interface GridEngineContext<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	stateManager: StateManager;
	commandBus: CommandBus;
	eventBus: EventBus;
}

import type { GridStateUpdater } from '../state/GridState.js';
import type { GridEventPayloadMap } from '../api/GridEvents.js';
import type { StateManager } from '../state/StateManager.js';
import type { InvalidationManager, GridInvalidation } from '../renderer/invalidationManager.js';
import type { EventBus } from '../events/EventBus.js';
import type { CommandHistory } from '../commands/CommandHistory.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';

export type GridChangeReason =
	| 'columns:set-data'
	| 'columns:resize'
	| 'columns:order'
	| 'columns:reorder-toggle'
	| 'columns:set'
	| 'grouping:set-group-by'
	| 'grouping:add-group-by'
	| 'grouping:remove-group-by'
	| 'grouping:move-group-by'
	| 'grouping:set-agg-defs'
	| 'grouping:set-footer'
	| 'grouping:set-sticky-rows'
	| 'grouping:set-panel'
	| 'selection:set-range'
	| 'selection:rows'
	| 'editing:start'
	| 'editing:stop'
	| 'editing:validation'
	| 'editing:save-failed'
	| 'validation:cell'
	| 'validation:grid'
	| 'validation:clear-all'
	| 'rows:set-sort-model'
	| 'rows:set-filter-model'
	| 'rows:set-pagination-page'
	| 'rows:initialize-model'
	| 'rows:bump-global-version'
	| 'rows:update-expansion'
	| 'rows:set-loading-state'
	| 'rows:set-server-pagination'
	| 'rows:register-model'
	| 'geometry:resize-row'
	| 'geometry:set-row-heights'
	| 'geometry:set-default-row-height'
	| 'columns:set-pinned-counts'
	| 'ui:set-style-rules'
	| 'ui:set-floating-filters'
	| 'ui:set-row-overscan'
	| 'ui:set-col-buffer'
	| 'ui:set-sidebar-panel'
	| 'ui:set-chart-open'
	| 'ui:set-theme';

export interface GridChange<TRowData = unknown> {
	reason: GridChangeReason;
	state?: GridStateUpdater<TRowData>;
	invalidations?: GridInvalidation[];
	/**
	 * Domain version increments to apply after the state patch commits.
	 * Each named domain is incremented exactly once, in order, before events fire.
	 * Declaring domains here is the authoritative path — do not call incrementDomain
	 * separately for changes that go through GridChangeApplier.
	 */
	domains?: ReadonlyArray<keyof GridDomainVersions>;
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
	/** Called once per declared domain after the state patch commits, before events fire. */
	incrementDomain?: (domain: keyof GridDomainVersions) => void;
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
		// 3. Increment declared domain versions — must happen before events so that
		//    any event handler that reads a domain version sees the updated value.
		if (change.domains && this.deps.incrementDomain) {
			for (const domain of change.domains) {
				this.deps.incrementDomain(domain);
			}
		}
		// 4. Dispatch events
		if (change.events) {
			for (const ev of change.events) {
				this.deps.eventBus.dispatchEvent(
					ev.type as keyof GridEventPayloadMap<TRowData>,
					ev.payload as GridEventPayloadMap<TRowData>[keyof GridEventPayloadMap<TRowData>]
				);
			}
		}
		// 5. Register undo/redo
		if (change.undo && change.redo) {
			this.deps.commandHistory.add({
				undo: () => this.apply(change.undo!),
				redo: () => this.apply(change.redo!),
			});
		}
		// 6. Request render (default true)
		if (change.requestRender !== false) {
			this.deps.requestRender(change.reason);
		}
	}
}

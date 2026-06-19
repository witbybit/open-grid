import type { GridState, GridStateUpdater } from '../state/GridState.js';
import type { GridEventPayloadMap } from '../api/GridEvents.js';
import type { StateManager } from '../state/StateManager.js';
import type { InvalidationManager, GridInvalidation } from '../renderer/invalidationManager.js';
import type { EventBus } from '../events/EventBus.js';
import type { CommandHistory } from '../commands/CommandHistory.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import type { RuntimeFault, RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';

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
	| 'ui:set-theme'
	| 'viewport:set-visible-ranges'
	| (string & {});

export type GridChangeEvent<TRowData = unknown, K extends keyof GridEventPayloadMap<TRowData> = keyof GridEventPayloadMap<TRowData>> = {
	[Type in K]: {
		type: Type;
		payload: GridEventPayloadMap<TRowData>[Type];
	};
}[K];

export type GridChangePrecondition<TRowData = unknown> = (state: Readonly<GridState<TRowData>>) => true | string;

export interface GridHistoryMutation<TRowData = unknown> {
	reason: GridChangeReason;
	state?: GridStateUpdater<TRowData>;
	invalidations?: GridInvalidation[];
	domains?: ReadonlyArray<keyof GridDomainVersions>;
	events?: GridChangeEvent<TRowData>[];
	requestRender?: boolean;
}

export interface GridHistoryEntry<TRowData = unknown> {
	undo: GridHistoryMutation<TRowData>;
	redo: GridHistoryMutation<TRowData>;
}

export type GridCommitResult =
	| { status: 'committed'; changeId: number; faults: readonly RuntimeFault[] }
	| { status: 'noop' }
	| { status: 'rejected'; reason: string }
	| { status: 'failed-before-commit'; fault: RuntimeFault };

interface GridCommitRecord<TRowData = unknown> {
	changeId: number;
	reason: GridChangeReason;
	state?: GridStateUpdater<TRowData>;
	invalidations: GridInvalidation[];
	domains: ReadonlyArray<keyof GridDomainVersions>;
	events: GridChangeEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	requestRender: boolean;
}

export interface GridChange<TRowData = unknown> {
	reason: GridChangeReason;
	state?: GridStateUpdater<TRowData>;
	invalidations?: GridInvalidation[];
	// Domain increments are declared on the change and applied by the commit protocol.
	domains?: ReadonlyArray<keyof GridDomainVersions>;
	events?: GridChangeEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	precondition?: GridChangePrecondition<TRowData>;
	requestRender?: boolean;
}

export interface GridChangeApplierDeps<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	invalidation: InvalidationManager;
	eventBus: EventBus<TRowData>;
	commandHistory: CommandHistory;
	requestRender: (reason: string) => void;
	incrementDomain?: (domain: keyof GridDomainVersions) => void;
	faultReporter?: RuntimeFaultReporter<TRowData>;
}

export class GridChangeApplier<TRowData = unknown> {
	private nextChangeId = 1;

	constructor(private readonly deps: GridChangeApplierDeps<TRowData>) {}

	apply(change: GridChange<TRowData>): GridCommitResult {
		const validation = this.validate(change);
		if (validation.status === 'rejected') return validation.result;

		const record = this.toCommitRecord(change);
		if (!record) return { status: 'noop' };

		try {
			// 1. Commit domain state atomically.
			if (record.state !== undefined) {
				this.deps.stateManager.setState(record.state);
			}
		} catch (error) {
			return {
				status: 'failed-before-commit',
				fault: this.reportFault('commit-state', error, { reason: record.reason }),
			};
		}

		const faults: RuntimeFault[] = [];
		const isolate = (operation: string, work: () => void): void => {
			try {
				work();
			} catch (error) {
				faults.push(this.reportFault(operation, error, { reason: record.reason, changeId: record.changeId }));
			}
		};

		// 2. Increment declared domain versions before consumer-visible effects.
		if (record.domains.length > 0 && this.deps.incrementDomain) {
			isolate('publish-domains', () => {
				for (const domain of record.domains) {
					this.deps.incrementDomain!(domain);
				}
			});
		}
		// 3. Apply invalidation plan.
		if (record.invalidations.length > 0) {
			isolate('apply-invalidations', () => {
				for (const invalidation of record.invalidations) {
					this.deps.invalidation.invalidate(invalidation);
				}
			});
		}
		// 4. Register a bounded history record.
		if (record.history) {
			isolate('register-history', () => {
				this.deps.commandHistory.add({
					undo: () => {
						this.applyHistoryMutation(record.history!.undo);
					},
					redo: () => {
						this.applyHistoryMutation(record.history!.redo);
					},
				});
			});
		}
		// 5. Request rendering before user events so listeners cannot block scheduling.
		if (record.requestRender) {
			isolate('request-render', () => {
				this.deps.requestRender(record.reason);
			});
		}
		// 6. Dispatch events after state is durable and render is scheduled.
		if (record.events.length > 0) {
			isolate('dispatch-events', () => {
				for (const event of record.events) {
					this.deps.eventBus.dispatchEvent(event.type, event.payload);
				}
			});
		}

		return { status: 'committed', changeId: record.changeId, faults };
	}

	private validate(change: GridChange<TRowData>): { status: 'ok' } | { status: 'rejected'; result: GridCommitResult } {
		if (!change.precondition) return { status: 'ok' };
		try {
			const result = change.precondition(this.deps.stateManager.getState());
			if (result === true) return { status: 'ok' };
			return { status: 'rejected', result: { status: 'rejected', reason: result } };
		} catch (error) {
			return {
				status: 'rejected',
				result: {
					status: 'failed-before-commit',
					fault: this.reportFault('validate-precondition', error, { reason: change.reason }),
				},
			};
		}
	}

	private toCommitRecord(change: GridChange<TRowData>): GridCommitRecord<TRowData> | null {
		const record: GridCommitRecord<TRowData> = {
			changeId: this.nextChangeId++,
			reason: change.reason,
			state: change.state,
			invalidations: change.invalidations ?? [],
			domains: change.domains ?? [],
			events: change.events ?? [],
			history: change.history,
			requestRender: change.requestRender !== false,
		};

		const hasWork =
			record.state !== undefined ||
			record.invalidations.length > 0 ||
			record.domains.length > 0 ||
			record.events.length > 0 ||
			record.history !== undefined ||
			record.requestRender;

		return hasWork ? record : null;
	}

	private applyHistoryMutation(change: GridHistoryMutation<TRowData>): GridCommitResult {
		return this.apply({
			reason: change.reason,
			state: change.state,
			invalidations: change.invalidations,
			domains: change.domains,
			events: change.events,
			requestRender: change.requestRender,
		});
	}

	private reportFault(operation: string, error: unknown, context?: Record<string, unknown>): RuntimeFault {
		if (this.deps.faultReporter) {
			return this.deps.faultReporter.report({
				source: 'grid-change',
				operation,
				error,
				context,
			});
		}
		return {
			id: -1,
			timestamp: Date.now(),
			source: 'grid-change',
			operation,
			message: error instanceof Error && error.message ? error.message : typeof error === 'string' ? error : 'Unknown runtime fault',
			error,
			context,
		};
	}
}

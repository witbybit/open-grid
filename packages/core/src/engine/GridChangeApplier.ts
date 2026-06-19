import type { InternalGridState, GridStateUpdater } from '../state/GridState.js';
import type { GridEventPayloadMap } from '../api/GridEvents.js';
import type { StateManager } from '../state/StateManager.js';
import type { InvalidationManager, GridInvalidation } from '../renderer/invalidationManager.js';
import type { EventBus } from '../events/EventBus.js';
import type { CommandHistory } from '../commands/CommandHistory.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import type { RuntimeFault, RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';
import type {
	AppliedDomainMutation,
	GridCommitContext,
	GridDomainMutation,
	GridDomainMutationExecutorRegistry,
	PreparedDomainMutation,
} from './GridDomainMutation.js';

export type GridCommitReason =
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
	| 'rows:set-order'
	| 'rows:apply-transaction'
	| 'rows:update-expansion'
	| 'rows:set-loading-state'
	| 'rows:set-server-pagination'
	| 'rows:register-model'
	| 'data:set-cell-value'
	| 'data:set-cell-value:undo'
	| 'data:set-cell-value:redo'
	| 'data:batch-cell-values'
	| 'data:batch-cell-values:undo'
	| 'data:batch-cell-values:redo'
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

export type GridChangeReason = GridCommitReason;

export type GridCommitEvent<TRowData = unknown, K extends keyof GridEventPayloadMap<TRowData> = keyof GridEventPayloadMap<TRowData>> = {
	[Type in K]: {
		type: Type;
		payload: GridEventPayloadMap<TRowData>[Type];
	};
}[K];

export type GridChangeEvent<
	TRowData = unknown,
	K extends keyof GridEventPayloadMap<TRowData> = keyof GridEventPayloadMap<TRowData>,
> = GridCommitEvent<TRowData, K>;

export type GridCommitPrecondition<TRowData = unknown> = (state: Readonly<InternalGridState<TRowData>>) => true | string;
export type GridChangePrecondition<TRowData = unknown> = GridCommitPrecondition<TRowData>;

export interface GridHistoryMutation<TRowData = unknown> {
	reason: GridCommitReason;
	state?: GridStateUpdater<TRowData>;
	run?: () => unknown;
	domainMutations?: readonly GridDomainMutation<TRowData>[];
	invalidations?: GridInvalidation[];
	domains?: ReadonlyArray<keyof GridDomainVersions>;
	events?: GridCommitEvent<TRowData>[];
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
	reason: GridCommitReason;
	state?: GridStateUpdater<TRowData>;
	invalidations: GridInvalidation[];
	domains: ReadonlyArray<keyof GridDomainVersions>;
	events: GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	requestRender: boolean;
}

export interface GridCommit<TRowData = unknown> {
	reason: GridCommitReason;
	state?: GridStateUpdater<TRowData>;
	domainMutations?: readonly GridDomainMutation<TRowData>[];
	invalidations?: GridInvalidation[];
	// Domain increments are declared on the change and applied by the commit protocol.
	domains?: ReadonlyArray<keyof GridDomainVersions>;
	events?: GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	precondition?: GridCommitPrecondition<TRowData>;
	requestRender?: boolean;
}

export interface GridChange<TRowData = unknown> extends GridCommit<TRowData> {}

export interface GridCommitKernelDeps<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	invalidation: InvalidationManager;
	eventBus: EventBus<TRowData>;
	commandHistory: CommandHistory;
	requestRender: (reason: string) => void;
	commitContext?: GridCommitContext<TRowData>;
	domainMutationExecutorRegistry?: GridDomainMutationExecutorRegistry<TRowData>;
	incrementDomain?: (domain: keyof GridDomainVersions) => void;
	faultReporter?: RuntimeFaultReporter<TRowData>;
}

export type GridChangeApplierDeps<TRowData = unknown> = GridCommitKernelDeps<TRowData>;

export class GridCommitKernel<TRowData = unknown> {
	private nextChangeId = 1;

	constructor(private readonly deps: GridCommitKernelDeps<TRowData>) {}

	registerHistory(history: GridHistoryEntry<TRowData>): void {
		this.deps.commandHistory.add({
			undo: () => {
				this.applyHistoryMutation(history.undo);
			},
			redo: () => {
				this.applyHistoryMutation(history.redo);
			},
		});
	}

	commit(change: GridCommit<TRowData>): GridCommitResult {
		const validation = this.validate(change);
		if (validation.status === 'rejected') return validation.result;

		const domainMutationResolution = this.resolveDomainMutations(change);
		if (domainMutationResolution.status !== 'ok') return domainMutationResolution.result;

		const record = this.toCommitRecord(change, domainMutationResolution.appliedMutations);
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

	apply(change: GridChange<TRowData>): GridCommitResult {
		return this.commit(change);
	}

	private validate(change: GridCommit<TRowData>): { status: 'ok' } | { status: 'rejected'; result: GridCommitResult } {
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

	private toCommitRecord(
		change: GridCommit<TRowData>,
		appliedMutations: readonly AppliedDomainMutation<TRowData>[] = []
	): GridCommitRecord<TRowData> | null {
		const mutationState = appliedMutations
			.map((mutation) => mutation.state)
			.filter((state): state is GridStateUpdater<TRowData> => state !== undefined);
		const mergedState =
			mutationState.length === 0
				? change.state
				: mutationState.reduce<GridStateUpdater<TRowData>>((acc, next) => this.composeStateUpdaters(acc, next), change.state ?? {});
		const invalidations = [...appliedMutations.flatMap((mutation) => mutation.invalidations ?? []), ...(change.invalidations ?? [])];
		const domains = [...appliedMutations.flatMap((mutation) => mutation.domains ?? []), ...(change.domains ?? [])];
		const events = [...appliedMutations.flatMap((mutation) => mutation.events ?? []), ...(change.events ?? [])];
		const history = this.mergeHistoryEntries(change.reason, appliedMutations, change.history);
		const semanticWork =
			mergedState !== undefined || invalidations.length > 0 || domains.length > 0 || events.length > 0 || history !== undefined;
		const record: GridCommitRecord<TRowData> = {
			changeId: this.nextChangeId++,
			reason: change.reason,
			state: mergedState,
			invalidations,
			domains,
			events,
			history,
			requestRender:
				change.requestRender === false ? false : semanticWork || appliedMutations.some((mutation) => mutation.requestRender === true),
		};

		const hasWork = semanticWork || record.requestRender;

		return hasWork ? record : null;
	}

	private applyHistoryMutation(change: GridHistoryMutation<TRowData>): GridCommitResult {
		if (change.run) {
			try {
				const result = change.run();
				return this.normalizeHistoryExecutionResult(result);
			} catch (error) {
				return {
					status: 'failed-before-commit',
					fault: this.reportFault('history-run', error, { reason: change.reason }),
				};
			}
		}
		return this.commit({
			reason: change.reason,
			state: change.state,
			domainMutations: change.domainMutations,
			invalidations: change.invalidations,
			domains: change.domains,
			events: change.events,
			requestRender: change.requestRender,
		});
	}

	private resolveDomainMutations(
		change: GridCommit<TRowData>
	): { status: 'ok'; appliedMutations: readonly AppliedDomainMutation<TRowData>[] } | { status: 'rejected'; result: GridCommitResult } {
		if (!change.domainMutations || change.domainMutations.length === 0) {
			return { status: 'ok', appliedMutations: [] };
		}
		if (!this.deps.commitContext || !this.deps.domainMutationExecutorRegistry) {
			return { status: 'rejected', result: { status: 'rejected', reason: 'domain mutation registry unavailable' } };
		}
		if (change.state !== undefined) {
			return { status: 'rejected', result: { status: 'rejected', reason: 'mixed state and domain mutations are not yet supported' } };
		}

		const preparedMutations: PreparedDomainMutation<TRowData>[] = [];
		for (let index = 0; index < change.domainMutations.length; index++) {
			const mutation = change.domainMutations[index]!;
			const executor = this.deps.domainMutationExecutorRegistry.resolve(mutation);
			if (!executor) {
				return {
					status: 'rejected',
					result: { status: 'rejected', reason: `no executor registered for domain mutation "${mutation.kind}"` },
				};
			}
			const validation = executor.validate(mutation as never, this.deps.commitContext);
			if (!validation.ok) {
				return {
					status: 'rejected',
					result: { status: 'rejected', reason: validation.reason },
				};
			}
			preparedMutations.push(executor.prepare(mutation as never, this.deps.commitContext));
		}

		const appliedMutations: AppliedDomainMutation<TRowData>[] = [];
		for (let index = 0; index < change.domainMutations.length; index++) {
			const mutation = change.domainMutations[index]!;
			const executor = this.deps.domainMutationExecutorRegistry.resolve(mutation);
			if (!executor) continue;
			appliedMutations.push(executor.apply(preparedMutations[index] as never, this.deps.commitContext));
		}
		return { status: 'ok', appliedMutations };
	}

	private mergeHistoryEntries(
		reason: GridCommitReason,
		appliedMutations: readonly AppliedDomainMutation<TRowData>[],
		history?: GridHistoryEntry<TRowData>
	): GridHistoryEntry<TRowData> | undefined {
		const mutationHistories = appliedMutations
			.map((mutation) => mutation.history)
			.filter((entry): entry is GridHistoryEntry<TRowData> => entry !== undefined);
		if (mutationHistories.length === 0) return history;
		if (history) return history;
		if (mutationHistories.length === 1) return mutationHistories[0];

		return {
			undo: {
				reason,
				run: () => {
					for (let index = mutationHistories.length - 1; index >= 0; index--) {
						this.applyHistoryMutation(mutationHistories[index]!.undo);
					}
				},
				requestRender: false,
			},
			redo: {
				reason,
				run: () => {
					for (const entry of mutationHistories) {
						this.applyHistoryMutation(entry.redo);
					}
				},
				requestRender: false,
			},
		};
	}

	private composeStateUpdaters(left: GridStateUpdater<TRowData>, right: GridStateUpdater<TRowData>): GridStateUpdater<TRowData> {
		if (typeof left === 'function' || typeof right === 'function') {
			return (state) => {
				const leftValue = typeof left === 'function' ? left(state) : left;
				const baseState = { ...state, ...leftValue };
				const rightValue = typeof right === 'function' ? right(baseState) : right;
				return { ...leftValue, ...rightValue };
			};
		}
		return { ...left, ...right };
	}

	private normalizeHistoryExecutionResult(result: unknown): GridCommitResult {
		if (this.isGridCommitResult(result)) return result;
		return { status: 'committed', changeId: this.nextChangeId++, faults: [] };
	}

	private isGridCommitResult(result: unknown): result is GridCommitResult {
		if (!result || typeof result !== 'object' || !('status' in result)) return false;
		return result.status === 'committed' || result.status === 'noop' || result.status === 'rejected' || result.status === 'failed-before-commit';
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

export class GridChangeApplier<TRowData = unknown> extends GridCommitKernel<TRowData> {}

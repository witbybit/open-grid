import { GridEventName } from '../api/GridEvents.js';
import type { RowDataTransaction, RowNodeTransaction } from '../api/GridApi.js';
import type { RowModel } from '../rowModel.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import type { InternalGridState, GridStateUpdater } from '../state/GridState.js';
import type { GridInvalidation } from '../renderer/invalidationManager.js';
import type { GridCommitEvent, GridCommitReason, GridHistoryEntry } from './GridChangeApplier.js';

export type GridDomain = keyof GridDomainVersions;

export interface CellValueMutation {
	kind: 'cell-value';
	rowId: string;
	colField: string;
	value: unknown;
}

export interface BatchCellMutation {
	kind: 'batch-cell';
	updates: ReadonlyArray<{ rowId: string; colField: string; value: unknown }>;
	atomic?: boolean;
}

export interface RowTransactionMutation<TRowData = unknown> {
	kind: 'row-transaction';
	transaction: RowDataTransaction<TRowData>;
}

export interface RowOrderMutation {
	kind: 'row-order';
	rowIds: string[];
	emitEvent?: boolean;
}

export type GridDomainMutation<TRowData = unknown> = CellValueMutation | BatchCellMutation | RowTransactionMutation<TRowData> | RowOrderMutation;

export interface GridMutationRejection {
	mutationKind: GridDomainMutation['kind'];
	reason: string;
	index?: number;
}

export type GridMutationValidationResult = { ok: true } | { ok: false; reason: string; rejection?: GridMutationRejection };

export interface GridCommitContext<TRowData = unknown> {
	getState(): Readonly<InternalGridState<TRowData>>;
	getRowModel(): RowModel<TRowData> | null;
}

export interface PreparedDomainMutation<TRowData = unknown, TMutation extends GridDomainMutation<TRowData> = GridDomainMutation<TRowData>> {
	mutation: TMutation;
	noop?: boolean;
	state?: GridStateUpdater<TRowData>;
	invalidations?: readonly GridInvalidation[];
	domains?: readonly GridDomain[];
	events?: readonly GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	requestRender?: boolean;
}

export interface AppliedDomainMutation<TRowData = unknown> {
	noop?: boolean;
	state?: GridStateUpdater<TRowData>;
	invalidations?: readonly GridInvalidation[];
	domains?: readonly GridDomain[];
	events?: readonly GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	requestRender?: boolean;
	result?: unknown;
}

export interface GridDomainMutationExecutor<TRowData = unknown, TMutation extends GridDomainMutation<TRowData> = GridDomainMutation<TRowData>> {
	validate(mutation: TMutation, context: GridCommitContext<TRowData>): GridMutationValidationResult;
	prepare(mutation: TMutation, context: GridCommitContext<TRowData>): PreparedDomainMutation<TRowData, TMutation>;
	apply(prepared: PreparedDomainMutation<TRowData, TMutation>, context: GridCommitContext<TRowData>): AppliedDomainMutation<TRowData>;
}

export interface GridDomainMutationExecutorRegistry<TRowData = unknown> {
	resolve<TMutation extends GridDomainMutation<TRowData>>(mutation: TMutation): GridDomainMutationExecutor<TRowData, TMutation> | null;
}

function areRowOrdersEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createRowOrderHistory<TRowData>(reason: GridCommitReason, currentOrder: string[], nextOrder: string[]): GridHistoryEntry<TRowData> {
	return {
		undo: {
			reason,
			domainMutations: [{ kind: 'row-order', rowIds: currentOrder, emitEvent: true }],
			requestRender: false,
		},
		redo: {
			reason,
			domainMutations: [{ kind: 'row-order', rowIds: nextOrder, emitEvent: true }],
			requestRender: false,
		},
	};
}

export function createRowOrderMutationExecutor<TRowData = unknown>(
	reason: GridCommitReason = 'rows:set-order'
): GridDomainMutationExecutor<TRowData, RowOrderMutation> {
	return {
		validate(_mutation, context) {
			const rowModel = context.getRowModel();
			if (!rowModel?.setRowOrder || !rowModel.getRowOrder) {
				return {
					ok: false,
					reason: 'row model unavailable',
					rejection: { mutationKind: 'row-order', reason: 'row model unavailable' },
				};
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			const rowModel = context.getRowModel();
			if (!rowModel?.getRowOrder) {
				return { mutation, noop: true };
			}
			const currentOrder = rowModel.getRowOrder();
			const nextOrder = mutation.rowIds.slice();
			if (areRowOrdersEqual(currentOrder, nextOrder)) {
				return { mutation, noop: true };
			}
			return {
				mutation: { ...mutation, rowIds: nextOrder },
				domains: ['rows'],
				invalidations: [{ kind: 'full', reason: 'row order changed' }],
				events: mutation.emitEvent === false ? [] : [{ type: GridEventName.rowOrderChanged, payload: { rowIds: nextOrder } }],
				history: createRowOrderHistory(reason, currentOrder, nextOrder),
				requestRender: true,
			};
		},
		apply(prepared, context) {
			if (prepared.noop) return { noop: true };
			const rowModel = context.getRowModel();
			rowModel?.setRowOrder?.(prepared.mutation.rowIds);
			return {
				noop: false,
				state: prepared.state,
				domains: prepared.domains,
				invalidations: prepared.invalidations,
				events: prepared.events,
				history: prepared.history,
				requestRender: prepared.requestRender,
			};
		},
	};
}

export function createDefaultGridDomainMutationExecutorRegistry<TRowData = unknown>(): GridDomainMutationExecutorRegistry<TRowData> {
	const rowOrderExecutor = createRowOrderMutationExecutor<TRowData>();
	const rowTransactionExecutor: GridDomainMutationExecutor<TRowData, RowTransactionMutation<TRowData>> = {
		validate(_mutation, context) {
			const rowModel = context.getRowModel();
			if (!rowModel?.applyTransaction) {
				return {
					ok: false,
					reason: 'row model unavailable',
					rejection: { mutationKind: 'row-transaction', reason: 'row model unavailable' },
				};
			}
			return { ok: true };
		},
		prepare(mutation) {
			const transaction = mutation.transaction;
			const hasWork = (transaction.add?.length ?? 0) > 0 || (transaction.remove?.length ?? 0) > 0 || (transaction.update?.length ?? 0) > 0;
			if (!hasWork) {
				return { mutation, noop: true };
			}
			return {
				mutation,
				requestRender: false,
			};
		},
		apply(prepared, context) {
			if (prepared.noop) {
				return {
					noop: true,
					result: { add: [], remove: [], update: [] } satisfies RowNodeTransaction<TRowData>,
				};
			}
			const rowModel = context.getRowModel();
			const result = rowModel?.applyTransaction?.(prepared.mutation.transaction) ?? { add: [], remove: [], update: [] };
			return {
				noop: false,
				requestRender: false,
				result,
			};
		},
	};
	return {
		resolve(mutation) {
			if (mutation.kind === 'row-order') {
				return rowOrderExecutor as GridDomainMutationExecutor<TRowData, typeof mutation>;
			}
			if (mutation.kind === 'row-transaction') {
				return rowTransactionExecutor as GridDomainMutationExecutor<TRowData, typeof mutation>;
			}
			return null;
		},
	};
}

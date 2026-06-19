import { GridEventName } from '../api/GridEvents.js';
import type { RowDataTransaction, RowNodeTransaction } from '../api/GridApi.js';
import type { RowModel } from '../rowModel.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import type { InternalGridState, GridStateUpdater } from '../state/GridState.js';
import type { GridInvalidation } from '../renderer/invalidationManager.js';
import type { GridCommitEvent, GridCommitReason, GridHistoryEntry } from './GridChangeApplier.js';
import type { BatchCellValueUpdate, CellValueChangeOptions, CellValueChangeResult } from '../features/DataMutationController.js';

export type GridDomain = keyof GridDomainVersions;

export interface CellValueMutation {
	kind: 'cell-value';
	rowId: string;
	colField: string;
	value: unknown;
	undoable?: boolean;
	source?: CellValueChangeOptions['source'];
}

export interface BatchCellMutation {
	kind: 'batch-cell';
	updates: ReadonlyArray<BatchCellValueUpdate>;
	atomic?: boolean;
	undoable?: boolean;
	source?: CellValueChangeOptions['source'];
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
	applyCellValueChange?: (rowId: string, colField: string, value: unknown, options?: CellValueChangeOptions) => CellValueChangeResult;
	applyBatchCellValues?: (
		updates: BatchCellValueUpdate[],
		options?: Pick<CellValueChangeOptions, 'undoable' | 'source'>
	) => CellValueChangeResult[];
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

export function createCellValueMutationHistory<TRowData>(
	reason: GridCommitReason,
	rowId: string,
	colField: string,
	oldValue: unknown,
	newValue: unknown
): GridHistoryEntry<TRowData> {
	return {
		undo: {
			reason,
			domainMutations: [{ kind: 'cell-value', rowId, colField, value: oldValue, undoable: false, source: 'undo' }],
			requestRender: false,
		},
		redo: {
			reason,
			domainMutations: [{ kind: 'cell-value', rowId, colField, value: newValue, undoable: false, source: 'redo' }],
			requestRender: false,
		},
	};
}

export function createBatchCellMutationHistory<TRowData>(
	reason: GridCommitReason,
	updates: ReadonlyArray<{ rowId: string; colField: string; oldValue: unknown; newValue: unknown }>
): GridHistoryEntry<TRowData> {
	return {
		undo: {
			reason,
			domainMutations: [
				{
					kind: 'batch-cell',
					updates: updates.map((update) => ({ rowId: update.rowId, colField: update.colField, value: update.oldValue })),
					undoable: false,
					source: 'undo',
				},
			],
			requestRender: false,
		},
		redo: {
			reason,
			domainMutations: [
				{
					kind: 'batch-cell',
					updates: updates.map((update) => ({ rowId: update.rowId, colField: update.colField, value: update.newValue })),
					undoable: false,
					source: 'redo',
				},
			],
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
	const cellValueExecutor: GridDomainMutationExecutor<TRowData, CellValueMutation> = {
		validate(_mutation, context) {
			if (!context.applyCellValueChange) {
				return {
					ok: false,
					reason: 'cell mutation runtime unavailable',
					rejection: { mutationKind: 'cell-value', reason: 'cell mutation runtime unavailable' },
				};
			}
			return { ok: true };
		},
		prepare(mutation) {
			return { mutation, requestRender: false };
		},
		apply(prepared, context) {
			if (!context.applyCellValueChange) return { noop: true };
			const result = context.applyCellValueChange(prepared.mutation.rowId, prepared.mutation.colField, prepared.mutation.value, {
				undoable: false,
				source: prepared.mutation.source ?? 'api',
			});
			return {
				noop: !result.applied,
				history:
					result.applied && prepared.mutation.undoable !== false
						? createCellValueMutationHistory<TRowData>(
								'data:set-cell-value',
								prepared.mutation.rowId,
								prepared.mutation.colField,
								result.oldRawValue,
								prepared.mutation.value
							)
						: undefined,
				requestRender: false,
				result,
			};
		},
	};
	const batchCellExecutor: GridDomainMutationExecutor<TRowData, BatchCellMutation> = {
		validate(mutation, context) {
			if (!context.applyBatchCellValues) {
				return {
					ok: false,
					reason: 'batch cell mutation runtime unavailable',
					rejection: { mutationKind: 'batch-cell', reason: 'batch cell mutation runtime unavailable' },
				};
			}
			if (mutation.atomic === false) {
				return {
					ok: false,
					reason: 'non-atomic batch cell mutations are not yet supported',
					rejection: { mutationKind: 'batch-cell', reason: 'non-atomic batch cell mutations are not yet supported' },
				};
			}
			return { ok: true };
		},
		prepare(mutation) {
			return { mutation, requestRender: false };
		},
		apply(prepared, context) {
			if (!context.applyBatchCellValues) return { noop: true };
			const results = context.applyBatchCellValues(prepared.mutation.updates.slice(), {
				undoable: false,
				source: prepared.mutation.source ?? 'api',
			});
			const applied = results.filter((result) => result.applied);
			return {
				noop: applied.length === 0,
				history:
					applied.length > 0 && prepared.mutation.undoable !== false
						? createBatchCellMutationHistory<TRowData>(
								'data:batch-cell-values',
								applied.map((result) => ({
									rowId: result.rowId,
									colField: result.colField,
									oldValue: result.oldRawValue,
									newValue: result.newRawValue,
								}))
							)
						: undefined,
				requestRender: false,
				result: results,
			};
		},
	};
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
			if (mutation.kind === 'cell-value') {
				return cellValueExecutor as GridDomainMutationExecutor<TRowData, typeof mutation>;
			}
			if (mutation.kind === 'batch-cell') {
				return batchCellExecutor as GridDomainMutationExecutor<TRowData, typeof mutation>;
			}
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

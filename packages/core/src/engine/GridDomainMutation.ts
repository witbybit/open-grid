import { GridEventName } from '../api/GridEvents.js';
import type { BatchCellValueUpdate, GridCellPointer, RowDataTransaction, RowNodeTransaction } from '../api/GridApi.js';
import {
	asCellValueWritableRowModel,
	asRowOrderCapableModel,
	asTransactionalRowModel,
	asClientMutableRowModel,
	type RowModel,
	type RowOrderCapableModel,
	type RowModelTransactionSnapshot,
	type TransactionalRowModel,
} from '../rowModel.js';
import type { ColumnDef } from '../columnDef.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import type { InternalGridState, GridStateUpdater } from '../state/GridState.js';
import type { GridInvalidation } from '../renderer/invalidationManager.js';
import type { GridCommitEvent, GridCommitReason, GridHistoryEntry } from './GridChangeApplier.js';
import type { CellValueChangeOptions, CellValueChangeResult } from '../features/DataMutationController.js';

export type GridDomain = keyof GridDomainVersions;

export interface CellValueMutation {
	kind: 'cell-value';
	rowId: string;
	colField: string;
	value: unknown;
	undoable?: boolean;
	bypassValueSetter?: boolean;
	source?: CellValueChangeOptions['source'];
}

export interface BatchCellMutation {
	kind: 'batch-cell';
	updates: ReadonlyArray<BatchCellValueUpdate>;
	atomic?: boolean;
	undoable?: boolean;
	bypassValueSetter?: boolean;
	source?: CellValueChangeOptions['source'];
}

export interface RowTransactionRejection {
	rowId?: string;
	reason: string;
	index?: number;
}

export interface RowTransactionMutation<TRowData = unknown> {
	kind: 'row-transaction';
	transaction: RowDataTransaction<TRowData>;
	restoreSnapshot?: RowModelTransactionSnapshot<TRowData>;
}

export interface RowOrderMutation {
	kind: 'row-order';
	rowIds: string[];
	emitEvent?: boolean;
}

export interface ReplaceRowsMutation<TRowData = unknown> {
	kind: 'replace-rows';
	rows: readonly TRowData[];
	undoable?: boolean;
}

export interface BatchRowUpdateMutation<TRowData = unknown> {
	kind: 'batch-row-update';
	updater: (rows: TRowData[]) => TRowData[];
	undoable?: boolean;
}

export type GridDomainMutation<TRowData = unknown> =
	| CellValueMutation
	| BatchCellMutation
	| RowTransactionMutation<TRowData>
	| RowOrderMutation
	| ReplaceRowsMutation<TRowData>
	| BatchRowUpdateMutation<TRowData>;

export interface GridMutationRejection {
	mutationKind: GridDomainMutation['kind'];
	reason: string;
	index?: number;
}

export type GridMutationValidationResult = { ok: true } | { ok: false; reason: string; rejection?: GridMutationRejection };

export interface GridCommitContext<TRowData = unknown> {
	getState(): Readonly<InternalGridState<TRowData>>;
	getRowModel(): RowModel<TRowData> | null;
	getCellValue?(rowId: string, colField: string): unknown;
	getRawCellValue?(rowId: string, colField: string): unknown;
	getStoredCellValue?(rowId: string, colField: string): unknown;
	getColumnDef?(colField: string): ColumnDef<TRowData> | undefined;
	applyCellValueChange?: (rowId: string, colField: string, value: unknown, options?: CellValueChangeOptions) => CellValueChangeResult;
	publishCommittedCellChanges?: (changes: Map<string, Set<string>>) => void;
}

export interface PreparedDomainMutation<TRowData = unknown, TMutation extends GridDomainMutation<TRowData> = GridDomainMutation<TRowData>> {
	mutation: TMutation;
	noop?: boolean;
	state?: GridStateUpdater<TRowData>;
	invalidations?: readonly GridInvalidation[];
	domains: readonly GridDomain[];
	events: readonly GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	requestRender?: boolean;
	rejections?: readonly GridMutationRejection[];
	apply(context: GridCommitContext<TRowData>): AppliedDomainMutation<TRowData>;
	rollback?(applied: AppliedDomainMutation<TRowData>, context: GridCommitContext<TRowData>): void;
}

export interface AppliedDomainMutation<TRowData = unknown> {
	noop?: boolean;
	state?: GridStateUpdater<TRowData>;
	invalidations?: readonly GridInvalidation[];
	domains?: readonly GridDomain[];
	events?: readonly GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	requestRender?: boolean;
	rejections?: readonly GridMutationRejection[];
	cellChanges?: Map<string, Set<string>>;
	result?: unknown;
}

export interface GridDomainMutationExecutor<TRowData = unknown, TMutation extends GridDomainMutation<TRowData> = GridDomainMutation<TRowData>> {
	validate(mutation: TMutation, context: GridCommitContext<TRowData>): GridMutationValidationResult;
	prepare(mutation: TMutation, context: GridCommitContext<TRowData>): PreparedDomainMutation<TRowData, TMutation>;
}

export interface GridDomainMutationExecutorRegistry<TRowData = unknown> {
	resolve<TMutation extends GridDomainMutation<TRowData>>(mutation: TMutation): GridDomainMutationExecutor<TRowData, TMutation> | null;
}

function getRowOrderCapableModel<TRowData>(context: GridCommitContext<TRowData>): RowOrderCapableModel | null {
	return asRowOrderCapableModel(context.getRowModel());
}

function getTransactionalRowModel<TRowData>(context: GridCommitContext<TRowData>): TransactionalRowModel<TRowData> | null {
	return asTransactionalRowModel(context.getRowModel());
}

interface CellValueMutationPreview {
	rowId: string;
	colField: string;
	value: unknown;
	oldRawValue: unknown;
	oldComputedValue: unknown;
	status: 'ready' | 'noop' | 'rejected';
	reason?: string;
}

interface PreparedCellValueMutation<TRowData = unknown> extends PreparedDomainMutation<TRowData, CellValueMutation> {
	preview: CellValueMutationPreview;
}

interface PreparedBatchCellMutation<TRowData = unknown> extends PreparedDomainMutation<TRowData, BatchCellMutation> {
	previews: readonly CellValueMutationPreview[];
}

interface BatchCellMutationExecutionResult {
	results: CellValueChangeResult[];
	committed: CellValueChangeResult[];
	rejected: Array<{ index: number; update: BatchCellValueUpdate; reason: string }>;
}

function areRowOrdersEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toCellChangeSet(cells: readonly GridCellPointer[]): Map<string, Set<string>> {
	const changes = new Map<string, Set<string>>();
	for (const cell of cells) {
		let fields = changes.get(cell.rowId);
		if (!fields) {
			fields = new Set<string>();
			changes.set(cell.rowId, fields);
		}
		fields.add(cell.colField);
	}
	return changes;
}

function createInvalidationsFromCells(cells: readonly GridCellPointer[]): GridInvalidation[] {
	const invalidations: GridInvalidation[] = [];
	const rowIds = new Set<string>();
	const cellKeys = new Set<string>();
	for (const cell of cells) {
		const key = `${cell.rowId}:${cell.colField}`;
		if (!cellKeys.has(key)) {
			cellKeys.add(key);
			invalidations.push({ kind: 'cell', rowId: cell.rowId, colId: cell.colField, reason: 'cell' });
		}
		rowIds.add(cell.rowId);
	}
	for (const rowId of rowIds) {
		invalidations.push({ kind: 'row', rowId, reason: 'cell' });
	}
	return invalidations;
}

function createEventsFromResults<TRowData>(results: readonly CellValueChangeResult[]): GridCommitEvent<TRowData>[] {
	return results
		.filter((result) => result.applied)
		.map((result) => ({
			type: GridEventName.cellValueChanged,
			payload: {
				rowId: result.rowId,
				colField: result.colField,
				oldValue: result.oldComputedValue,
				newValue: result.newComputedValue,
			},
		}));
}

function rollbackAppliedCellResults<TRowData>(
	results: readonly CellValueChangeResult[],
	context: GridCommitContext<TRowData>,
	source: CellValueChangeOptions['source']
): void {
	if (!context.applyCellValueChange) return;
	for (let index = results.length - 1; index >= 0; index--) {
		const result = results[index]!;
		if (!result.applied) continue;
		context.applyCellValueChange(result.rowId, result.colField, result.oldRawValue, {
			bypassValueSetter: true,
			source,
		});
	}
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
	newValue: unknown,
	bypassValueSetter = false
): GridHistoryEntry<TRowData> {
	return {
		undo: {
			reason,
			domainMutations: [{ kind: 'cell-value', rowId, colField, value: oldValue, undoable: false, bypassValueSetter, source: 'undo' }],
			requestRender: false,
		},
		redo: {
			reason,
			domainMutations: [{ kind: 'cell-value', rowId, colField, value: newValue, undoable: false, bypassValueSetter, source: 'redo' }],
			requestRender: false,
		},
	};
}

export function createBatchCellMutationHistory<TRowData>(
	reason: GridCommitReason,
	updates: ReadonlyArray<{ rowId: string; colField: string; oldValue: unknown; newValue: unknown }>,
	bypassValueSetter = false
): GridHistoryEntry<TRowData> {
	return {
		undo: {
			reason,
			domainMutations: [
				{
					kind: 'batch-cell',
					updates: updates.map((update) => ({ rowId: update.rowId, colField: update.colField, value: update.oldValue })),
					undoable: false,
					bypassValueSetter,
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
					bypassValueSetter,
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
			if (!getRowOrderCapableModel(context)) {
				return {
					ok: false,
					reason: 'row model unavailable',
					rejection: { mutationKind: 'row-order', reason: 'row model unavailable' },
				};
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			const rowModel = getRowOrderCapableModel(context)!;
			const currentOrder = rowModel.getRowOrder();
			const nextOrder = mutation.rowIds.slice();
			if (areRowOrdersEqual(currentOrder, nextOrder)) {
				return {
					mutation,
					noop: true,
					domains: [],
					events: [],
					apply: () => ({ noop: true }),
				};
			}
			return {
				mutation: { ...mutation, rowIds: nextOrder },
				domains: ['rows'],
				events: mutation.emitEvent === false ? [] : [{ type: GridEventName.rowOrderChanged, payload: { rowIds: nextOrder } }],
				history: createRowOrderHistory(reason, currentOrder, nextOrder),
				requestRender: true,
				apply(commitContext) {
					getRowOrderCapableModel(commitContext)!.setRowOrder(nextOrder);
					return {
						domains: ['rows'],
						invalidations: [{ kind: 'full', reason: 'row order changed' }],
						events: mutation.emitEvent === false ? [] : [{ type: GridEventName.rowOrderChanged, payload: { rowIds: nextOrder } }],
						history: createRowOrderHistory(reason, currentOrder, nextOrder),
						requestRender: true,
					};
				},
				rollback(_applied, commitContext) {
					getRowOrderCapableModel(commitContext)!.setRowOrder(currentOrder);
				},
			};
		},
	};
}

function previewCellValueMutation<TRowData>(context: GridCommitContext<TRowData>, mutation: CellValueMutation): CellValueMutationPreview {
	const rowModel = context.getRowModel();
	const getCellValue = context.getCellValue;
	const getRawCellValue = context.getRawCellValue;
	const getStoredCellValue = context.getStoredCellValue;
	const getColumnDef = context.getColumnDef;

	const writableRowModel = asCellValueWritableRowModel(rowModel);
	if (!writableRowModel || !getCellValue || !getRawCellValue || !getStoredCellValue || !getColumnDef) {
		return {
			rowId: mutation.rowId,
			colField: mutation.colField,
			value: mutation.value,
			oldRawValue: undefined,
			oldComputedValue: undefined,
			status: 'rejected',
			reason: 'cell mutation runtime unavailable',
		};
	}

	const activeRowModel = rowModel!;
	const row = activeRowModel.getRawRowById?.(mutation.rowId);
	if (!row) {
		return {
			rowId: mutation.rowId,
			colField: mutation.colField,
			value: mutation.value,
			oldRawValue: undefined,
			oldComputedValue: undefined,
			status: 'rejected',
			reason: 'row unavailable',
		};
	}

	const column = getColumnDef(mutation.colField);
	const oldRawValue = getRawCellValue(mutation.rowId, mutation.colField);
	const oldComputedValue = getCellValue(mutation.rowId, mutation.colField);
	const oldStoredValue = column?.valueGetter ? getStoredCellValue(mutation.rowId, mutation.colField) : oldRawValue;

	if (oldStoredValue === mutation.value) {
		return {
			rowId: mutation.rowId,
			colField: mutation.colField,
			value: mutation.value,
			oldRawValue,
			oldComputedValue,
			status: 'noop',
		};
	}

	return {
		rowId: mutation.rowId,
		colField: mutation.colField,
		value: mutation.value,
		oldRawValue,
		oldComputedValue,
		status: 'ready',
	};
}

export function createDefaultGridDomainMutationExecutorRegistry<TRowData = unknown>(): GridDomainMutationExecutorRegistry<TRowData> {
	const cellValueExecutor: GridDomainMutationExecutor<TRowData, CellValueMutation> = {
		validate(mutation, context) {
			if (!context.applyCellValueChange) {
				return {
					ok: false,
					reason: 'cell mutation runtime unavailable',
					rejection: { mutationKind: 'cell-value', reason: 'cell mutation runtime unavailable' },
				};
			}
			const preview = previewCellValueMutation(context, mutation);
			if (preview.status === 'rejected') {
				return {
					ok: false,
					reason: preview.reason ?? 'cell mutation rejected',
					rejection: { mutationKind: 'cell-value', reason: preview.reason ?? 'cell mutation rejected' },
				};
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			const preview = previewCellValueMutation(context, mutation);
			return {
				mutation,
				preview,
				noop: preview.status === 'noop',
				domains: preview.status === 'ready' ? ['rows'] : [],
				events: [],
				apply(commitContext) {
					if (!commitContext.applyCellValueChange) return { noop: true };
					if (preview.status !== 'ready') {
						return {
							noop: true,
							result: {
								applied: false,
								rowId: preview.rowId,
								colField: preview.colField,
								oldRawValue: preview.oldRawValue,
								oldComputedValue: preview.oldComputedValue,
								newRawValue: preview.value,
								invalidatedCells: [],
							} satisfies CellValueChangeResult,
						};
					}
					const result = commitContext.applyCellValueChange(preview.rowId, preview.colField, preview.value, {
						bypassValueSetter: mutation.bypassValueSetter === true,
						source: mutation.source ?? 'api',
					});
					if (!result.applied) {
						return {
							noop: true,
							rejections: [
								{
									mutationKind: 'cell-value',
									reason: 'value setter rejected change',
								},
							],
							result,
						};
					}
					return {
						domains: ['rows'],
						invalidations: createInvalidationsFromCells(result.invalidatedCells),
						events: createEventsFromResults<TRowData>([result]),
						history:
							mutation.undoable === false
								? undefined
								: createCellValueMutationHistory<TRowData>(
										'data:set-cell-value',
										preview.rowId,
										preview.colField,
										preview.oldRawValue,
										preview.value,
										mutation.bypassValueSetter === true
									),
						requestRender: true,
						cellChanges: toCellChangeSet(result.invalidatedCells),
						result,
					};
				},
				rollback(applied, commitContext) {
					const result = applied.result as CellValueChangeResult | undefined;
					if (!result?.applied || !commitContext.applyCellValueChange) return;
					commitContext.applyCellValueChange(result.rowId, result.colField, preview.oldRawValue, {
						bypassValueSetter: true,
						source: 'undo',
					});
				},
			} satisfies PreparedCellValueMutation<TRowData>;
		},
	};

	const batchCellExecutor: GridDomainMutationExecutor<TRowData, BatchCellMutation> = {
		validate(mutation, context) {
			if (!context.applyCellValueChange) {
				return {
					ok: false,
					reason: 'batch cell mutation runtime unavailable',
					rejection: { mutationKind: 'batch-cell', reason: 'batch cell mutation runtime unavailable' },
				};
			}
			if (!context.getCellValue || !context.getRawCellValue || !context.getStoredCellValue || !context.getColumnDef) {
				return {
					ok: false,
					reason: 'batch cell preview runtime unavailable',
					rejection: { mutationKind: 'batch-cell', reason: 'batch cell preview runtime unavailable' },
				};
			}
			if (mutation.atomic !== false) {
				for (let index = 0; index < mutation.updates.length; index++) {
					const preview = previewCellValueMutation(context, {
						kind: 'cell-value',
						...mutation.updates[index]!,
						undoable: mutation.undoable,
						bypassValueSetter: mutation.bypassValueSetter,
						source: mutation.source,
					});
					if (preview.status === 'rejected') {
						return {
							ok: false,
							reason: preview.reason ?? 'batch cell mutation rejected',
							rejection: { mutationKind: 'batch-cell', reason: preview.reason ?? 'batch cell mutation rejected', index },
						};
					}
				}
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			const previews = mutation.updates.map((update) =>
				previewCellValueMutation(context, {
					kind: 'cell-value',
					...update,
					undoable: mutation.undoable,
					bypassValueSetter: mutation.bypassValueSetter,
					source: mutation.source,
				})
			);
			const rejections: GridMutationRejection[] = [];
			for (let index = 0; index < previews.length; index++) {
				const preview = previews[index]!;
				if (preview.status === 'rejected') {
					rejections.push({
						mutationKind: 'batch-cell',
						reason: preview.reason ?? 'batch cell mutation rejected',
						index,
					});
				}
			}
			return {
				mutation,
				previews,
				noop: previews.every((preview) => preview.status !== 'ready'),
				domains: previews.some((preview) => preview.status === 'ready') ? ['rows'] : [],
				events: [],
				rejections,
				apply(commitContext) {
					if (!commitContext.applyCellValueChange) return { noop: true, rejections };
					const committed: CellValueChangeResult[] = [];
					const results: CellValueChangeResult[] = [];
					const rejected: Array<{ index: number; update: BatchCellValueUpdate; reason: string }> = [];

					for (let index = 0; index < previews.length; index++) {
						const preview = previews[index]!;
						const update = mutation.updates[index]!;
						if (preview.status === 'rejected') {
							rejected.push({ index, update, reason: preview.reason ?? 'batch cell mutation rejected' });
							continue;
						}
						if (preview.status === 'noop') continue;

						const result = commitContext.applyCellValueChange(update.rowId, update.colField, update.value, {
							bypassValueSetter: mutation.bypassValueSetter === true,
							source: mutation.source ?? 'api',
						});
						if (!result.applied) {
							if (mutation.atomic !== false) {
								rollbackAppliedCellResults(committed, commitContext, 'undo');
								return {
									noop: true,
									rejections: [
										{
											mutationKind: 'batch-cell',
											index,
											reason: 'value setter rejected change',
										},
									],
									result: {
										results,
										committed: [],
										rejected: [{ index, update, reason: 'value setter rejected change' }],
									} satisfies BatchCellMutationExecutionResult,
								};
							}
							rejected.push({ index, update, reason: 'value setter rejected change' });
							continue;
						}
						results.push(result);
						committed.push(result);
					}

					const invalidatedCells = committed.flatMap((result) => result.invalidatedCells);
					return {
						noop: committed.length === 0,
						domains: committed.length > 0 ? ['rows'] : [],
						invalidations: createInvalidationsFromCells(invalidatedCells),
						events: createEventsFromResults<TRowData>(committed),
						history:
							committed.length > 0 && mutation.undoable !== false
								? createBatchCellMutationHistory<TRowData>(
										'data:batch-cell-values',
										committed.map((result) => ({
											rowId: result.rowId,
											colField: result.colField,
											oldValue: result.oldRawValue,
											newValue: result.newRawValue,
										})),
										mutation.bypassValueSetter === true
									)
								: undefined,
						requestRender: committed.length > 0,
						rejections: rejected.map((entry) => ({
							mutationKind: 'batch-cell' as const,
							index: entry.index,
							reason: entry.reason,
						})),
						cellChanges: toCellChangeSet(invalidatedCells),
						result: { results, committed, rejected } satisfies BatchCellMutationExecutionResult,
					};
				},
				rollback(applied, commitContext) {
					const result = applied.result as BatchCellMutationExecutionResult | undefined;
					if (!result) return;
					rollbackAppliedCellResults(result.committed, commitContext, 'undo');
				},
			} satisfies PreparedBatchCellMutation<TRowData>;
		},
	};

	const rowOrderExecutor = createRowOrderMutationExecutor<TRowData>();
	const rowTransactionExecutor: GridDomainMutationExecutor<TRowData, RowTransactionMutation<TRowData>> = {
		validate(_mutation, context) {
			if (!getTransactionalRowModel(context)) {
				return {
					ok: false,
					reason: 'row model does not implement TransactionalRowModel',
					rejection: { mutationKind: 'row-transaction', reason: 'row model does not implement TransactionalRowModel' },
				};
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			const transaction = mutation.transaction;
			const hasWork =
				mutation.restoreSnapshot !== undefined ||
				(transaction.add?.length ?? 0) > 0 ||
				(transaction.remove?.length ?? 0) > 0 ||
				(transaction.update?.length ?? 0) > 0;
			if (!hasWork) {
				return {
					mutation,
					noop: true,
					domains: [],
					events: [],
					apply: () => ({ noop: true, result: { add: [], remove: [], update: [] } satisfies RowNodeTransaction<TRowData> }),
				};
			}
			const rowModel = getTransactionalRowModel(context)!;
			const preparedRestoreSnapshot = mutation.restoreSnapshot ?? rowModel.captureTransactionSnapshot(mutation);
			return {
				mutation,
				domains: ['rows', 'geometry'],
				events: [],
				requestRender: true,
				apply(context) {
					const rowModel = getTransactionalRowModel(context)!;
					if (mutation.restoreSnapshot) {
						rowModel.restoreTransactionSnapshot(preparedRestoreSnapshot);
						return {
							domains: ['rows', 'geometry'],
							invalidations: [{ kind: 'full', reason: 'data' }],
							requestRender: true,
							result: { add: [], remove: [], update: [] } satisfies RowNodeTransaction<TRowData>,
						};
					}
					const result = rowModel.applyTransaction(mutation.transaction);
					return {
						domains: ['rows', 'geometry'],
						invalidations: [{ kind: 'full', reason: 'data' }],
						history: {
							undo: {
								reason: 'rows:apply-transaction',
								domainMutations: [
									{
										kind: 'row-transaction',
										transaction: { update: [] },
										restoreSnapshot: preparedRestoreSnapshot,
									},
								],
								requestRender: false,
							},
							redo: {
								reason: 'rows:apply-transaction',
								domainMutations: [mutation],
								requestRender: false,
							},
						},
						requestRender: true,
						result,
					};
				},
				rollback(_applied, context) {
					getTransactionalRowModel(context)!.restoreTransactionSnapshot(preparedRestoreSnapshot);
				},
			};
		},
	};

	const replaceRowsExecutor: GridDomainMutationExecutor<TRowData, ReplaceRowsMutation<TRowData>> = {
		validate(_mutation, context) {
			if (!asClientMutableRowModel(context.getRowModel())) {
				return { ok: false, reason: 'replace-rows requires client row model', rejection: { mutationKind: 'replace-rows', reason: 'replace-rows requires client row model' } };
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			return {
				mutation,
				domains: ['rows', 'geometry'],
				events: [],
				requestRender: true,
				apply(commitContext) {
					asClientMutableRowModel(commitContext.getRowModel())!.setRows(mutation.rows as TRowData[]);
					return {
						domains: ['rows', 'geometry'],
						invalidations: [{ kind: 'full', reason: 'data' }],
						requestRender: true,
					};
				},
			};
		},
	};

	const batchRowUpdateExecutor: GridDomainMutationExecutor<TRowData, BatchRowUpdateMutation<TRowData>> = {
		validate(_mutation, context) {
			if (!asClientMutableRowModel(context.getRowModel())) {
				return { ok: false, reason: 'batch-row-update requires client row model', rejection: { mutationKind: 'batch-row-update', reason: 'batch-row-update requires client row model' } };
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			return {
				mutation,
				domains: ['rows', 'geometry'],
				events: [],
				requestRender: true,
				apply(commitContext) {
					asClientMutableRowModel(commitContext.getRowModel())!.updateRows(mutation.updater);
					return {
						domains: ['rows', 'geometry'],
						invalidations: [{ kind: 'full', reason: 'data' }],
						requestRender: true,
					};
				},
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
			if (mutation.kind === 'replace-rows') {
				return replaceRowsExecutor as GridDomainMutationExecutor<TRowData, typeof mutation>;
			}
			if (mutation.kind === 'batch-row-update') {
				return batchRowUpdateExecutor as GridDomainMutationExecutor<TRowData, typeof mutation>;
			}
			return null;
		},
	};
}

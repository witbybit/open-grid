import { GridEventName } from '../api/GridEvents.js';
import type { RowDataTransaction, RowNodeTransaction } from '../api/GridApi.js';
import type { RowModel } from '../rowModel.js';
import type { ColumnDef } from '../columnDef.js';
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
	getCellValue?(rowId: string, colField: string): unknown;
	getRawCellValue?(rowId: string, colField: string): unknown;
	getStoredCellValue?(rowId: string, colField: string): unknown;
	getColumnDef?(colField: string): ColumnDef<TRowData> | undefined;
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

interface PreparedCellValueMutation<TRowData = unknown> extends PreparedDomainMutation<TRowData, CellValueMutation> {
	preview: CellValueMutationPreview;
}

interface PreparedBatchCellMutation<TRowData = unknown> extends PreparedDomainMutation<TRowData, BatchCellMutation> {
	previews: CellValueMutationPreview[];
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

interface BatchCellMutationExecutionResult {
	results: CellValueChangeResult[];
	committed: CellValueChangeResult[];
	rejected: Array<{ index: number; update: BatchCellValueUpdate; reason: string }>;
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

function previewCellValueMutation<TRowData>(context: GridCommitContext<TRowData>, mutation: CellValueMutation): CellValueMutationPreview {
	const rowModel = context.getRowModel();
	const getCellValue = context.getCellValue;
	const getRawCellValue = context.getRawCellValue;
	const getStoredCellValue = context.getStoredCellValue;
	const getColumnDef = context.getColumnDef;

	if (!rowModel?.setCellValue || !getCellValue || !getRawCellValue || !getStoredCellValue || !getColumnDef) {
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

	const row = rowModel.getRawRowById?.(mutation.rowId);
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

	if (column?.valueSetter) {
		const draftRow = { ...(row as Record<string, unknown>) } as TRowData;
		const result = column.valueSetter({
			value: mutation.value,
			oldValue: oldComputedValue,
			row: draftRow,
			colField: mutation.colField,
			abort: () => undefined,
		});
		if (!(result instanceof Promise) && !result) {
			return {
				rowId: mutation.rowId,
				colField: mutation.colField,
				value: mutation.value,
				oldRawValue,
				oldComputedValue,
				status: 'rejected',
				reason: 'value setter rejected change',
			};
		}
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
			return { mutation, preview: previewCellValueMutation(context, mutation), requestRender: false } satisfies PreparedCellValueMutation;
		},
		apply(prepared, context) {
			if (!context.applyCellValueChange) return { noop: true };
			const preparedCell = prepared as PreparedCellValueMutation;
			if (preparedCell.preview.status === 'noop') {
				return {
					noop: true,
					result: {
						applied: false,
						rowId: preparedCell.preview.rowId,
						colField: preparedCell.preview.colField,
						oldRawValue: preparedCell.preview.oldRawValue,
						oldComputedValue: preparedCell.preview.oldComputedValue,
						newRawValue: preparedCell.preview.value,
						invalidatedCells: [],
					} satisfies CellValueChangeResult,
				};
			}
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
								preparedCell.preview.oldRawValue,
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
			if (!context.getCellValue || !context.getRawCellValue || !context.getStoredCellValue || !context.getColumnDef) {
				return {
					ok: false,
					reason: 'batch cell preview runtime unavailable',
					rejection: { mutationKind: 'batch-cell', reason: 'batch cell preview runtime unavailable' },
				};
			}
			if (mutation.atomic !== false) {
				for (let index = 0; index < mutation.updates.length; index++) {
					const update = mutation.updates[index]!;
					const preview = previewCellValueMutation(context, {
						kind: 'cell-value',
						...update,
						undoable: mutation.undoable,
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
			return {
				mutation,
				previews: mutation.updates.map((update) =>
					previewCellValueMutation(context, { kind: 'cell-value', ...update, undoable: mutation.undoable, source: mutation.source })
				),
				requestRender: false,
			} satisfies PreparedBatchCellMutation;
		},
		apply(prepared, context) {
			if (!context.applyBatchCellValues) return { noop: true };
			const preparedBatch = prepared as PreparedBatchCellMutation;
			const applicableUpdates =
				prepared.mutation.atomic === false
					? prepared.mutation.updates.filter((_, index) => preparedBatch.previews[index]?.status !== 'rejected')
					: prepared.mutation.updates;
			if (applicableUpdates.length === 0) {
				return {
					noop: true,
					result: {
						results: [],
						committed: [],
						rejected: preparedBatch.previews
							.map((preview, index) =>
								preview.status === 'rejected'
									? { index, update: prepared.mutation.updates[index]!, reason: preview.reason ?? 'batch cell mutation rejected' }
									: null
							)
							.filter((entry): entry is { index: number; update: BatchCellValueUpdate; reason: string } => entry !== null),
					} satisfies BatchCellMutationExecutionResult,
				};
			}
			const results = context.applyBatchCellValues(applicableUpdates.slice(), {
				undoable: false,
				source: prepared.mutation.source ?? 'api',
			});
			const applied = results.filter((result) => result.applied);
			const rejected = preparedBatch.previews
				.map((preview, index) =>
					preview.status === 'rejected'
						? { index, update: prepared.mutation.updates[index]!, reason: preview.reason ?? 'batch cell mutation rejected' }
						: null
				)
				.filter((entry): entry is { index: number; update: BatchCellValueUpdate; reason: string } => entry !== null);
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
				result: { results, committed: applied, rejected } satisfies BatchCellMutationExecutionResult,
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

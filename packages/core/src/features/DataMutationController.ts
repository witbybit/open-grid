import type { DataModel } from '../models/DataModel.js';
import type { ColumnModel } from '../models/ColumnModel.js';
import type { EventBus } from '../events/EventBus.js';
import type { FormulaCellCoordinate } from '../calculations/dagEngine.js';
import type { BatchCellValueUpdate, GridCellPointer } from '../api/GridApi.js';
import { GridEventName } from '../api/GridEvents.js';
import type { RowModel } from '../rowModel.js';
import type { GridHistoryEntry } from '../engine/GridChangeApplier.js';

export type { BatchCellValueUpdate };

export interface CellValueChangeOptions {
	undoable?: boolean;
	emitEvent?: boolean;
	notify?: boolean;
	source?: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo' | 'transaction';
}

export interface CellValueChangeResult {
	applied: boolean;
	rowId: string;
	colField: string;
	oldRawValue: unknown;
	oldComputedValue: unknown;
	newRawValue: unknown;
	newComputedValue?: unknown;
	invalidatedCells: GridCellPointer[];
}

export interface DataMutationDeps<TRowData = unknown> {
	data: DataModel<TRowData>;
	columns: ColumnModel<TRowData>;
	eventBus: EventBus<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	registerHistory: (history: GridHistoryEntry<TRowData>) => void;
	syncFormulaForCell: (rowId: string, colField: string, value: unknown) => void;
	invalidateFormulaCell: (rowId: string, colField: string) => FormulaCellCoordinate[];
	getBatchedUpdates: () => boolean;
	enqueueCellUpdate: (rowId: string, colField: string) => void;
	scheduleBatchFlush: () => void;
	notifyCellChange: (rowId: string, colField: string) => void;
}

export class DataMutationController<TRowData = unknown> {
	constructor(private readonly deps: DataMutationDeps<TRowData>) {}

	registerCellValueHistory(rowId: string, colField: string, oldValue: unknown, newValue: unknown): void {
		this.deps.registerHistory({
			undo: {
				reason: 'data:set-cell-value:undo',
				run: () => this.applyCellValueChange(rowId, colField, oldValue, { undoable: false, source: 'undo' }),
				requestRender: false,
			},
			redo: {
				reason: 'data:set-cell-value:redo',
				run: () => this.applyCellValueChange(rowId, colField, newValue, { undoable: false, source: 'redo' }),
				requestRender: false,
			},
		});
	}

	registerBatchCellValueHistory(updates: ReadonlyArray<{ rowId: string; colField: string; oldValue: unknown; newValue: unknown }>): void {
		if (updates.length === 0) return;
		const undoUpdates = updates.map((update) => ({ rowId: update.rowId, colField: update.colField, value: update.oldValue }));
		const redoUpdates = updates.map((update) => ({ rowId: update.rowId, colField: update.colField, value: update.newValue }));
		this.deps.registerHistory({
			undo: {
				reason: 'data:batch-cell-values:undo',
				run: () => this.applyBatchCellValues(undoUpdates, { undoable: false, source: 'undo' }),
				requestRender: false,
			},
			redo: {
				reason: 'data:batch-cell-values:redo',
				run: () => this.applyBatchCellValues(redoUpdates, { undoable: false, source: 'redo' }),
				requestRender: false,
			},
		});
	}

	applyCellValueChange(rowId: string, colField: string, value: unknown, options: CellValueChangeOptions = {}): CellValueChangeResult {
		const { undoable = true, emitEvent = true, notify = true } = options;

		const notApplied = (oldRawValue: unknown, oldComputedValue: unknown): CellValueChangeResult => ({
			applied: false,
			rowId,
			colField,
			oldRawValue,
			oldComputedValue,
			newRawValue: value,
			invalidatedCells: [],
		});

		const col = this.deps.columns.getColumnDef(colField);
		const oldRawValue = this.deps.data.getRawCellValue(rowId, colField);
		const hasEventListeners = emitEvent && this.deps.eventBus.hasListeners(GridEventName.cellValueChanged);
		const oldComputedValue = hasEventListeners ? this.deps.data.getCellValue(rowId, colField) : undefined;

		const oldStoredValue = col?.valueGetter ? this.deps.data.getStoredCellValue(rowId, colField) : oldRawValue;
		if (oldStoredValue === value) return notApplied(oldRawValue, oldComputedValue);

		const rowModel = this.deps.getRowModel();
		if (!rowModel?.setCellValue) return notApplied(oldRawValue, oldComputedValue);

		const writeApplied = rowModel.setCellValue(rowId, colField, value);
		if (!writeApplied) return notApplied(oldRawValue, oldComputedValue);

		this.deps.syncFormulaForCell(rowId, colField, value);

		const invalidatedFormulaCells = this.deps.invalidateFormulaCell(rowId, colField);
		const dependentFields = this.deps.columns.getValueGetterDependents(colField).filter((f) => f !== colField);

		const invalidatedCells: GridCellPointer[] = [{ rowId, colField }];
		const seen = new Set<string>();
		seen.add(rowId + ':' + colField);

		const addCell = (rId: string, cField: string): void => {
			const key = rId + ':' + cField;
			if (!seen.has(key)) {
				seen.add(key);
				invalidatedCells.push({ rowId: rId, colField: cField });
			}
		};

		for (const f of dependentFields) addCell(rowId, f);
		for (const c of invalidatedFormulaCells) addCell(c.rowId, c.colField);

		for (const c of invalidatedCells) {
			this.deps.data.clearValueGetterCache(c.rowId, c.colField);
		}

		if (notify) {
			if (this.deps.getBatchedUpdates()) {
				for (const c of invalidatedCells) this.deps.enqueueCellUpdate(c.rowId, c.colField);
				this.deps.scheduleBatchFlush();
			} else {
				for (const c of invalidatedCells) this.deps.notifyCellChange(c.rowId, c.colField);
			}
		}

		if (hasEventListeners) {
			this.deps.eventBus.dispatchEvent(GridEventName.cellValueChanged, {
				rowId,
				colField,
				oldValue: oldComputedValue,
				newValue: value,
			});
		}

		if (undoable) {
			this.registerCellValueHistory(rowId, colField, oldRawValue, value);
		}

		const newComputedValue = this.deps.data.getCellValue(rowId, colField);

		return {
			applied: true,
			rowId,
			colField,
			oldRawValue,
			oldComputedValue,
			newRawValue: value,
			newComputedValue,
			invalidatedCells,
		};
	}

	applyBatchCellValues(
		updates: BatchCellValueUpdate[],
		options: Pick<CellValueChangeOptions, 'undoable' | 'source'> = {}
	): CellValueChangeResult[] {
		if (updates.length === 0) return [];
		const { undoable = true, source } = options;

		// Snapshot old computed values before any writes so cellValueChanged events
		// carry stable before/after pairs even when formula deps cross cells.
		const hasEventListeners = this.deps.eventBus.hasListeners(GridEventName.cellValueChanged);
		const oldComputedSnapshot = hasEventListeners ? updates.map((u) => this.deps.data.getCellValue(u.rowId, u.colField)) : null;

		// Apply each write silently: valueSetter + formula sync run per-cell,
		// but notifications, events, and undo are suppressed until the batch is done.
		const results = updates.map((u) =>
			this.applyCellValueChange(u.rowId, u.colField, u.value, {
				undoable: false,
				emitEvent: false,
				notify: false,
				source,
			})
		);

		// Deduplicate and notify once for all invalidated cells.
		const allInvalidated = new Map<string, GridCellPointer>();
		for (const result of results) {
			if (!result.applied) continue;
			for (const cell of result.invalidatedCells) {
				allInvalidated.set(`${cell.rowId}:${cell.colField}`, cell);
			}
		}
		const cells = Array.from(allInvalidated.values());
		if (cells.length > 0) {
			if (this.deps.getBatchedUpdates()) {
				for (const c of cells) this.deps.enqueueCellUpdate(c.rowId, c.colField);
				this.deps.scheduleBatchFlush();
			} else {
				for (const c of cells) this.deps.notifyCellChange(c.rowId, c.colField);
			}
		}

		// Fire cellValueChanged events after all writes so computed values are stable.
		if (hasEventListeners && oldComputedSnapshot) {
			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				if (!result.applied) continue;
				this.deps.eventBus.dispatchEvent(GridEventName.cellValueChanged, {
					rowId: result.rowId,
					colField: result.colField,
					oldValue: oldComputedSnapshot[i],
					newValue: this.deps.data.getCellValue(result.rowId, result.colField),
				});
			}
		}

		// Single undo entry that restores every cell atomically.
		if (undoable) {
			const applied = results.filter((r) => r.applied);
			if (applied.length > 0) {
				this.registerBatchCellValueHistory(
					applied.map((r) => ({ rowId: r.rowId, colField: r.colField, oldValue: r.oldRawValue, newValue: r.newRawValue }))
				);
			}
		}

		return results;
	}
}

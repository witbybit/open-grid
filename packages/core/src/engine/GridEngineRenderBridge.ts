import type { CellSubscription } from '../api/GridApi.js';
import type { CellNotificationController } from './CellNotificationController.js';
import type { CommandHistory } from '../commands/CommandHistory.js';
import type { StateManager } from '../state/StateManager.js';

export interface GridEngineRenderBridgeDeps<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	commandHistory: CommandHistory;
	cellNotifications: CellNotificationController<TRowData>;
	requestRender: (reason: string) => void;
	beginRenderTransaction: () => void;
	endRenderTransaction: () => void;
}

export class GridEngineRenderBridge<TRowData = unknown> {
	constructor(private readonly deps: GridEngineRenderBridgeDeps<TRowData>) {}

	public batch(callback: () => void): void {
		this.deps.beginRenderTransaction();
		this.deps.stateManager.startTransaction();
		try {
			callback();
		} finally {
			this.deps.stateManager.endTransaction();
			this.flushCellUpdatesSync();
			this.deps.endRenderTransaction();
		}
	}

	public scheduleBatchFlush(): void {
		this.deps.cellNotifications.scheduleBatchFlush();
	}

	public flushCellUpdates(): void {
		this.deps.cellNotifications.flushCellUpdates();
	}

	public enqueueCellUpdate(rowId: string, colField: string): void {
		this.deps.cellNotifications.enqueueCellUpdate(rowId, colField);
	}

	public flushCellUpdatesSync(): void {
		this.deps.cellNotifications.flushCellUpdatesSync();
	}

	public notifyBulkCellChange(changes: Map<string, Set<string>>): void {
		this.deps.cellNotifications.notifyBulkCellChange(changes);
	}

	public publishCommittedCellChanges(changes: Map<string, Set<string>>, batchedUpdates: boolean): void {
		if (batchedUpdates) {
			for (const [rowId, fields] of changes) {
				for (const colField of fields) {
					this.enqueueCellUpdate(rowId, colField);
				}
			}
			this.scheduleBatchFlush();
			return;
		}
		this.deps.cellNotifications.publishCommittedCellChanges(changes);
	}

	public notifyCellChange(rowId: string, colField: string, includeRenderInvalidation = true, renderColId?: string): void {
		this.deps.cellNotifications.notifyCellChange(rowId, colField, includeRenderInvalidation, renderColId);
	}

	public registerCellSubscription(sub: CellSubscription): void {
		this.deps.cellNotifications.registerCellSubscription(sub);
	}

	public unregisterCellSubscription(sub: CellSubscription): void {
		this.deps.cellNotifications.unregisterCellSubscription(sub);
	}

	public updateCellSubscription(sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void {
		this.deps.cellNotifications.updateCellSubscription(sub, oldRowId, oldColField, newRowId, newColField);
	}
}

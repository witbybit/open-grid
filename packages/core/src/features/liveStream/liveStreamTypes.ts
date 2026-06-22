export interface CellStreamUpdate {
	readonly rowId: string;
	readonly colField: string;
	readonly value: unknown;
	readonly version?: string | number;
	readonly source?: string;
}

export interface RowStreamUpdate<TRowData> {
	readonly rowId: string;
	readonly patch: Partial<TRowData>;
	readonly version?: string | number;
	readonly source?: string;
}

export interface TransactionStreamUpdate<TRowData> {
	readonly cells?: readonly CellStreamUpdate[];
	readonly rows?: readonly RowStreamUpdate<TRowData>[];
}

export interface TransactionStreamOptions {
	readonly batchMs?: number;
	readonly maxBatchSize?: number;
	readonly coalesceBy?: 'cell' | 'row';
	readonly history?: 'suppress' | 'grouped';
	readonly flashChanges?: boolean;
	readonly dirtyCellPolicy?: 'skip' | 'queue' | 'markConflictLater';
	readonly sortPolicy?: 'live' | 'defer';
	readonly filterPolicy?: 'live' | 'defer';
}

export interface TransactionStreamState {
	readonly paused: boolean;
	readonly pendingUpdates: number;
	readonly committedBatches: number;
	readonly skippedDirtyUpdates: number;
	readonly droppedUpdates: number;
	readonly lastFlushDurationMs: number | null;
	readonly lastError: string | null;
	readonly backpressureActive: boolean;
}

export interface GridTransactionStream<TRowData> {
	push(update: TransactionStreamUpdate<TRowData>): void;
	pushCells(updates: readonly CellStreamUpdate[]): void;
	pushRows(updates: readonly RowStreamUpdate<TRowData>[]): void;
	pause(): void;
	resume(): void;
	flush(): void;
	destroy(): void;
	getState(): TransactionStreamState;
}

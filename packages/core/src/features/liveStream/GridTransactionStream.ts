import type { GridInsightLayer, GridCellDecoration } from '../../insights/insightTypes.js';
import type { GridScheduler } from '../../renderer/gridScheduler.js';
import type {
	CellStreamUpdate,
	GridTransactionStream,
	RowStreamUpdate,
	TransactionStreamOptions,
	TransactionStreamState,
	TransactionStreamUpdate,
} from './liveStreamTypes.js';

export type { CellStreamUpdate, GridTransactionStream, RowStreamUpdate, TransactionStreamOptions, TransactionStreamState, TransactionStreamUpdate };

const DEFAULTS: Required<TransactionStreamOptions> = {
	batchMs: 16,
	maxBatchSize: 1000,
	coalesceBy: 'cell',
	history: 'suppress',
	flashChanges: true,
	dirtyCellPolicy: 'skip',
	sortPolicy: 'defer',
	filterPolicy: 'defer',
};

const FLASH_DURATION_MS = 600;
const _EMPTY: readonly GridCellDecoration[] = [];

export interface GridTransactionStreamDeps<TRowData> {
	commitCells(updates: readonly { rowId: string; colField: string; value: unknown }[]): void;
	applyRowPatch(rowId: string, patch: Partial<TRowData>): void;
	isCellBeingEdited(rowId: string, colField: string): boolean;
	requestInsightRepaint(): void;
	onDestroy(): void;
	scheduler: GridScheduler;
}

export class GridTransactionStreamImpl<TRowData> implements GridInsightLayer, GridTransactionStream<TRowData> {
	public readonly id = 'liveStream' as const;

	private readonly opts: Required<TransactionStreamOptions>;

	// Pending cell updates: key = `rowId\0colField`, last write wins
	private readonly pendingCells = new Map<string, { rowId: string; colField: string; value: unknown }>();
	// Pending row patches: key = rowId, patches merged
	private readonly pendingRows = new Map<string, { rowId: string; patch: Partial<TRowData> }>();

	// Flash decorations currently active
	private readonly flashCells = new Map<string, GridCellDecoration[]>();

	private _paused = false;
	private _destroyed = false;
	private _committedBatches = 0;
	private _skippedDirtyUpdates = 0;
	private _droppedUpdates = 0;
	private _lastFlushDurationMs: number | null = null;
	private _lastError: string | null = null;
	private _backpressureActive = false;

	private _timer: ReturnType<GridScheduler['timeout']> | null = null;

	constructor(
		private readonly deps: GridTransactionStreamDeps<TRowData>,
		opts?: TransactionStreamOptions
	) {
		this.opts = { ...DEFAULTS, ...opts };
	}

	// ── GridInsightLayer ────────────────────────────────────────────────────────

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		return this.flashCells.get(`${rowId}\0${colField}`) ?? _EMPTY;
	}

	getDiagnostics(): TransactionStreamState {
		return this.getState();
	}

	destroy(): void {
		if (this._destroyed) return;
		this._destroyed = true;
		this._cancelTimer();
		this.pendingCells.clear();
		this.pendingRows.clear();
		this.flashCells.clear();
		this.deps.onDestroy();
	}

	// ── GridTransactionStream ───────────────────────────────────────────────────

	push(update: TransactionStreamUpdate<TRowData>): void {
		if (update.cells?.length) this.pushCells(update.cells);
		if (update.rows?.length) this.pushRows(update.rows);
	}

	pushCells(updates: readonly CellStreamUpdate[]): void {
		if (this._destroyed) return;
		for (const u of updates) {
			const key = `${u.rowId}\0${u.colField}`;
			if (this.pendingCells.size >= this.opts.maxBatchSize && !this.pendingCells.has(key)) {
				this._droppedUpdates++;
				this._backpressureActive = true;
				continue;
			}
			this._backpressureActive = false;
			this.pendingCells.set(key, { rowId: u.rowId, colField: u.colField, value: u.value });
		}
		this._scheduleBatch();
	}

	pushRows(updates: readonly RowStreamUpdate<TRowData>[]): void {
		if (this._destroyed) return;
		for (const u of updates) {
			const existing = this.pendingRows.get(u.rowId);
			if (existing) {
				existing.patch = { ...existing.patch, ...u.patch };
			} else {
				if (this.pendingRows.size >= this.opts.maxBatchSize) {
					this._droppedUpdates++;
					this._backpressureActive = true;
					continue;
				}
				this.pendingRows.set(u.rowId, { rowId: u.rowId, patch: { ...u.patch } });
			}
		}
		this._scheduleBatch();
	}

	pause(): void {
		this._paused = true;
		this._cancelTimer();
	}

	resume(): void {
		this._paused = false;
		if (this.pendingCells.size > 0 || this.pendingRows.size > 0) {
			this._scheduleBatch();
		}
	}

	flush(): void {
		if (this._destroyed) return;
		this._cancelTimer();
		this._flush();
	}

	getState(): TransactionStreamState {
		return {
			paused: this._paused,
			pendingUpdates: this.pendingCells.size + this.pendingRows.size,
			committedBatches: this._committedBatches,
			skippedDirtyUpdates: this._skippedDirtyUpdates,
			droppedUpdates: this._droppedUpdates,
			lastFlushDurationMs: this._lastFlushDurationMs,
			lastError: this._lastError,
			backpressureActive: this._backpressureActive,
		};
	}

	// ── Private ─────────────────────────────────────────────────────────────────

	private _scheduleBatch(): void {
		if (this._paused || this._destroyed || this._timer !== null) return;
		this._timer = this.deps.scheduler.timeout(() => {
			this._timer = null;
			this._flush();
		}, this.opts.batchMs);
	}

	private _cancelTimer(): void {
		if (this._timer !== null) {
			this.deps.scheduler.clearTimeout(this._timer);
			this._timer = null;
		}
	}

	private _flush(): void {
		if (this._paused || this._destroyed) return;
		if (this.pendingCells.size === 0 && this.pendingRows.size === 0) return;

		const t0 = Date.now();
		this._lastError = null;

		try {
			this._flushCells();
			this._flushRows();
			this._committedBatches++;
		} catch (e) {
			this._lastError = e instanceof Error ? e.message : String(e);
		}

		this._lastFlushDurationMs = Date.now() - t0;
	}

	private _flushCells(): void {
		if (this.pendingCells.size === 0) return;

		const toCommit: { rowId: string; colField: string; value: unknown }[] = [];

		for (const [, u] of this.pendingCells) {
			if (this.opts.dirtyCellPolicy === 'skip' && this.deps.isCellBeingEdited(u.rowId, u.colField)) {
				this._skippedDirtyUpdates++;
				continue;
			}
			toCommit.push(u);
		}

		this.pendingCells.clear();

		if (toCommit.length === 0) return;

		this.deps.commitCells(toCommit);

		if (this.opts.flashChanges) {
			this._flashCells(toCommit);
		}
	}

	private _flushRows(): void {
		if (this.pendingRows.size === 0) return;

		for (const [, u] of this.pendingRows) {
			try {
				this.deps.applyRowPatch(u.rowId, u.patch);
			} catch (e) {
				this._lastError = e instanceof Error ? e.message : String(e);
			}
		}
		this.pendingRows.clear();
	}

	private _flashCells(cells: readonly { rowId: string; colField: string }[]): void {
		const flashDec: GridCellDecoration = {
			layerId: 'liveStream',
			kind: 'flash',
			className: 'og-cell-live-flash',
		};

		for (const c of cells) {
			const key = `${c.rowId}\0${c.colField}`;
			this.flashCells.set(key, [flashDec]);
		}
		this.deps.requestInsightRepaint();

		this.deps.scheduler.timeout(() => {
			let changed = false;
			for (const c of cells) {
				const key = `${c.rowId}\0${c.colField}`;
				if (this.flashCells.delete(key)) changed = true;
			}
			if (changed) this.deps.requestInsightRepaint();
		}, FLASH_DURATION_MS);
	}
}

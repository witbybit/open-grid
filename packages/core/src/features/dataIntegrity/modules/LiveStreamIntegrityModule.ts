import type { GridCellDecoration } from '../../../insights/insightTypes.js';
import type { GridScheduler } from '../../../renderer/gridScheduler.js';
import type {
	GridIntegrityIssue,
	GridIntegrityModule,
	GridIntegrityRunContext,
	GridLiveStreamIntegrityOptions,
	GridLiveStreamOptions,
	GridLiveStreamUpdate,
	GridCellStreamUpdate,
	GridRowStreamUpdate,
	GridTransactionStreamHandle,
	GridTransactionStreamState,
} from '../integrityTypes.js';
import type { ConflictIntegrityModule } from './ConflictIntegrityModule.js';
import { makeConflictFromStream } from './ConflictIntegrityModule.js';

let _seq = 0;
function nextIssueId(): string {
	return `ls-${++_seq}`;
}

const FLASH_DURATION_MS = 600;

export interface LiveStreamModuleDeps<TRowData> {
	commitCells: (updates: readonly { rowId: string; colField: string; value: unknown }[]) => void;
	applyRowPatch: (rowId: string, patch: Partial<TRowData>) => void;
	getRawCellValue: (rowId: string, colField: string) => unknown;
	isCellDirty: (rowId: string, colField: string) => boolean;
	getConflictModule: () => ConflictIntegrityModule<TRowData> | null;
	requestRepaint: (cells?: Array<{ rowId: string; colField: string }>) => void;
	scheduler: GridScheduler;
}

export class LiveStreamIntegrityModule<TRowData> implements GridIntegrityModule<TRowData> {
	public readonly id = 'liveStream' as const;

	private moduleOptions: GridLiveStreamIntegrityOptions;
	private activeStream: LiveStreamHandle<TRowData> | null = null;
	private streamIssues: GridIntegrityIssue[] = [];

	// Flash decorations currently active: `rowId\0colField` → decoration
	private readonly flashCells = new Map<string, GridCellDecoration[]>();

	constructor(
		options: GridLiveStreamIntegrityOptions,
		private readonly deps: LiveStreamModuleDeps<TRowData>
	) {
		this.moduleOptions = options;
	}

	isEnabled(): boolean {
		return this.moduleOptions.enabled !== false;
	}

	getIssues(): readonly GridIntegrityIssue[] {
		return this.streamIssues;
	}

	getDiagnostics(): unknown {
		return {
			enabled: this.isEnabled(),
			activeStream: this.activeStream !== null,
			dirtyCellPolicy: this.moduleOptions.dirtyCellPolicy ?? 'markConflict',
			streamState: this.activeStream?.getState() ?? null,
		};
	}

	run(_context: GridIntegrityRunContext<TRowData>): readonly GridIntegrityIssue[] {
		return this.streamIssues;
	}

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		return this.flashCells.get(`${rowId}\0${colField}`) ?? _EMPTY;
	}

	// ── Stream management ──────────────────────────────────────────────────────

	createStream(options?: GridLiveStreamOptions<TRowData>): GridTransactionStreamHandle<TRowData> {
		this.activeStream?.destroy();

		const policy = options?.dirtyCellPolicy ?? this.moduleOptions.dirtyCellPolicy ?? 'markConflict';
		const flashChanges = options?.flashChanges ?? this.moduleOptions.flashChanges ?? true;

		const handle = new LiveStreamHandle<TRowData>(
			{
				...options,
				dirtyCellPolicy: policy,
				flashChanges,
			},
			{
				commitCells: this.deps.commitCells,
				applyRowPatch: this.deps.applyRowPatch,
				getRawCellValue: this.deps.getRawCellValue,
				isCellDirty: this.deps.isCellDirty,
				onSkipped: (rowId, colField, remoteValue) => {
					this._onCellSkipped(rowId, colField, remoteValue);
				},
				onConflict: (rowId, colField, localValue, remoteValue) => {
					this._onCellConflict(rowId, colField, localValue, remoteValue);
				},
				onFlash: (cells) => {
					this._flashCells(cells);
				},
				scheduler: this.deps.scheduler,
				onDestroy: () => {
					if (this.activeStream === handle) this.activeStream = null;
				},
			}
		);

		this.activeStream = handle;
		return handle;
	}

	getStreamState(): GridTransactionStreamState | null {
		return this.activeStream?.getState() ?? null;
	}

	// ── Private callbacks ──────────────────────────────────────────────────────

	private _onCellSkipped(rowId: string, colField: string, _remoteValue: unknown): void {
		const issue: GridIntegrityIssue = {
			id: nextIssueId(),
			source: 'liveStream',
			type: 'streamSkipped',
			severity: 'info',
			blocking: false,
			rowId,
			colField,
			message: `Live update skipped — cell is dirty`,
			createdAt: _now(),
		};
		// Replace any existing skip issue for this cell
		this.streamIssues = [
			...this.streamIssues.filter((i) => !(i.rowId === rowId && i.colField === colField && i.type === 'streamSkipped')),
			issue,
		];
		// Targeted repaint — only the affected cell
		this.deps.requestRepaint([{ rowId, colField }]);
	}

	private _onCellConflict(rowId: string, colField: string, localValue: unknown, remoteValue: unknown): void {
		const conflictModule = this.deps.getConflictModule();
		if (conflictModule) {
			conflictModule.addConflict(makeConflictFromStream(rowId, colField, localValue, remoteValue, 'liveStream'));
		} else {
			// No conflict module — fall back to skip behavior
			this._onCellSkipped(rowId, colField, remoteValue);
		}
		// Targeted repaint
		this.deps.requestRepaint([{ rowId, colField }]);
	}

	private _flashCells(cells: readonly { rowId: string; colField: string }[]): void {
		const flashDec: GridCellDecoration = {
			layerId: 'dataIntegrity',
			kind: 'liveFlash',
			className: 'og-cell-live-flash',
		};

		for (const c of cells) {
			this.flashCells.set(`${c.rowId}\0${c.colField}`, [flashDec]);
		}
		// Targeted repaint — only affected cells
		this.deps.requestRepaint(cells.map((c) => ({ rowId: c.rowId, colField: c.colField })));

		this.deps.scheduler.timeout(() => {
			let changed = false;
			for (const c of cells) {
				if (this.flashCells.delete(`${c.rowId}\0${c.colField}`)) changed = true;
			}
			if (changed) this.deps.requestRepaint(cells.map((c) => ({ rowId: c.rowId, colField: c.colField })));
		}, FLASH_DURATION_MS);
	}

	destroy(): void {
		this.activeStream?.destroy();
		this.activeStream = null;
		this.streamIssues = [];
		this.flashCells.clear();
	}
}

// ── Live stream handle ────────────────────────────────────────────────────────

interface LiveStreamHandleDeps<TRowData> {
	commitCells: (updates: readonly { rowId: string; colField: string; value: unknown }[]) => void;
	applyRowPatch: (rowId: string, patch: Partial<TRowData>) => void;
	getRawCellValue: (rowId: string, colField: string) => unknown;
	isCellDirty: (rowId: string, colField: string) => boolean;
	onSkipped: (rowId: string, colField: string, remoteValue: unknown) => void;
	onConflict: (rowId: string, colField: string, localValue: unknown, remoteValue: unknown) => void;
	onFlash: (cells: Array<{ rowId: string; colField: string }>) => void;
	scheduler: GridScheduler;
	onDestroy: () => void;
}

const STREAM_DEFAULTS = {
	batchMs: 16,
	maxBatchSize: 1000,
	coalesceBy: 'cell' as const,
	history: 'suppress' as const,
	flashChanges: true,
	dirtyCellPolicy: 'markConflict' as const,
	sortPolicy: 'defer' as const,
	filterPolicy: 'defer' as const,
};

class LiveStreamHandle<TRowData> implements GridTransactionStreamHandle<TRowData> {
	private readonly opts: Required<GridLiveStreamOptions<TRowData>>;
	private readonly pendingCells = new Map<string, { rowId: string; colField: string; value: unknown }>();
	private readonly pendingRows = new Map<string, { rowId: string; patch: Partial<TRowData> }>();

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
		opts: GridLiveStreamOptions<TRowData> | undefined,
		private readonly deps: LiveStreamHandleDeps<TRowData>
	) {
		this.opts = { ...STREAM_DEFAULTS, ...opts } as Required<GridLiveStreamOptions<TRowData>>;
	}

	push(update: GridLiveStreamUpdate<TRowData>): void {
		if (update.cells?.length) this.pushCells(update.cells);
		if (update.rows?.length) this.pushRows(update.rows);
	}

	pushCells(updates: readonly GridCellStreamUpdate[]): void {
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

	pushRows(updates: readonly GridRowStreamUpdate<TRowData>[]): void {
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
		if (this.pendingCells.size > 0 || this.pendingRows.size > 0) this._scheduleBatch();
	}
	flush(): void {
		if (this._destroyed) return;
		this._cancelTimer();
		this._flush();
	}

	getState(): GridTransactionStreamState {
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

	destroy(): void {
		if (this._destroyed) return;
		this._destroyed = true;
		this._cancelTimer();
		this.pendingCells.clear();
		this.pendingRows.clear();
		this.deps.onDestroy();
	}

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

		const t0 = _now();
		this._lastError = null;

		try {
			this._flushCells();
			this._flushRows();
			this._committedBatches++;
		} catch (e) {
			this._lastError = e instanceof Error ? e.message : String(e);
		}

		this._lastFlushDurationMs = _now() - t0;
	}

	private _flushCells(): void {
		if (this.pendingCells.size === 0) return;

		const toCommit: { rowId: string; colField: string; value: unknown }[] = [];
		const policy = this.opts.dirtyCellPolicy;

		for (const [, u] of this.pendingCells) {
			const isDirty = this.deps.isCellDirty(u.rowId, u.colField);

			if (isDirty && policy === 'skip') {
				this._skippedDirtyUpdates++;
				this.deps.onSkipped(u.rowId, u.colField, u.value);
				continue;
			}

			if (isDirty && policy === 'markConflict') {
				this._skippedDirtyUpdates++;
				const localValue = this.deps.getRawCellValue(u.rowId, u.colField);
				this.deps.onConflict(u.rowId, u.colField, localValue, u.value);
				// Do NOT commit remote value
				continue;
			}

			// 'remoteWins' or cell is clean — proceed with commit
			toCommit.push(u);
		}

		this.pendingCells.clear();

		if (toCommit.length === 0) return;

		this.deps.commitCells(toCommit);

		if (this.opts.flashChanges) {
			this.deps.onFlash(toCommit.map((c) => ({ rowId: c.rowId, colField: c.colField })));
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
}

function _now(): number {
	return typeof performance !== 'undefined' ? Math.floor(performance.timeOrigin + performance.now()) : 0;
}

const _EMPTY: readonly GridCellDecoration[] = [];

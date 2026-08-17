/**
 * Canonical instrumentation-only metric names. Each name is owned by exactly one component.
 * Metrics that already live in RenderStats must not be duplicated here.
 *
 * Naming convention: <owner>_<event> in SCREAMING_SNAKE_CASE.
 * All counters are non-negative integers that increase monotonically until reset().
 */
export const enum GridMetric {
	// State reads (StateManager)
	STATE_READS = 'stateReads',

	// Row mutation classification (ClientRowModelController)
	ROW_MUTATION_INCREMENTAL = 'rowMutationIncremental',
	ROW_MUTATION_FULL_REBUILD = 'rowMutationFullRebuild',

	// Slot reuse path (rowCellBinder)
	SLOT_REBINDS = 'slotRebinds',

	// Cell view lifecycle (reconcileTopology in rowCellBindingLanes)
	CELL_VIEW_CREATED = 'cellViewCreated',
	CELL_VIEW_DESTROYED = 'cellViewDestroyed',
	CELL_VIEW_RELOCATED = 'cellViewRelocated',

	// Cell renderer lifecycle (PortalMountManager)
	CELL_RENDERER_MOUNTED = 'cellRendererMounted',
	STALE_CELL_OPERATION_REJECTED = 'staleCellOperationRejected',

	// Header / floating-filter view relocation (headerRenderer, floatingFilterRenderer)
	HEADER_VIEW_RELOCATED = 'headerViewRelocated',
	FLOATING_FILTER_VIEW_RELOCATED = 'floatingFilterViewRelocated',

	// Topology version change — emitted once per plan change from any renderer that detects it
	TOPOLOGY_VERSION_CHANGED = 'topologyVersionChanged',
}

/** Per-frame timing summary emitted by the frame coordinator. */
export interface FrameMetrics {
	kind: 'scroll' | 'full' | 'geometry';
	durationMs: number;
	rowsVisited: number;
	cellsWritten: number;
}

/** Emitted when the runtime falls back to a degraded path. */
export interface FallbackMetric {
	reason: string;
	component: string;
}

/** Immutable snapshot of accumulated instrumentation data. */
export interface GridInstrumentationSnapshot {
	readonly counters: Readonly<Partial<Record<GridMetric, number>>>;
	readonly frames: readonly FrameMetrics[];
	readonly fallbacks: readonly FallbackMetric[];
	/** Events omitted because their bounded diagnostic history was full. */
	readonly droppedFrames: number;
	readonly droppedFallbacks: number;
}

/**
 * Instrumentation sink contract. Internal components receive this interface so they
 * can record metrics without depending on a concrete implementation.
 *
 * Two implementations are provided:
 *   - `NoopGridInstrumentation` — minimal overhead, used in production
 *   - `RecordingGridInstrumentation` — accumulates data for tests and demos
 */
export interface GridInstrumentation {
	increment(metric: GridMetric, amount?: number): void;
	/** Read the current accumulated value for a single counter. Zero-allocation; returns 0 on noop. */
	get(metric: GridMetric): number;
	recordFrame(frame: FrameMetrics): void;
	recordFallback(event: FallbackMetric): void;
	snapshot(): GridInstrumentationSnapshot;
	reset(): void;
}

const EMPTY_SNAPSHOT: GridInstrumentationSnapshot = Object.freeze({
	counters: Object.freeze({} as Partial<Record<GridMetric, number>>),
	frames: Object.freeze([] as FrameMetrics[]),
	fallbacks: Object.freeze([] as FallbackMetric[]),
	droppedFrames: 0,
	droppedFallbacks: 0,
});

/** Minimal-overhead sink. All methods are no-ops; snapshot() returns a stable empty object. */
export class NoopGridInstrumentation implements GridInstrumentation {
	increment(_metric: GridMetric, _amount?: number): void {}
	get(_metric: GridMetric): number {
		return 0;
	}
	recordFrame(_frame: FrameMetrics): void {}
	recordFallback(_event: FallbackMetric): void {}
	snapshot(): GridInstrumentationSnapshot {
		return EMPTY_SNAPSHOT;
	}
	reset(): void {}
}

export interface RecordingGridInstrumentationOptions {
	/** Retained frame history. Zero disables frame history while preserving counters. */
	frameCapacity?: number;
	/** Retained fallback history. Zero disables fallback history while preserving counters. */
	fallbackCapacity?: number;
}

const DEFAULT_FRAME_CAPACITY = 512;
const DEFAULT_FALLBACK_CAPACITY = 128;

/**
 * Accumulates counters and bounded diagnostic histories for tests and devtools.
 * Histories are fixed-size ring buffers: a long session retains the newest events
 * without allocating proportionally to its lifetime.
 */
export class RecordingGridInstrumentation implements GridInstrumentation {
	private counters: Partial<Record<GridMetric, number>> = {};
	private readonly frameCapacity: number;
	private readonly fallbackCapacity: number;
	private frames: Array<FrameMetrics | undefined>;
	private fallbacks: Array<FallbackMetric | undefined>;
	private frameStart = 0;
	private frameSize = 0;
	private fallbackStart = 0;
	private fallbackSize = 0;
	private droppedFrames = 0;
	private droppedFallbacks = 0;

	constructor(options: RecordingGridInstrumentationOptions = {}) {
		this.frameCapacity = normalizeCapacity(options.frameCapacity, DEFAULT_FRAME_CAPACITY);
		this.fallbackCapacity = normalizeCapacity(options.fallbackCapacity, DEFAULT_FALLBACK_CAPACITY);
		this.frames = new Array(this.frameCapacity);
		this.fallbacks = new Array(this.fallbackCapacity);
	}

	increment(metric: GridMetric, amount = 1): void {
		this.counters[metric] = (this.counters[metric] ?? 0) + amount;
	}

	recordFrame(frame: FrameMetrics): void {
		this.recordBounded(this.frames, this.frameCapacity, frame, true);
	}

	recordFallback(event: FallbackMetric): void {
		this.recordBounded(this.fallbacks, this.fallbackCapacity, event, false);
	}

	snapshot(): GridInstrumentationSnapshot {
		return {
			counters: { ...this.counters },
			frames: this.snapshotBuffer(this.frames, this.frameStart, this.frameSize, this.frameCapacity),
			fallbacks: this.snapshotBuffer(this.fallbacks, this.fallbackStart, this.fallbackSize, this.fallbackCapacity),
			droppedFrames: this.droppedFrames,
			droppedFallbacks: this.droppedFallbacks,
		};
	}

	reset(): void {
		this.counters = {};
		this.frames.fill(undefined);
		this.fallbacks.fill(undefined);
		this.frameStart = 0;
		this.frameSize = 0;
		this.fallbackStart = 0;
		this.fallbackSize = 0;
		this.droppedFrames = 0;
		this.droppedFallbacks = 0;
	}

	/** Convenience: read a single counter (returns 0 if never incremented). */
	get(metric: GridMetric): number {
		return this.counters[metric] ?? 0;
	}

	private recordBounded<T>(buffer: Array<T | undefined>, capacity: number, item: T, isFrame: boolean): void {
		if (capacity === 0) {
			if (isFrame) this.droppedFrames++;
			else this.droppedFallbacks++;
			return;
		}
		const start = isFrame ? this.frameStart : this.fallbackStart;
		const size = isFrame ? this.frameSize : this.fallbackSize;
		const index = (start + size) % capacity;
		if (size < capacity) {
			buffer[index] = item;
			if (isFrame) this.frameSize++;
			else this.fallbackSize++;
			return;
		}
		buffer[start] = item;
		if (isFrame) {
			this.frameStart = (start + 1) % capacity;
			this.droppedFrames++;
		} else {
			this.fallbackStart = (start + 1) % capacity;
			this.droppedFallbacks++;
		}
	}

	private snapshotBuffer<T>(buffer: readonly (T | undefined)[], start: number, size: number, capacity: number): T[] {
		const snapshot: T[] = [];
		for (let index = 0; index < size; index++) {
			const entry = buffer[(start + index) % capacity];
			if (entry !== undefined) snapshot.push(entry);
		}
		return snapshot;
	}
}

function normalizeCapacity(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value) || value < 0) throw new Error('Instrumentation history capacity must be a non-negative finite integer');
	return Math.floor(value);
}

/** Shared no-op instance. Components that don't need recording can use this directly. */
export const NOOP_INSTRUMENTATION = new NoopGridInstrumentation();

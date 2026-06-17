/**
 * Canonical metric names. Each name is owned by exactly one component.
 *
 * Naming convention: <owner>_<event> in SCREAMING_SNAKE_CASE.
 * All counters are non-negative integers that increase monotonically until reset().
 */
export const enum GridMetric {
	// ── Paint orchestration (RenderOrchestrator) ─────────────────────
	FULL_PAINTS = 'fullPaints',
	ROW_PAINTS = 'rowPaints',
	CELL_PAINTS = 'cellPaints',
	HEADER_PAINTS = 'headerPaints',
	OVERLAY_PAINTS = 'overlayPaints',
	VIEWPORT_PAINTS = 'viewportPaints',
	GEOMETRY_RECOMPUTES = 'geometryRecomputes',

	// ── Scroll frame orchestration ────────────────────────────────────
	SCROLL_FRAMES = 'scrollFrames',
	VIEWPORT_RECYCLES = 'viewportRecycles',
	SAME_WINDOW_BAILOUTS = 'sameWindowBailouts',

	// ── Cell write path (CellSlot) ────────────────────────────────────
	CELL_TEXT_WRITES = 'cellTextWrites',
	CELL_CLASS_WRITES = 'cellClassWrites',
	CELL_TRANSFORM_WRITES = 'cellTransformWrites',
	CELL_WIDTH_WRITES = 'cellWidthWrites',
	CELL_LEFT_WRITES = 'cellLeftWrites',
	CELL_DOM_READS_AVOIDED = 'cellDomReadsAvoided',

	// ── Portal lifecycle (PortalMountManager) ─────────────────────────
	PORTAL_MOUNTS = 'portalMounts',
	PORTAL_RELEASES = 'portalReleases',
	PORTAL_FLUSHES = 'portalFlushes',
	PORTAL_DEFERRED = 'portalDeferred',

	// ── Custom renderer lifecycle (CustomRendererManager) ────────────
	CUSTOM_RENDERER_WARM_HITS = 'customRendererWarmHits',
	CUSTOM_RENDERER_WARM_MISSES = 'customRendererWarmMisses',
	CUSTOM_RENDERER_EVICTIONS = 'customRendererEvictions',

	// ── Data accessor hot path (GridEngine) ──────────────────────────
	GET_CELL_VALUE_CALLS = 'getCellValueCalls',
	VALUE_GETTER_CALLS = 'valueGetterCalls',
	FORMULA_CALLS = 'formulaCalls',

	// ── State reads (StateManager) ────────────────────────────────────
	STATE_READS = 'stateReads',

	// ── Row mutation classification (ClientRowModelController) ───────
	ROW_MUTATION_INCREMENTAL = 'rowMutationIncremental',
	ROW_MUTATION_FULL_REBUILD = 'rowMutationFullRebuild',

	// ── Slot reuse path (rowCellBinder) ───────────────────────────────
	SLOT_REBINDS = 'slotRebinds',
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
}

/**
 * Instrumentation sink contract. Internal components receive this interface so they
 * can record metrics without depending on a concrete implementation.
 *
 * Two implementations are provided:
 *   - `NoopGridInstrumentation`    — zero overhead, used in production
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

// ── No-op sink ────────────────────────────────────────────────────────────────

const EMPTY_SNAPSHOT: GridInstrumentationSnapshot = Object.freeze({
	counters: Object.freeze({} as Partial<Record<GridMetric, number>>),
	frames: Object.freeze([] as FrameMetrics[]),
	fallbacks: Object.freeze([] as FallbackMetric[]),
});

/** Zero-overhead sink. All methods are no-ops; snapshot() returns a stable empty object. */
export class NoopGridInstrumentation implements GridInstrumentation {
	increment(_metric: GridMetric, _amount?: number): void {}
	get(_metric: GridMetric): number { return 0; }
	recordFrame(_frame: FrameMetrics): void {}
	recordFallback(_event: FallbackMetric): void {}
	snapshot(): GridInstrumentationSnapshot {
		return EMPTY_SNAPSHOT;
	}
	reset(): void {}
}

// ── Recording sink ────────────────────────────────────────────────────────────

/** Accumulates counters, frames, and fallbacks. Intended for tests and perf demos. */
export class RecordingGridInstrumentation implements GridInstrumentation {
	private counters: Partial<Record<GridMetric, number>> = {};
	private frames: FrameMetrics[] = [];
	private fallbacks: FallbackMetric[] = [];

	increment(metric: GridMetric, amount = 1): void {
		this.counters[metric] = (this.counters[metric] ?? 0) + amount;
	}

	recordFrame(frame: FrameMetrics): void {
		this.frames.push(frame);
	}

	recordFallback(event: FallbackMetric): void {
		this.fallbacks.push(event);
	}

	snapshot(): GridInstrumentationSnapshot {
		return {
			counters: { ...this.counters },
			frames: [...this.frames],
			fallbacks: [...this.fallbacks],
		};
	}

	reset(): void {
		this.counters = {};
		this.frames = [];
		this.fallbacks = [];
	}

	/** Convenience: read a single counter (returns 0 if never incremented). */
	get(metric: GridMetric): number {
		return this.counters[metric] ?? 0;
	}
}

/** Shared no-op instance. Components that don't need recording can use this directly. */
export const NOOP_INSTRUMENTATION = new NoopGridInstrumentation();

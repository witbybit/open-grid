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

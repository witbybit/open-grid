import type { ColumnInstanceId } from '../columnDef.js';
import { diffRenderWindow, type RenderWindow, type ViewportDelta } from './renderWindow.js';
import { computeColumnWindowDelta, type ColumnWindowDelta, type CompiledColumnTopology } from './columnTopology.js';

/**
 * One frame's complete render/live/retention plan — a facade over existing, already-correct
 * machinery (diffRenderWindow, computeColumnWindowDelta), not a reimplementation. Nothing computed
 * here duplicates renderWindow.ts/columnTopology.ts's own logic; this exists so callers have one
 * object to read "what changed and what's live this frame" from, instead of re-deriving it.
 */
export interface ViewportPlan {
	/** Monotonic per-plan sequence number — usable as a stale-guard token by future async work. */
	readonly frame: number;
	readonly renderWindow: RenderWindow;
	/** Row/column entered/exited/stayed for the routine (non-topology-changing) scroll case. */
	readonly viewportDelta: ViewportDelta;
	readonly columnTopology: CompiledColumnTopology;
	/** Present only on frames where the column topology's LANE STRUCTURE changed (pin/unpin/reorder/
	 *  resize) — see ColumnTopologyCoordinator's doc comment for why this is a separate, rarer signal
	 *  than viewportDelta's routine index-based entered/exited/stayed. */
	readonly columnWindowDelta: ColumnWindowDelta | undefined;
	/** Rows with at least one cell whose resolved presentation this frame was 'live'-mode (mounted/
	 *  updated during scroll). Caller-populated post-bind (the resolver, not this planner, decides
	 *  which cells are live) — deliberately the FULL live set, not a frame-budget-gated subset; that
	 *  gating is out of scope for this pass (see GridRendererOptions.liveReact, currently unenforced). */
	readonly liveRows: Set<string>;
	readonly liveCenterColumns: Set<ColumnInstanceId>;
	/** Row indices forced into the render window by vertical focus/edit retention despite falling
	 *  outside the normal row-index range this frame. Always a subset of what renderWindow ends up
	 *  covering once the caller applies retention (see rowWindowRetention.ts). */
	readonly retainedFocusEditRowIndices: ReadonlySet<number>;
}

/**
 * Computes one ViewportPlan per frame. Stateful only in the sense of remembering the previous
 * window/topology to diff against — it does not own the render window or topology themselves
 * (RowRenderer/ColumnTopologyCoordinator still do), and does not perform any DOM work.
 */
export class ViewportPlanner<TRowData = unknown> {
	private frameCounter = 0;
	private prevWindow: RenderWindow | null = null;
	private prevTopology: CompiledColumnTopology | null = null;

	public computePlan(
		window: RenderWindow,
		topology: CompiledColumnTopology,
		retainedFocusEditRowIndices: ReadonlySet<number> = new Set()
	): ViewportPlan {
		const viewportDelta = diffRenderWindow(this.prevWindow, window);
		const columnWindowDelta =
			this.prevTopology && this.prevTopology.version !== topology.version ? computeColumnWindowDelta(this.prevTopology, topology) : undefined;

		this.prevWindow = window;
		this.prevTopology = topology;

		return {
			frame: ++this.frameCounter,
			renderWindow: window,
			viewportDelta,
			columnTopology: topology,
			columnWindowDelta,
			// Populated by the caller after the bind pass resolves presentations for this frame's
			// cells — the resolver (scrollCellPresentation.ts) is the only thing that knows which
			// cells came out 'live'; this planner runs before that resolution happens.
			liveRows: new Set(),
			liveCenterColumns: new Set(),
			retainedFocusEditRowIndices,
		};
	}

	/** Resets diffing state — e.g. on full remount, so the next computePlan() treats the window/
	 *  topology as freshly-entered rather than diffing against stale prior state. */
	public reset(): void {
		this.prevWindow = null;
		this.prevTopology = null;
		this.frameCounter = 0;
	}
}

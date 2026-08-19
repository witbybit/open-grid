import type { CompiledGridPlan } from '../columnDef.js';
import { compileColumnTopology, computeColumnWindowDelta, type CompiledColumnTopology } from './columnTopology.js';

/** Minimal telemetry sink this coordinator writes into — a subset of RenderRuntimeStats. */
export interface ColumnTopologyDeltaTelemetrySink {
	columnTopologyDeltaComputations?: number;
	columnTopologyDeltaComputationsDuringScroll?: number;
	columnTopologyStayedColumns?: number;
	columnTopologyEnteredColumns?: number;
	columnTopologyExitedColumns?: number;
	columnTopologyLaneMoves?: number;
}

/**
 * Sole owner of the compiled column topology cache and the topology-CHANGE delta it drives.
 * Previously this cache (`cachedColumnTopology`/`cachedColumnTopologyVersion`) and its accompanying
 * delta-telemetry computation lived inline as private fields/logic on `RowRenderer` — a real, if
 * small, piece of self-contained state (unlike `rotateViewportSlots`, which genuinely has no
 * separable ownership from `RowRenderer`'s row-slot-pool fields). Extracting it here means
 * `RowRenderer` no longer needs to know how topology caching or its delta telemetry work at all.
 *
 * Recompiles only when `plan.version` changes (pin/unpin/reorder/resize) — NOT on routine horizontal
 * scroll, which shifts the render window over a static topology (see `diffRenderWindow`'s
 * `cols{Entered,Exited,Stayed}DuringScroll` counters for that separate, already-delta-driven case).
 * The delta this class computes is a DIFFERENT, rarer signal: how the topology's LANE STRUCTURE
 * itself changed, in particular `laneMoves` (a column crossing between pinned/center), which the
 * render-window index diff can never see.
 */
export class ColumnTopologyCoordinator<TRowData = unknown> {
	private cachedTopology: CompiledColumnTopology | null = null;
	private cachedVersion = -1;

	/**
	 * Returns the compiled topology for `plan`, recompiling only when `plan.version` has changed
	 * since the last call. When a recompile happens and a previous topology existed, records the
	 * topology-change delta into `renderStats` (if provided) — purely additive telemetry, never
	 * altering which topology is returned.
	 */
	public getCompiledTopology(
		plan: CompiledGridPlan<TRowData>,
		isScrollFrameActive: boolean,
		renderStats?: ColumnTopologyDeltaTelemetrySink | null
	): CompiledColumnTopology {
		if (this.cachedTopology && this.cachedVersion === plan.version) {
			return this.cachedTopology;
		}
		const topology = compileColumnTopology(plan);
		if (this.cachedTopology && renderStats) {
			const delta = computeColumnWindowDelta(this.cachedTopology, topology);
			renderStats.columnTopologyDeltaComputations = (renderStats.columnTopologyDeltaComputations || 0) + 1;
			if (isScrollFrameActive) {
				renderStats.columnTopologyDeltaComputationsDuringScroll = (renderStats.columnTopologyDeltaComputationsDuringScroll || 0) + 1;
			}
			renderStats.columnTopologyStayedColumns = (renderStats.columnTopologyStayedColumns || 0) + delta.stayedCenterColumns.length;
			renderStats.columnTopologyEnteredColumns =
				(renderStats.columnTopologyEnteredColumns || 0) +
				delta.enteredCenterColumns.length +
				delta.enteredPinnedLeftColumns.length +
				delta.enteredPinnedRightColumns.length;
			renderStats.columnTopologyExitedColumns =
				(renderStats.columnTopologyExitedColumns || 0) +
				delta.exitedCenterColumns.length +
				delta.exitedPinnedLeftColumns.length +
				delta.exitedPinnedRightColumns.length;
			renderStats.columnTopologyLaneMoves = (renderStats.columnTopologyLaneMoves || 0) + delta.laneMoves.length;
		}
		this.cachedTopology = topology;
		this.cachedVersion = plan.version;
		return topology;
	}
}

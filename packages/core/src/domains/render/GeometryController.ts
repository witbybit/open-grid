import type { CompiledColumnTopology } from './ColumnTopologyCompiler.js';

/**
 * Computes and caches row-geometry arrays (tops, heights) for the renderer.
 *
 * Row tops are derived from a uniform default row height plus any per-row overrides stored in
 * `_rowHeights`. When the cache is invalidated it is rebuilt lazily on the next access.
 *
 * Column geometry is not computed here — it is a compiled {@link CompiledColumnTopology} produced
 * by {@link compileColumnTopology} and pushed in via {@link updateTopology}.
 */
export class GeometryController {
	// Per-row height overrides. Absent entries fall back to the default row height.
	private readonly _rowHeights = new Map<number, number>();

	// Cached prefix-sum array: _tops[i] = top pixel of visual row i.
	// null means the cache is dirty and must be rebuilt before use.
	private _tops: Float64Array | null = null;

	// The row count and default row height the cache was built for.
	private _cachedRowCount = 0;
	private _cachedDefaultRowHeight = 0;

	// Latest compiled column topology (updated externally via updateTopology).
	private _topology: CompiledColumnTopology | null = null;

	// -------------------------------------------------------------------------
	// Column topology
	// -------------------------------------------------------------------------

	/** Replace the active column topology (called after ColumnTopologyCompiler runs). */
	updateTopology(topology: CompiledColumnTopology): void {
		this._topology = topology;
	}

	/** Returns the current compiled column topology, or null if not yet set. */
	getTopology(): CompiledColumnTopology | null {
		return this._topology;
	}

	// -------------------------------------------------------------------------
	// Invalidation
	// -------------------------------------------------------------------------

	/** Mark a single visual row as dirty. The cache is rebuilt on the next access. */
	invalidateRow(_visualRowIndex: number): void {
		// A change to any row shifts every top below it, so we must rebuild the
		// full prefix-sum array regardless of which row changed.
		this._tops = null;
	}

	/** Mark all rows as dirty. */
	invalidateAllRows(): void {
		this._tops = null;
	}

	// -------------------------------------------------------------------------
	// Direct mutations
	// -------------------------------------------------------------------------

	/** Override the rendered height of a visual row (e.g. from a row-resize drag). */
	setRowHeight(visualRowIndex: number, height: number): void {
		this._rowHeights.set(visualRowIndex, height);
		this._tops = null;
	}

	// -------------------------------------------------------------------------
	// Recompute
	// -------------------------------------------------------------------------

	/**
	 * Rebuild the tops cache if dirty.
	 *
	 * @param rowCount          Number of visual rows.
	 * @param defaultRowHeight  Fallback height for rows without an explicit override.
	 * @param rowHeightFn       Optional per-index height provider (takes precedence over stored
	 *                          overrides when provided).
	 */
	recomputeIfNeeded(rowCount: number, defaultRowHeight: number, rowHeightFn?: (index: number) => number): void {
		if (this._tops !== null && this._cachedRowCount === rowCount && this._cachedDefaultRowHeight === defaultRowHeight) {
			return;
		}

		this._rebuild(rowCount, defaultRowHeight, rowHeightFn);
	}

	private _rebuild(rowCount: number, defaultRowHeight: number, rowHeightFn?: (index: number) => number): void {
		const tops = new Float64Array(rowCount);
		let running = 0;

		for (let i = 0; i < rowCount; i++) {
			tops[i] = running;
			const h = rowHeightFn ? rowHeightFn(i) : (this._rowHeights.get(i) ?? defaultRowHeight);
			running += h;
		}

		this._tops = tops;
		this._cachedRowCount = rowCount;
		this._cachedDefaultRowHeight = defaultRowHeight;
	}

	// -------------------------------------------------------------------------
	// Row geometry accessors
	// -------------------------------------------------------------------------

	/**
	 * Top pixel offset of the visual row at `visualRowIndex`.
	 * Throws if the cache has not been built yet (call {@link recomputeIfNeeded} first).
	 */
	getRowTop(visualRowIndex: number): number {
		if (this._tops === null) {
			throw new Error('GeometryController: cache is dirty — call recomputeIfNeeded() before getRowTop()');
		}
		if (visualRowIndex < 0 || visualRowIndex >= this._tops.length) return 0;
		return this._tops[visualRowIndex];
	}

	/**
	 * Height of the visual row at `visualRowIndex`.
	 * Falls back to `defaultRowHeight` when no override is set for this index.
	 */
	getRowHeight(visualRowIndex: number, defaultRowHeight: number): number {
		return this._rowHeights.get(visualRowIndex) ?? defaultRowHeight;
	}

	/**
	 * Total pixel height of all `rowCount` rows using `defaultRowHeight` for unoverridden rows.
	 * Does not require the cache to be warm — it sums overrides + fills the rest with the default.
	 */
	getTotalRowsHeight(rowCount: number, defaultRowHeight: number): number {
		if (rowCount <= 0) return 0;

		// Sum overrides that fall within [0, rowCount)
		let overrideTotal = 0;
		let overrideCount = 0;
		for (const [idx, h] of this._rowHeights) {
			if (idx >= 0 && idx < rowCount) {
				overrideTotal += h;
				overrideCount++;
			}
		}

		return overrideTotal + (rowCount - overrideCount) * defaultRowHeight;
	}
}

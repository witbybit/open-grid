import type { GridCellDecoration, GridInsightLayer, GridInsightLayerId, GridRowDecoration } from './insightTypes.js';

const EMPTY_CELL_DECORATIONS: readonly GridCellDecoration[] = [];
const EMPTY_ROW_DECORATIONS: readonly GridRowDecoration[] = [];

/**
 * Central registry for all active insight layers.
 * Lives on GridEngine.insights; consumed by the renderer to apply decorations.
 *
 * Rules:
 *  - Registering the same id replaces the old layer (calls destroy first).
 *  - unregister() calls destroy() on the removed layer.
 *  - clear() calls destroy() on all layers.
 *  - All returned arrays are snapshots — callers must not mutate them.
 *  - The registry has no knowledge of specific feature implementations.
 */
export class GridInsightRegistry {
	private readonly layers = new Map<GridInsightLayerId, GridInsightLayer>();
	private version = 0;

	get size(): number {
		return this.layers.size;
	}

	getVersion(): number {
		return this.version;
	}

	private bumpVersion(): void {
		this.version++;
	}

	register(layer: GridInsightLayer): void {
		const existing = this.layers.get(layer.id);
		existing?.destroy?.();
		this.layers.set(layer.id, layer);
		this.bumpVersion();
	}

	unregister(id: GridInsightLayerId): void {
		const layer = this.layers.get(id);
		if (layer) {
			layer.destroy?.();
			this.layers.delete(id);
			this.bumpVersion();
		}
	}

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		if (this.layers.size === 0) return EMPTY_CELL_DECORATIONS;
		let result: GridCellDecoration[] | null = null;
		for (const layer of this.layers.values()) {
			const decs = layer.getCellDecorations?.(rowId, colField);
			if (decs && decs.length > 0) {
				if (!result) result = [];
				for (const d of decs) result.push(d);
			}
		}
		return result ?? EMPTY_CELL_DECORATIONS;
	}

	getRowDecorations(rowId: string): readonly GridRowDecoration[] {
		if (this.layers.size === 0) return EMPTY_ROW_DECORATIONS;
		let result: GridRowDecoration[] | null = null;
		for (const layer of this.layers.values()) {
			const decs = layer.getRowDecorations?.(rowId);
			if (decs && decs.length > 0) {
				if (!result) result = [];
				for (const d of decs) result.push(d);
			}
		}
		return result ?? EMPTY_ROW_DECORATIONS;
	}

	/** Returns a per-layer diagnostics snapshot suitable for DevTools rendering. */
	getDiagnostics(): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [id, layer] of this.layers) {
			result[id] = layer.getDiagnostics?.() ?? null;
		}
		return result;
	}

	/** Destroys and removes all registered layers. Called on grid destroy. */
	clear(): void {
		if (this.layers.size === 0) return;
		for (const layer of this.layers.values()) {
			layer.destroy?.();
		}
		this.layers.clear();
		this.bumpVersion();
	}
}

import type { InvalidationFrame } from './invalidationManager.js';

export interface RenderStats {
	fullPaints: number;
	rowPaints: number;
	cellPaints: number;
	headerPaints: number;
	overlayPaints: number;
	geometryRecomputes: number;
	viewportPaints: number;
	lastInvalidationReasons: string[];
	portalMounts?: { cells: number; rows: number; menus: number };
}

export interface RenderOrchestratorTargets {
	recomputeGeometry(): void;
	syncViewport(frame: InvalidationFrame): void;
	syncHeaders(frame: InvalidationFrame): void;
	syncOverlay(frame: InvalidationFrame): void;
	syncRows(frame: InvalidationFrame): void;
	syncCells(frame: InvalidationFrame): void;
	fullPaint(frame: InvalidationFrame): void;
}

export class RenderOrchestrator {
	private readonly targets: RenderOrchestratorTargets;
	private readonly stats: RenderStats = {
		fullPaints: 0,
		rowPaints: 0,
		cellPaints: 0,
		headerPaints: 0,
		overlayPaints: 0,
		geometryRecomputes: 0,
		viewportPaints: 0,
		lastInvalidationReasons: [],
	};

	constructor(targets: RenderOrchestratorTargets) {
		this.targets = targets;
	}

	public flush(frame: InvalidationFrame): void {
		this.stats.lastInvalidationReasons = frame.reasons;

		if (frame.full) {
			this.stats.fullPaints++;
			this.targets.fullPaint(frame);
			return;
		}

		if (frame.geometry) {
			this.stats.geometryRecomputes++;
			this.targets.recomputeGeometry();
		}

		if (frame.viewport) {
			this.stats.viewportPaints++;
			this.targets.syncViewport(frame);
		}

		if (frame.rows.size > 0) {
			this.stats.rowPaints += frame.rows.size;
			this.targets.syncRows(frame);
		}

		if (frame.cells.size > 0 || frame.columns.size > 0) {
			this.stats.cellPaints += frame.cells.size;
			this.targets.syncCells(frame);
		}

		if (frame.headers) {
			this.stats.headerPaints++;
			this.targets.syncHeaders(frame);
		}

		if (frame.overlay || frame.cells.size > 0 || frame.rows.size > 0) {
			this.stats.overlayPaints++;
			this.targets.syncOverlay(frame);
		}
	}

	public getStats(): RenderStats {
		return {
			...this.stats,
			lastInvalidationReasons: this.stats.lastInvalidationReasons.slice(),
		};
	}
}

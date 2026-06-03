import type { InvalidationFrame } from './invalidationManager.js';

export interface RenderStats {
	fullPaints: number;
	rowPaints: number;
	cellPaints: number;
	headerPaints: number;
	overlayPaints: number;
	geometryRecomputes: number;
	viewportPaints: number;
	scrollFrames: number;
	viewportRecycles: number;
	headerPaintsDuringScroll: number;
	overlayPaintsDuringScroll: number;
	portalFlushesDuringScroll: number;
	portalMountsDuringScroll: number;
	portalReleasesDuringScroll: number;
	hotDomReleases: number;
	coldDomReleases: number;
	cellsPatchedPerScrollFrame: number[];
	rowsRecycledPerScrollFrame: number[];
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
		scrollFrames: 0,
		viewportRecycles: 0,
		headerPaintsDuringScroll: 0,
		overlayPaintsDuringScroll: 0,
		portalFlushesDuringScroll: 0,
		portalMountsDuringScroll: 0,
		portalReleasesDuringScroll: 0,
		hotDomReleases: 0,
		coldDomReleases: 0,
		cellsPatchedPerScrollFrame: [],
		rowsRecycledPerScrollFrame: [],
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
			cellsPatchedPerScrollFrame: this.stats.cellsPatchedPerScrollFrame.slice(),
			rowsRecycledPerScrollFrame: this.stats.rowsRecycledPerScrollFrame.slice(),
			lastInvalidationReasons: this.stats.lastInvalidationReasons.slice(),
		};
	}

	public resetStats(): void {
		this.stats.fullPaints = 0;
		this.stats.rowPaints = 0;
		this.stats.cellPaints = 0;
		this.stats.headerPaints = 0;
		this.stats.overlayPaints = 0;
		this.stats.geometryRecomputes = 0;
		this.stats.viewportPaints = 0;
		this.stats.scrollFrames = 0;
		this.stats.viewportRecycles = 0;
		this.stats.headerPaintsDuringScroll = 0;
		this.stats.overlayPaintsDuringScroll = 0;
		this.stats.portalFlushesDuringScroll = 0;
		this.stats.portalMountsDuringScroll = 0;
		this.stats.portalReleasesDuringScroll = 0;
		this.stats.hotDomReleases = 0;
		this.stats.coldDomReleases = 0;
		this.stats.cellsPatchedPerScrollFrame = [];
		this.stats.rowsRecycledPerScrollFrame = [];
		this.stats.lastInvalidationReasons = [];
	}
}

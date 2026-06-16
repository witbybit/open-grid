import type { GridInvalidation, InvalidationFrame } from './invalidationManager.js';

export interface RenderStats {
	fullPaints: number;
	runtimeLimitsClamped?: number;
	rowPaints: number;
	cellPaints: number;
	headerPaints: number;
	overlayPaints: number;
	geometryRecomputes: number;
	viewportPaints: number;
	scrollFrames: number;
	viewportRecycles: number;
	headerPaintsDuringScroll: number;
	headerRangeSyncsDuringScroll: number;
	overlayPaintsDuringScroll: number;
	overlayCheapSyncsDuringScroll: number;
	portalFlushesDuringScroll: number;
	portalDeferredDuringScroll: number;
	portalMountsDuringScroll: number;
	portalReleasesDuringScroll: number;
	portalFlushChunks: number;
	maxPortalOpsFlushedInOneChunk: number;
	focusCallsDuringScroll: number;
	rootTextContentWritesOnPortalCells: number;
	cellsBoundDuringScroll: number;
	rowsVisitedDuringScroll: number;
	rowsReboundDuringScroll: number;
	cellsVisitedDuringScroll: number;
	cellsWrittenDuringScroll: number;
	portalOpsDuringScroll: number;
	cellsDecoratedAfterScroll: number;
	rowsEnteredDuringScroll: number;
	rowsExitedDuringScroll: number;
	rowsStayedDuringScroll: number;
	colsEnteredDuringScroll: number;
	colsExitedDuringScroll: number;
	colsStayedDuringScroll: number;
	cellsSkippedDuringScroll: number;
	sameWindowBailouts: number;
	stateReadsDuringScroll: number;
	compiledPlanVersion?: number;
	cellAccessReadsDuringScroll: number;
	cellClassComputesDuringScroll: number;
	dirtyCellsMarkedDuringScroll: number;
	postScrollDirtyCellsDecorated: number;
	reusableCellsSkippedDuringScroll: number;
	styleHookCallsDuringScroll: number;
	hotDomReleases: number;
	coldDomReleases: number;
	cellsPatchedPerScrollFrame: number[];
	rowsRecycledPerScrollFrame: number[];
	lastInvalidationReasons: string[];
	lastInvalidations: GridInvalidation[];
	portalMounts?: { cells: number; rows: number; menus: number; custom?: any };
	getCellValueCallsDuringScroll?: number;
	valueGetterCallsDuringScroll?: number;
	formulaCallsDuringScroll?: number;
	customRendererMountsDuringScroll?: number;
	customRendererHydrationChunks?: number;
	customRendererWarmHits?: number;
	customRendererWarmMisses?: number;
}

/** Returns a zero-value RenderStats object. Used by GridStore.getRenderStats() when no render engine is mounted. */
export function createEmptyRenderStats(): RenderStats {
	return {
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
		headerRangeSyncsDuringScroll: 0,
		overlayPaintsDuringScroll: 0,
		overlayCheapSyncsDuringScroll: 0,
		portalFlushesDuringScroll: 0,
		portalDeferredDuringScroll: 0,
		portalMountsDuringScroll: 0,
		portalReleasesDuringScroll: 0,
		portalFlushChunks: 0,
		maxPortalOpsFlushedInOneChunk: 0,
		focusCallsDuringScroll: 0,
		rootTextContentWritesOnPortalCells: 0,
		cellsBoundDuringScroll: 0,
		rowsVisitedDuringScroll: 0,
		rowsReboundDuringScroll: 0,
		cellsVisitedDuringScroll: 0,
		cellsWrittenDuringScroll: 0,
		portalOpsDuringScroll: 0,
		cellsDecoratedAfterScroll: 0,
		rowsEnteredDuringScroll: 0,
		rowsExitedDuringScroll: 0,
		rowsStayedDuringScroll: 0,
		colsEnteredDuringScroll: 0,
		colsExitedDuringScroll: 0,
		colsStayedDuringScroll: 0,
		cellsSkippedDuringScroll: 0,
		sameWindowBailouts: 0,
		stateReadsDuringScroll: 0,
		compiledPlanVersion: 0,
		hotDomReleases: 0,
		coldDomReleases: 0,
		cellsPatchedPerScrollFrame: [],
		rowsRecycledPerScrollFrame: [],
		lastInvalidationReasons: [],
		lastInvalidations: [],
		portalMounts: { cells: 0, rows: 0, menus: 0, custom: { active: 0, warm: 0, cold: 0, hydrationQueue: 0, completedChunks: 0 } },
		getCellValueCallsDuringScroll: 0,
		valueGetterCallsDuringScroll: 0,
		formulaCallsDuringScroll: 0,
		customRendererMountsDuringScroll: 0,
		customRendererHydrationChunks: 0,
		customRendererWarmHits: 0,
		customRendererWarmMisses: 0,
		cellAccessReadsDuringScroll: 0,
		cellClassComputesDuringScroll: 0,
		dirtyCellsMarkedDuringScroll: 0,
		postScrollDirtyCellsDecorated: 0,
		reusableCellsSkippedDuringScroll: 0,
		styleHookCallsDuringScroll: 0,
	};
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
		runtimeLimitsClamped: 0,
		rowPaints: 0,
		cellPaints: 0,
		headerPaints: 0,
		overlayPaints: 0,
		geometryRecomputes: 0,
		viewportPaints: 0,
		scrollFrames: 0,
		viewportRecycles: 0,
		headerPaintsDuringScroll: 0,
		headerRangeSyncsDuringScroll: 0,
		overlayPaintsDuringScroll: 0,
		overlayCheapSyncsDuringScroll: 0,
		portalFlushesDuringScroll: 0,
		portalDeferredDuringScroll: 0,
		portalMountsDuringScroll: 0,
		portalReleasesDuringScroll: 0,
		portalFlushChunks: 0,
		maxPortalOpsFlushedInOneChunk: 0,
		focusCallsDuringScroll: 0,
		rootTextContentWritesOnPortalCells: 0,
		cellsBoundDuringScroll: 0,
		rowsVisitedDuringScroll: 0,
		rowsReboundDuringScroll: 0,
		cellsVisitedDuringScroll: 0,
		cellsWrittenDuringScroll: 0,
		portalOpsDuringScroll: 0,
		cellsDecoratedAfterScroll: 0,
		rowsEnteredDuringScroll: 0,
		rowsExitedDuringScroll: 0,
		rowsStayedDuringScroll: 0,
		colsEnteredDuringScroll: 0,
		colsExitedDuringScroll: 0,
		colsStayedDuringScroll: 0,
		cellsSkippedDuringScroll: 0,
		sameWindowBailouts: 0,
		stateReadsDuringScroll: 0,
		cellAccessReadsDuringScroll: 0,
		cellClassComputesDuringScroll: 0,
		dirtyCellsMarkedDuringScroll: 0,
		postScrollDirtyCellsDecorated: 0,
		reusableCellsSkippedDuringScroll: 0,
		styleHookCallsDuringScroll: 0,
		hotDomReleases: 0,
		coldDomReleases: 0,
		cellsPatchedPerScrollFrame: [],
		rowsRecycledPerScrollFrame: [],
		lastInvalidationReasons: [],
		lastInvalidations: [],
	};

	constructor(targets: RenderOrchestratorTargets) {
		this.targets = targets;
	}

	public flush(frame: InvalidationFrame): void {
		this.stats.lastInvalidationReasons = frame.reasons;
		this.stats.lastInvalidations = frame.invalidations;

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

		const cellCount = this.countCells(frame.cellsByRowId);
		if (cellCount > 0 || frame.columns.size > 0) {
			this.stats.cellPaints += cellCount;
			this.targets.syncCells(frame);
		}

		if (frame.headers) {
			this.stats.headerPaints++;
			this.targets.syncHeaders(frame);
		}

		if (frame.overlay || cellCount > 0 || frame.rows.size > 0) {
			this.stats.overlayPaints++;
			this.targets.syncOverlay(frame);
		}
	}

	private countCells(cellsByRowId: Map<string, Set<string>>): number {
		let count = 0;
		for (const colIds of cellsByRowId.values()) {
			count += colIds.size;
		}
		return count;
	}

	public getStats(): RenderStats {
		return {
			...this.stats,
			cellsPatchedPerScrollFrame: this.stats.cellsPatchedPerScrollFrame.slice(),
			rowsRecycledPerScrollFrame: this.stats.rowsRecycledPerScrollFrame.slice(),
			lastInvalidationReasons: this.stats.lastInvalidationReasons.slice(),
			lastInvalidations: this.stats.lastInvalidations.slice(),
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
		this.stats.headerRangeSyncsDuringScroll = 0;
		this.stats.overlayPaintsDuringScroll = 0;
		this.stats.overlayCheapSyncsDuringScroll = 0;
		this.stats.portalFlushesDuringScroll = 0;
		this.stats.portalDeferredDuringScroll = 0;
		this.stats.portalMountsDuringScroll = 0;
		this.stats.portalReleasesDuringScroll = 0;
		this.stats.portalFlushChunks = 0;
		this.stats.maxPortalOpsFlushedInOneChunk = 0;
		this.stats.focusCallsDuringScroll = 0;
		this.stats.rootTextContentWritesOnPortalCells = 0;
		this.stats.cellsBoundDuringScroll = 0;
		this.stats.rowsVisitedDuringScroll = 0;
		this.stats.rowsReboundDuringScroll = 0;
		this.stats.cellsVisitedDuringScroll = 0;
		this.stats.cellsWrittenDuringScroll = 0;
		this.stats.portalOpsDuringScroll = 0;
		this.stats.cellsDecoratedAfterScroll = 0;
		this.stats.rowsEnteredDuringScroll = 0;
		this.stats.rowsExitedDuringScroll = 0;
		this.stats.rowsStayedDuringScroll = 0;
		this.stats.colsEnteredDuringScroll = 0;
		this.stats.colsExitedDuringScroll = 0;
		this.stats.colsStayedDuringScroll = 0;
		this.stats.cellsSkippedDuringScroll = 0;
		this.stats.sameWindowBailouts = 0;
		this.stats.cellAccessReadsDuringScroll = 0;
		this.stats.cellClassComputesDuringScroll = 0;
		this.stats.dirtyCellsMarkedDuringScroll = 0;
		this.stats.postScrollDirtyCellsDecorated = 0;
		this.stats.reusableCellsSkippedDuringScroll = 0;
		this.stats.styleHookCallsDuringScroll = 0;
		this.stats.hotDomReleases = 0;
		this.stats.coldDomReleases = 0;
		this.stats.cellsPatchedPerScrollFrame = [];
		this.stats.rowsRecycledPerScrollFrame = [];
		this.stats.lastInvalidationReasons = [];
		this.stats.lastInvalidations = [];
	}
}

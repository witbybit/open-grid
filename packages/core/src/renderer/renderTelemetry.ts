import type { GridEngine } from '../engine/GridEngine.js';
import type { PortalMountManager } from './portalMountManager.js';
import { type RenderOrchestrator, type RenderStats } from './renderOrchestrator.js';
import type { RowRenderer } from './rowRenderer.js';
import { cellSlotWriteStats, resetCellSlotWriteStats } from './cellSlot.js';
import { resetRowSlotWriteStats, rowSlotWriteStats } from './rowSlot.js';

export interface RenderRuntimeStats {
	rowSlotAssigns: number;
	rowSlotMoves: number;
	rowSlotRebinds: number;
	cellSlotRebinds: number;
	fullCellBinds: number;
	geometryOnlyCellBinds: number;
	reactMounts: number;
	reactRefreshes: number;
	reactUnmounts: number;
	scrollFrames: number;
	viewportRecycles: number;
	headerPaintsDuringScroll: number;
	headerRangeSyncsDuringScroll: number;
	overlayPaintsDuringScroll: number;
	overlayCheapSyncsDuringScroll: number;
	cellsPatchedPerScrollFrame: number[];
	rowsRecycledPerScrollFrame: number[];
	stateReadsDuringScroll: number;
	focusCallsDuringScroll: number;
	rootTextContentWritesOnPortalCells: number;
	cellTextWrites: number;
	cellClassWrites: number;
	cellTransformWrites: number;
	cellWidthWrites: number;
	cellLeftWrites: number;
	cellDomReadsAvoided: number;
	rowClassWrites: number;
	rowTransformWrites: number;
	rowHeightWrites: number;
	rowsVisitedDuringScroll: number;
	rowsReboundDuringScroll: number;
	cellsVisitedDuringScroll: number;
	cellsWrittenDuringScroll: number;
	portalOpsDuringScroll: number;
	cellAccessReadsDuringScroll: number;
	cellClassComputesDuringScroll: number;
	reusableCellsSkippedDuringScroll: number;
	styleHookCallsDuringScroll: number;
	portalFlushChunks: number;
	maxPortalOpsFlushedInOneChunk: number;
	postScrollDecorationChunks: number;
	maxCellsDecoratedInOneChunk: number;
	cellsDecoratedAfterScroll: number;
	rowsEnteredDuringScroll: number;
	rowsExitedDuringScroll: number;
	rowsStayedDuringScroll: number;
	colsEnteredDuringScroll: number;
	colsExitedDuringScroll: number;
	colsStayedDuringScroll: number;
	cellsSkippedDuringScroll: number;
	sameWindowBailouts: number;
	cellsBoundDuringScroll: number;
	runtimeLimitsClamped?: number;
}

export function createRenderRuntimeStats(): RenderRuntimeStats {
	return {
		rowSlotAssigns: 0,
		rowSlotMoves: 0,
		rowSlotRebinds: 0,
		cellSlotRebinds: 0,
		fullCellBinds: 0,
		geometryOnlyCellBinds: 0,
		reactMounts: 0,
		reactRefreshes: 0,
		reactUnmounts: 0,
		scrollFrames: 0,
		viewportRecycles: 0,
		headerPaintsDuringScroll: 0,
		headerRangeSyncsDuringScroll: 0,
		overlayPaintsDuringScroll: 0,
		overlayCheapSyncsDuringScroll: 0,
		cellsPatchedPerScrollFrame: [],
		rowsRecycledPerScrollFrame: [],
		stateReadsDuringScroll: 0,
		focusCallsDuringScroll: 0,
		rootTextContentWritesOnPortalCells: 0,
		cellTextWrites: 0,
		cellClassWrites: 0,
		cellTransformWrites: 0,
		cellWidthWrites: 0,
		cellLeftWrites: 0,
		cellDomReadsAvoided: 0,
		rowClassWrites: 0,
		rowTransformWrites: 0,
		rowHeightWrites: 0,
		rowsVisitedDuringScroll: 0,
		rowsReboundDuringScroll: 0,
		cellsVisitedDuringScroll: 0,
		cellsWrittenDuringScroll: 0,
		portalOpsDuringScroll: 0,
		cellAccessReadsDuringScroll: 0,
		cellClassComputesDuringScroll: 0,
		reusableCellsSkippedDuringScroll: 0,
		styleHookCallsDuringScroll: 0,
		portalFlushChunks: 0,
		maxPortalOpsFlushedInOneChunk: 0,
		postScrollDecorationChunks: 0,
		maxCellsDecoratedInOneChunk: 0,
		cellsDecoratedAfterScroll: 0,
		rowsEnteredDuringScroll: 0,
		rowsExitedDuringScroll: 0,
		rowsStayedDuringScroll: 0,
		colsEnteredDuringScroll: 0,
		colsExitedDuringScroll: 0,
		colsStayedDuringScroll: 0,
		cellsSkippedDuringScroll: 0,
		sameWindowBailouts: 0,
		cellsBoundDuringScroll: 0,
	};
}

export interface RenderTelemetrySnapshotDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	orchestrator: RenderOrchestrator;
	portalMountManager: PortalMountManager<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	runtimeStats: RenderRuntimeStats;
}

export function collectRenderStats<TRowData>(deps: RenderTelemetrySnapshotDeps<TRowData>): RenderStats {
	const stats = deps.orchestrator.getStats();
	const portalScrollStats = deps.portalMountManager.getScrollStats();
	return {
		...stats,
		rowSlotAssigns: deps.runtimeStats.rowSlotAssigns,
		rowSlotMoves: deps.runtimeStats.rowSlotMoves,
		rowSlotRebinds: deps.runtimeStats.rowSlotRebinds,
		cellSlotRebinds: deps.runtimeStats.cellSlotRebinds,
		fullCellBinds: deps.runtimeStats.fullCellBinds,
		geometryOnlyCellBinds: deps.runtimeStats.geometryOnlyCellBinds,
		reactMounts: deps.runtimeStats.reactMounts,
		reactRefreshes: deps.runtimeStats.reactRefreshes,
		reactUnmounts: deps.runtimeStats.reactUnmounts,
		scrollFrames: deps.runtimeStats.scrollFrames,
		viewportRecycles: deps.runtimeStats.viewportRecycles,
		headerPaintsDuringScroll: deps.runtimeStats.headerPaintsDuringScroll,
		headerRangeSyncsDuringScroll: deps.runtimeStats.headerRangeSyncsDuringScroll,
		overlayPaintsDuringScroll: deps.runtimeStats.overlayPaintsDuringScroll,
		overlayCheapSyncsDuringScroll: deps.runtimeStats.overlayCheapSyncsDuringScroll,
		focusCallsDuringScroll: deps.runtimeStats.focusCallsDuringScroll,
		rootTextContentWritesOnPortalCells: deps.runtimeStats.rootTextContentWritesOnPortalCells,
		cellTextWrites: cellSlotWriteStats.cellTextWrites,
		cellClassWrites: cellSlotWriteStats.cellClassWrites,
		cellTransformWrites: cellSlotWriteStats.cellTransformWrites,
		cellWidthWrites: cellSlotWriteStats.cellWidthWrites,
		cellLeftWrites: cellSlotWriteStats.cellLeftWrites,
		cellDomReadsAvoided: cellSlotWriteStats.cellDomReadsAvoided,
		rowClassWrites: rowSlotWriteStats.rowClassWrites,
		rowTransformWrites: rowSlotWriteStats.rowTransformWrites,
		rowHeightWrites: rowSlotWriteStats.rowHeightWrites,
		cellsBoundDuringScroll: deps.rowRenderer.currentScrollCellsPatched,
		rowsVisitedDuringScroll: deps.rowRenderer.currentScrollRowsVisited,
		rowsReboundDuringScroll: deps.rowRenderer.currentScrollRowsRebound,
		cellsVisitedDuringScroll: deps.rowRenderer.currentScrollCellsVisited,
		cellsWrittenDuringScroll: deps.rowRenderer.currentScrollCellsWritten,
		portalOpsDuringScroll:
			deps.rowRenderer.currentScrollPortalOps + portalScrollStats.portalMountsDuringScroll + portalScrollStats.portalReleasesDuringScroll,
		cellsDecoratedAfterScroll: deps.runtimeStats.cellsDecoratedAfterScroll,
		cellAccessReadsDuringScroll: deps.runtimeStats.cellAccessReadsDuringScroll,
		cellClassComputesDuringScroll: deps.runtimeStats.cellClassComputesDuringScroll,
		dirtyCellsMarkedDuringScroll: deps.rowRenderer.dirtyCellsMarkedDuringScroll,
		postScrollDirtyCellsDecorated: deps.rowRenderer.postScrollDirtyCellsDecorated,
		reusableCellsSkippedDuringScroll: deps.runtimeStats.reusableCellsSkippedDuringScroll,
		styleHookCallsDuringScroll: deps.runtimeStats.styleHookCallsDuringScroll,
		rowsEnteredDuringScroll: deps.runtimeStats.rowsEnteredDuringScroll,
		rowsExitedDuringScroll: deps.runtimeStats.rowsExitedDuringScroll,
		rowsStayedDuringScroll: deps.runtimeStats.rowsStayedDuringScroll,
		colsEnteredDuringScroll: deps.runtimeStats.colsEnteredDuringScroll,
		colsExitedDuringScroll: deps.runtimeStats.colsExitedDuringScroll,
		colsStayedDuringScroll: deps.runtimeStats.colsStayedDuringScroll,
		cellsSkippedDuringScroll: deps.runtimeStats.cellsSkippedDuringScroll,
		sameWindowBailouts: deps.runtimeStats.sameWindowBailouts,
		stateReadsDuringScroll: deps.runtimeStats.stateReadsDuringScroll,
		compiledPlanVersion: deps.engine.columns.getCompiledPlanVersion(),
		getCellValueCallsDuringScroll: deps.engine.getCellValueCallsDuringScroll,
		valueGetterCallsDuringScroll: deps.engine.valueGetterCallsDuringScroll,
		formulaCallsDuringScroll: deps.engine.formulaCallsDuringScroll,
		customRendererMountsDuringScroll: deps.engine.customRendererMountsDuringScroll,
		customRendererHydrationChunks: deps.engine.customRendererHydrationChunks,
		customRendererWarmHits: deps.engine.customRendererWarmHits,
		customRendererWarmMisses: deps.engine.customRendererWarmMisses,
		...portalScrollStats,
		hotDomReleases: deps.runtimeStats.rowsRecycledPerScrollFrame.reduce((a: number, b: number) => a + b, 0),
		coldDomReleases: 0,
		cellsPatchedPerScrollFrame: deps.runtimeStats.cellsPatchedPerScrollFrame.slice(),
		rowsRecycledPerScrollFrame: deps.runtimeStats.rowsRecycledPerScrollFrame.slice(),
		portalMounts: {
			...deps.portalMountManager.getStats(),
			custom: deps.portalMountManager.customRendererManager.getStats(),
		},
	};
}

export function resetRenderTelemetry<TRowData>(
	engine: GridEngine<TRowData>,
	orchestrator: RenderOrchestrator,
	portalMountManager: PortalMountManager<TRowData>,
	rowRenderer: RowRenderer<TRowData>,
	runtimeStats: RenderRuntimeStats
): void {
	orchestrator.resetStats();
	portalMountManager.resetStats();
	rowRenderer.dirtyCellsMarkedDuringScroll = 0;
	rowRenderer.postScrollDirtyCellsDecorated = 0;
	rowRenderer.currentScrollCellsPatched = 0;
	rowRenderer.currentScrollRowsRecycled = 0;
	rowRenderer.currentScrollRowsVisited = 0;
	rowRenderer.currentScrollRowsRebound = 0;
	rowRenderer.currentScrollCellsVisited = 0;
	rowRenderer.currentScrollCellsWritten = 0;
	rowRenderer.currentScrollPortalOps = 0;
	Object.assign(runtimeStats, createRenderRuntimeStats());
	engine.getCellValueCallsDuringScroll = 0;
	engine.valueGetterCallsDuringScroll = 0;
	engine.formulaCallsDuringScroll = 0;
	engine.customRendererMountsDuringScroll = 0;
	engine.customRendererHydrationChunks = 0;
	engine.customRendererWarmHits = 0;
	engine.customRendererWarmMisses = 0;
	resetCellSlotWriteStats();
	resetRowSlotWriteStats();
}

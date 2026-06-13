import { defaultGridScheduler } from './gridScheduler.js';
import { applyRenderWindowRuntimeLimits, computeRenderWindowInto, sameRenderedWindow, type RenderWindow } from './renderWindow.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import type { OverlayRenderer } from './overlayRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { RenderScheduler } from './renderScheduler.js';
import type { RenderRuntimeStats } from './renderTelemetry.js';
import type { RowRenderer } from './rowRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { HeaderRenderer } from './headerRenderer.js';
import type { StickyGroupRenderer } from './stickyGroupRenderer.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { LayoutTransitionController } from './layoutTransitionController.js';

export interface RenderScrollCoordinatorState<TRowData = unknown> {
	isScrolling: boolean;
	scrollEndRafId: number | null;
	scrollEndQuietFrames: number;
	scrollEndTickerActive: boolean;
	viewportDirtyAfterScroll: boolean;
	flushPendingAfterScroll: boolean;
	needsPostScrollPortalFlush: boolean;
	portalFlushScheduled: boolean;
	isScrollFrameActive: boolean;
	postScrollDecorationScheduled: boolean;
	postScrollDecorationTimer: number | null;
	cachedMaxScrollLeft: number;
	cachedTotalWidth: number;
	cachedTotalHeight: number;
	cachedDefaultRowHeight: number;
	cachedHasSelectionOverlay: boolean;
	scrollCtx: ScrollRenderContext<TRowData>;
	renderWindowBufs: [RenderWindow, RenderWindow];
	activeRenderWindowBufIdx: number;
	portalFlushBudget: number;
	postScrollDecorationBudget: number;
}

export interface RenderScrollCoordinatorDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	viewportRenderer: ViewportRenderer<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	headerRenderer: HeaderRenderer<TRowData>;
	overlayRenderer: OverlayRenderer<TRowData>;
	stickyGroupRenderer: StickyGroupRenderer<TRowData>;
	portalMountManager: PortalMountManager<TRowData>;
	scheduler: RenderScheduler;
	requestScrollFrame: () => void;
	layoutTransition: LayoutTransitionController<TRowData>;
	renderStats: RenderRuntimeStats;
	recycleViewport: (isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow) => void;
	syncLayoutPlan: (renderWindow?: RenderWindow) => GridLayoutPlan;
}

export class RenderScrollCoordinator<TRowData = unknown> {
	constructor(
		private readonly deps: RenderScrollCoordinatorDeps<TRowData>,
		private readonly state: RenderScrollCoordinatorState<TRowData>
	) {}

	public getIsScrolling(): boolean {
		return this.state.isScrolling;
	}

	public getIsScrollFrameActive(): boolean {
		return this.state.isScrollFrameActive;
	}

	public markFlushPendingAfterScroll(): void {
		this.state.flushPendingAfterScroll = true;
	}

	public markViewportDirtyAfterScroll(): void {
		this.state.viewportDirtyAfterScroll = true;
	}

	public onScroll = (scrollTop: number, scrollLeft: number, timestamp?: number): void => {
		const clampedScrollLeft = Math.max(0, Math.min(this.state.cachedMaxScrollLeft, scrollLeft));
		if (clampedScrollLeft !== scrollLeft && this.deps.viewportRenderer.scrollViewport) {
			this.deps.viewportRenderer.scrollViewport.scrollLeft = clampedScrollLeft;
		}
		const changed = this.deps.engine.viewport.setScrollPosition(scrollTop, clampedScrollLeft, timestamp);
		if (!changed) return;
		this.markScrolling();
		this.deps.requestScrollFrame();
		this.scheduleScrollEnd();
	};

	public updateCachedGeometryBoundsFromState(defaultColWidth: number, defaultRowHeight: number): void {
		this.state.cachedTotalWidth = this.deps.engine.geometry.getTotalWidth(defaultColWidth);
		this.state.cachedTotalHeight = this.deps.engine.geometry.getTotalHeight(defaultRowHeight);
		this.state.cachedDefaultRowHeight = defaultRowHeight ?? 40;
		this.state.cachedMaxScrollLeft = Math.max(0, this.state.cachedTotalWidth - this.deps.engine.viewport.viewportWidth);
	}

	public flushScrollFrame = (): void => {
		const scrollViewport = this.deps.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;
		this.deps.viewportRenderer.syncViewportScrollFromDom();

		const state = this.deps.engine.stateManager.getState();
		this.state.cachedHasSelectionOverlay = !!state.selection.bounds && !!this.deps.engine.getRowModel();
		this.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);

		const candidateIdx = 1 - this.state.activeRenderWindowBufIdx;
		const candidateBuf = this.state.renderWindowBufs[candidateIdx];
		computeRenderWindowInto(this.deps.engine, candidateBuf);
		const nextWindow = applyRenderWindowRuntimeLimits(candidateBuf, state.runtimeLimits);
		const layoutPlan = this.deps.syncLayoutPlan(nextWindow);

		if (sameRenderedWindow(this.deps.rowRenderer.currentWindow, nextWindow)) {
			this.deps.renderStats.scrollFrames++;
			this.deps.renderStats.sameWindowBailouts = (this.deps.renderStats.sameWindowBailouts || 0) + 1;
			this.syncCheapScrollOnly(layoutPlan);
			return;
		}

		if (nextWindow === candidateBuf) {
			this.state.activeRenderWindowBufIdx = candidateIdx;
		}

		this.state.isScrollFrameActive = true;
		this.deps.engine.isScrollFrameActive = true;
		this.deps.rowRenderer.isScrollFrameActive = true;
		this.deps.rowRenderer.currentScrollCellsPatched = 0;
		this.deps.rowRenderer.currentScrollRowsRecycled = 0;
		this.deps.rowRenderer.currentScrollRowsVisited = 0;
		this.deps.rowRenderer.currentScrollRowsRebound = 0;
		this.deps.rowRenderer.currentScrollCellsVisited = 0;
		this.deps.rowRenderer.currentScrollCellsWritten = 0;
		this.deps.rowRenderer.currentScrollPortalOps = 0;
		this.deps.renderStats.scrollFrames++;
		const startStateReads = this.deps.engine.stateManager.debugGetStateCount;
		try {
			const plan = this.deps.engine.columns.getCompiledPlan();
			const scrollCtx = this.state.scrollCtx;
			scrollCtx.state = state;
			scrollCtx.rowVersions = this.deps.engine.rowVersions;
			scrollCtx.globalVersion = state.globalVersion;
			scrollCtx.styleVersion = this.deps.rowRenderer.styleVersion;
			scrollCtx.loadingVersion = this.deps.rowRenderer.loadingVersion;
			scrollCtx.activeEdit = state.activeEdit;
			scrollCtx.hasStyleHooks = !!(state.styleSlots?.cellClass || state.styleSlots?.beforeCellRender || state.styleSlots?.afterCellRender);
			scrollCtx.hasCustomRenderers = plan.hasCustomRenderers;
			scrollCtx.plan = plan;
			scrollCtx.visibleColRange.startIdx = nextWindow.colStart;
			scrollCtx.visibleColRange.endIdx = nextWindow.colEnd;
			const visibleColRange = scrollCtx.visibleColRange;
			scrollCtx.focusedCell = state.selection.focus;
			scrollCtx.selectionBounds = state.selection.bounds ?? undefined;

			this.deps.recycleViewport(true, scrollCtx, nextWindow);
			this.deps.stickyGroupRenderer.sync(layoutPlan);

			this.deps.headerRenderer.syncScrollLeft(layoutPlan);
			const didSyncRange = this.deps.headerRenderer.syncVisibleColumnRange(layoutPlan, visibleColRange);
			if (didSyncRange) {
				this.deps.renderStats.headerRangeSyncsDuringScroll++;
			}
			this.deps.renderStats.overlayCheapSyncsDuringScroll++;
			this.deps.overlayRenderer.syncScrollPosition(this.state.cachedHasSelectionOverlay);
		} finally {
			const stateReadsInFrame = this.deps.engine.stateManager.debugGetStateCount - startStateReads;
			this.deps.renderStats.stateReadsDuringScroll += stateReadsInFrame;
			if (this.deps.renderStats.cellsPatchedPerScrollFrame.length >= 1024) {
				this.deps.renderStats.cellsPatchedPerScrollFrame.length = 0;
			}
			if (this.deps.renderStats.rowsRecycledPerScrollFrame.length >= 1024) {
				this.deps.renderStats.rowsRecycledPerScrollFrame.length = 0;
			}
			this.deps.renderStats.cellsPatchedPerScrollFrame.push(this.deps.rowRenderer.currentScrollCellsPatched);
			this.deps.renderStats.rowsRecycledPerScrollFrame.push(this.deps.rowRenderer.currentScrollRowsRecycled);
			this.state.isScrollFrameActive = false;
			this.deps.engine.isScrollFrameActive = false;
			this.deps.rowRenderer.isScrollFrameActive = false;
		}
	};

	public markScrolling(): void {
		if (!this.state.isScrolling) {
			this.deps.viewportRenderer.setScrollingClass(true);
		}
		this.state.isScrolling = true;
		this.deps.engine.isScrolling = true;
		this.deps.rowRenderer.isScrolling = true;
		this.deps.portalMountManager.setScrolling(true);
		this.clearPostScrollDecorationTimer();
		this.deps.layoutTransition.cancel();
		this.deps.rowRenderer.hoveredRowIndex = null;
	}

	public finishScrolling(): void {
		this.clearScrollEndTimer();
		this.deps.viewportRenderer.setScrollingClass(false);
		this.state.isScrolling = false;
		this.deps.engine.isScrolling = false;
		this.deps.rowRenderer.isScrolling = false;
		this.deps.rowRenderer.programmaticScrollCell = null;
		this.deps.portalMountManager.setScrolling(false);
		this.flushPendingPortalReleasesAfterScroll();
		this.state.needsPostScrollPortalFlush = this.state.needsPostScrollPortalFlush || this.deps.portalMountManager.getDeferredCount() > 0;
		if (this.state.needsPostScrollPortalFlush) {
			this.scheduleBudgetedPortalFlush();
		}
		this.restoreDeferredFocus();
		if (this.state.flushPendingAfterScroll) {
			this.state.flushPendingAfterScroll = false;
			this.deps.scheduler.requestFlush('post-scroll');
		}
		if (
			this.state.viewportDirtyAfterScroll ||
			this.deps.rowRenderer.dirtyCellsAfterScroll.size > 0 ||
			this.deps.rowRenderer.dirtyRowsAfterScroll.size > 0
		) {
			this.state.viewportDirtyAfterScroll = false;
			this.scheduleBudgetedDecoration();
		}
		if (this.deps.overlayRenderer.overlayDirtyDuringScroll) {
			this.deps.overlayRenderer.overlayDirtyDuringScroll = false;
			this.deps.overlayRenderer.repaintOverlay();
		}
	}

	public clearScrollEndTimer(): void {
		this.state.scrollEndTickerActive = false;
		if (this.state.scrollEndRafId !== null) {
			defaultGridScheduler.cancelRaf(this.state.scrollEndRafId);
			this.state.scrollEndRafId = null;
		}
	}

	public scheduleScrollEnd(): void {
		this.state.scrollEndQuietFrames = 0;
		if (!this.state.scrollEndTickerActive) {
			this.state.scrollEndTickerActive = true;
			this.state.scrollEndRafId = defaultGridScheduler.raf(this.scrollEndTick);
		}
	}

	public flushPendingPortalReleasesAfterScroll(): void {
		if (this.deps.rowRenderer.pendingPortalReleasesAfterScroll.size === 0) return;
		const pending = Array.from(this.deps.rowRenderer.pendingPortalReleasesAfterScroll.values());
		this.deps.rowRenderer.pendingPortalReleasesAfterScroll.clear();
		this.deps.portalMountManager.releaseCells(pending, false);
		this.state.needsPostScrollPortalFlush = true;
	}

	public scheduleBudgetedPortalFlush(): void {
		if (this.state.portalFlushScheduled) return;
		this.state.portalFlushScheduled = true;
		defaultGridScheduler.idle((deadline) => {
			this.state.portalFlushScheduled = false;
			if (this.state.isScrolling) {
				this.state.needsPostScrollPortalFlush = true;
				return;
			}
			const result = this.deps.portalMountManager.flushDeferred({
				maxItems: this.state.portalFlushBudget,
				reason: 'scroll-idle',
				flushSync: false,
				deadline,
			});
			this.state.needsPostScrollPortalFlush = result.remaining > 0;
			if (result.remaining > 0) {
				this.scheduleBudgetedPortalFlush();
			}
		});
	}

	public clearPostScrollDecorationTimer(): void {
		if (this.state.postScrollDecorationTimer !== null) {
			defaultGridScheduler.cancelIdle(this.state.postScrollDecorationTimer);
			this.state.postScrollDecorationTimer = null;
		}
		this.state.postScrollDecorationScheduled = false;
	}

	public scheduleBudgetedDecoration(): void {
		if (this.state.postScrollDecorationScheduled) return;
		this.state.postScrollDecorationScheduled = true;
		this.state.postScrollDecorationTimer = defaultGridScheduler.idle(() => {
			this.state.postScrollDecorationTimer = null;
			this.state.postScrollDecorationScheduled = false;
			if (this.state.isScrolling) {
				return;
			}
			this.deps.renderStats.postScrollDecorationChunks++;
			this.deps.portalMountManager.beginCellReleaseTransaction();
			let result;
			try {
				result = this.deps.rowRenderer.decorateDirtyCellsAfterScroll({ maxCells: this.state.postScrollDecorationBudget });
			} finally {
				this.deps.portalMountManager.endCellReleaseTransaction();
			}
			if (result.processed > this.deps.renderStats.maxCellsDecoratedInOneChunk) {
				this.deps.renderStats.maxCellsDecoratedInOneChunk = result.processed;
			}
			this.deps.renderStats.cellsDecoratedAfterScroll += result.processed;
			if (result.remaining > 0) {
				this.scheduleBudgetedDecoration();
			}
		});
	}

	public restoreDeferredFocus(): void {
		const cell = this.deps.rowRenderer.deferredFocusCell;
		this.deps.rowRenderer.deferredFocusCell = null;
		if (!cell || !cell.isConnected) return;
		this.deps.rowRenderer.applyFocus(cell);
	}

	public syncCheapScrollOnly(layoutPlan: GridLayoutPlan): void {
		const window = layoutPlan.renderWindow;
		const scrollTop = layoutPlan.viewport.scrollTop;
		const scrollLeft = layoutPlan.viewport.scrollLeft;

		this.deps.headerRenderer.syncScrollLeft(layoutPlan);
		this.deps.renderStats.overlayCheapSyncsDuringScroll++;
		this.deps.overlayRenderer.syncScrollPosition(this.state.cachedHasSelectionOverlay);

		const pinTopRows = window.pinTopRows;
		const pinBottomRows = window.pinBottomRows;
		if (pinTopRows > 0 || pinBottomRows > 0) {
			const viewportHeight = this.deps.engine.viewport.viewportHeight;
			const totalHeight = this.state.cachedTotalHeight;
			const rowTops = this.deps.engine.geometry.rowTops;

			for (let r = 0; r < pinTopRows && r < window.rowCount; r++) {
				const slot = this.deps.rowRenderer.activeRows.get(r);
				if (slot) {
					slot.updatePosition(rowTops[r] + scrollTop);
				}
			}

			for (let r = window.rowCount - pinBottomRows; r < window.rowCount; r++) {
				if (r >= pinTopRows) {
					const slot = this.deps.rowRenderer.activeRows.get(r);
					if (slot) {
						slot.updatePosition(scrollTop + viewportHeight - (totalHeight - rowTops[r]));
					}
				}
			}
		}

		this.deps.stickyGroupRenderer.sync(layoutPlan);
		if (this.deps.rowRenderer.currentWindow) {
			this.deps.rowRenderer.currentWindow.scrollTop = scrollTop;
			this.deps.rowRenderer.currentWindow.scrollLeft = scrollLeft;
		}
	}

	private readonly scrollEndTick = (): void => {
		if (!this.state.isScrolling) {
			this.state.scrollEndTickerActive = false;
			this.state.scrollEndRafId = null;
			return;
		}
		if (this.state.scrollEndQuietFrames >= 3) {
			this.state.scrollEndTickerActive = false;
			this.state.scrollEndRafId = null;
			this.finishScrolling();
			return;
		}
		this.state.scrollEndQuietFrames++;
		this.state.scrollEndRafId = defaultGridScheduler.raf(this.scrollEndTick);
	};
}

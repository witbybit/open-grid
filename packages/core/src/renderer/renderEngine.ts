import { defaultGridScheduler } from './gridScheduler.js';
import { HeaderMenuController } from './headerMenuController.js';
import { computeScrollTarget } from './scrollIntoView.js';
import { ScrollEngine } from './scrollEngine.js';
import {
	sameRenderedWindow,
	applyRenderWindowRuntimeLimits,
	computeRenderWindow,
	computeRenderWindowInto,
	createEmptyRenderWindow,
	type RenderWindow,
} from './renderWindow.js';
import { ColumnInteractionController } from './columnInteractionController.js';
import { FillDragController, type OverlayBox } from './fillDragController.js';
import { createCellKey } from '../ids.js';
import { GeometryController } from './geometryController.js';
import type { InvalidationFrame } from './invalidationManager.js';
import type {
	GridCellContentMount,
	GridCellContentUnmount,
	GridRowContentMount,
	GridRowContentUnmount,
	IGridRenderer,
	GridHeaderMenuMount,
	GridHeaderMenuUnmount,
} from './IGridRenderer.js';
import { RenderOrchestrator, type RenderStats } from './renderOrchestrator.js';
import { RenderScheduler } from './renderScheduler.js';
import { ScrollFrameScheduler } from './scrollFrameScheduler.js';
import { PortalMountManager } from './portalMountManager.js';
import { ViewportRenderer } from './viewportRenderer.js';
import { RowRenderer } from './rowRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import { CellRenderer } from './cellRenderer.js';
import { HeaderRenderer } from './headerRenderer.js';
import { OverlayRenderer } from './overlayRenderer.js';
import { SortAnimationController } from './sortAnimationController.js';
import { GroupPanelRenderer } from './groupPanelRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { GridEventName, type GridApi, type InternalGridApi, type SelectionChangeResult } from '../store.js';

/**
 * Owns the grid DOM, coordinating ViewportRenderer, RowRenderer, and other sub-renderers.
 */
export class RenderEngine<TRowData = unknown> implements IGridRenderer<TRowData> {
	private readonly engine: GridEngine<TRowData>;
	private readonly api?: InternalGridApi<TRowData>;

	private readonly geometryController: GeometryController<TRowData>;
	private readonly scrollEngine: ScrollEngine<TRowData>;
	private readonly columnInteractions: ColumnInteractionController<TRowData>;
	private readonly fillDrag: FillDragController<TRowData>;
	private readonly scheduler: RenderScheduler;
	private readonly scrollScheduler: ScrollFrameScheduler;
	private readonly orchestrator: RenderOrchestrator;

	public readonly portalMountManager: PortalMountManager<TRowData>;
	public readonly viewportRenderer: ViewportRenderer<TRowData>;
	public readonly rowRenderer: RowRenderer<TRowData>;
	public readonly cellRenderer: CellRenderer;
	public readonly headerRenderer: HeaderRenderer<TRowData>;
	public readonly overlayRenderer: OverlayRenderer<TRowData>;
	public readonly groupPanelRenderer: GroupPanelRenderer<TRowData>;

	private unsubscribers: Array<() => void> = [];
	private readonly headerMenu: HeaderMenuController<TRowData>;

	private readonly sortAnimation: SortAnimationController<TRowData>;
	private _pendingSortAnimation = false;

	private isScrolling = false;
	private scrollEndRafId: number | null = null;
	private scrollEndQuietFrames = 0;
	private scrollEndTickerActive = false;
	private viewportDirtyAfterScroll = false;
	private flushPendingAfterScroll = false;
	private needsPostScrollPortalFlush = false;
	private portalFlushScheduled = false;
	private isScrollFrameActive = false;
	private postScrollDecorationScheduled = false;
	private postScrollDecorationTimer: number | null = null;

	private lastStyleSlots: unknown = undefined;
	private lastLoading: unknown = undefined;

	// Cached geometry values so the raw DOM scroll handler (120/sec on high-refresh
	// displays) and same-window fast path never need to call getState() or geometry.
	private cachedMaxScrollLeft = 0;
	private cachedTotalWidth = 0;
	private cachedTotalHeight = 0;
	private cachedDefaultRowHeight = 40;
	private cachedHasSelectionOverlay = false;

	// Reusable ScrollRenderContext updated in-place each scroll frame to avoid allocation.
	private _scrollCtx!: ScrollRenderContext<TRowData>;

	// Double-buffered RenderWindow — alternated each frame to avoid per-frame allocation.
	// _activeRenderWindowBufIdx points to the buffer currently stored as currentWindow.
	// The candidate (next) buffer is always the OTHER slot.
	private readonly _renderWindowBufs: [RenderWindow, RenderWindow] = [createEmptyRenderWindow(), createEmptyRenderWindow()];
	private _activeRenderWindowBufIdx = 0;

	private readonly portalFlushBudget = 24;
	private readonly postScrollDecorationBudget = 32;

	private renderStats = {
		scrollFrames: 0,
		viewportRecycles: 0,
		headerPaintsDuringScroll: 0,
		headerRangeSyncsDuringScroll: 0,
		overlayPaintsDuringScroll: 0,
		overlayCheapSyncsDuringScroll: 0,
		cellsPatchedPerScrollFrame: [] as number[],
		rowsRecycledPerScrollFrame: [] as number[],

		stateReadsDuringScroll: 0,
		focusCallsDuringScroll: 0,
		rootTextContentWritesOnPortalCells: 0,
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

	public get onMountCellContent(): ((mount: GridCellContentMount<TRowData>) => void) | undefined {
		return this.portalMountManager.onMountCellContent;
	}

	public set onMountCellContent(callback: ((mount: GridCellContentMount<TRowData>) => void) | undefined) {
		this.portalMountManager.onMountCellContent = callback;
	}

	public get onUnmountCellContent(): ((unmount: GridCellContentUnmount) => void) | undefined {
		return this.portalMountManager.onUnmountCellContent;
	}

	public set onUnmountCellContent(callback: ((unmount: GridCellContentUnmount) => void) | undefined) {
		this.portalMountManager.onUnmountCellContent = callback;
	}

	public get onMountRowContent(): ((mount: GridRowContentMount<TRowData>) => void) | undefined {
		return this.portalMountManager.onMountRowContent;
	}

	public set onMountRowContent(callback: ((mount: GridRowContentMount<TRowData>) => void) | undefined) {
		this.portalMountManager.onMountRowContent = callback;
	}

	public get onUnmountRowContent(): ((unmount: GridRowContentUnmount) => void) | undefined {
		return this.portalMountManager.onUnmountRowContent;
	}

	public set onUnmountRowContent(callback: ((unmount: GridRowContentUnmount) => void) | undefined) {
		this.portalMountManager.onUnmountRowContent = callback;
	}

	public get onMountHeaderMenu(): ((mount: GridHeaderMenuMount<TRowData>) => void) | undefined {
		return this.portalMountManager.onMountHeaderMenu;
	}

	public set onMountHeaderMenu(callback: ((mount: GridHeaderMenuMount<TRowData>) => void) | undefined) {
		this.portalMountManager.onMountHeaderMenu = callback;
	}

	public get onUnmountHeaderMenu(): ((unmount: GridHeaderMenuUnmount) => void) | undefined {
		return this.portalMountManager.onUnmountHeaderMenu;
	}

	public set onUnmountHeaderMenu(callback: ((unmount: GridHeaderMenuUnmount) => void) | undefined) {
		this.portalMountManager.onUnmountHeaderMenu = callback;
	}

	constructor(engine: GridEngine<TRowData>, api?: InternalGridApi<TRowData>) {
		this.engine = engine;
		this.api = api;
		this._scrollCtx = {
			isScrolling: true,
			stateVersion: 0,
			dataVersion: 0,
			styleVersion: 0,
			loadingVersion: 0,
			activeEdit: null,
			hasStyleHooks: false,
			hasCustomRenderers: false,
			plan: this.engine.columns.getCompiledPlan(),
			visibleColRange: { startIdx: 0, endIdx: 0 },
			focusedCell: null,
			selectionBounds: undefined,
			canUseCachedDisplayValues: true,
		};
		this.portalMountManager = new PortalMountManager<TRowData>(engine);
		this.headerMenu = new HeaderMenuController<TRowData>(
			engine,
			this.portalMountManager,
			() => (this.api || this.engine.stateManager) as unknown as GridApi<TRowData>
		);
		this.geometryController = new GeometryController(engine);
		this.scrollEngine = new ScrollEngine<TRowData>(engine);
		this.scheduler = new RenderScheduler(() => this.flushPaint());
		this.scrollScheduler = new ScrollFrameScheduler(() => this.flushScrollFrame());

		this.viewportRenderer = new ViewportRenderer<TRowData>(engine, this.geometryController);
		this.cellRenderer = new CellRenderer((frame) => this.rowRenderer.repaintInvalidatedRowsAndCells(frame));
		this.rowRenderer = new RowRenderer<TRowData>(
			engine,
			this.geometryController,
			this.portalMountManager,
			this.cellRenderer,
			this.viewportRenderer
		);
		this.rowRenderer.renderStats = this.renderStats;
		this.portalMountManager.setPhysicalRowSlotIdResolver((rowIndex) => this.rowRenderer.activeRows.get(rowIndex)?.id);
		this.sortAnimation = new SortAnimationController(() => this.rowRenderer.activeRows);

		this.headerRenderer = new HeaderRenderer<TRowData>(
			engine,
			() => this.columnInteractions,
			(cell, colField) => this.headerMenu.show(cell, colField)
		);
		this.overlayRenderer = new OverlayRenderer<TRowData>(
			engine,
			this.viewportRenderer,
			() => this.columnInteractions,
			() => this.fillDrag
		);
		this.overlayRenderer.renderStats = this.renderStats;

		this.orchestrator = new RenderOrchestrator({
			recomputeGeometry: () => this.geometryController.recomputeIfNeeded(),
			syncViewport: (frame) => {
				const state = this.engine.stateManager.getState();
				const colCount = this.engine.columns.getDisplayedColumnCount();
				this.viewportRenderer.syncSpacerAndLayers(state, colCount);
				this.recycleViewport(false);
			},
			syncHeaders: (frame) => this.headerRenderer.sync(frame),
			syncOverlay: (frame) => this.overlayRenderer.sync(frame),
			syncRows: (frame) => this.rowRenderer.repaintInvalidatedRowsAndCells(frame),
			syncCells: (frame) => this.rowRenderer.repaintInvalidatedRowsAndCells(frame),
			fullPaint: () => this.fullPaintInternal(),
		});

		this.columnInteractions = new ColumnInteractionController<TRowData>({
			engine,
			getOverlayLayer: () => this.viewportRenderer.overlayLayer,
			getScrollViewport: () => this.viewportRenderer.scrollViewport,
			schedulePaint: () => this.scheduleHeaderPaint('column interaction'),
		});
		this.fillDrag = new FillDragController<TRowData>({
			engine,
			getOverlayLayer: () => this.viewportRenderer.overlayLayer,
			getScrollViewport: () => this.viewportRenderer.scrollViewport,
			getOverlayBox: (minRow, maxRow, minCol, maxCol) => this.overlayRenderer.getClampedOverlayBox(minRow, maxRow, minCol, maxCol),
			scrollTo: (scrollTop, scrollLeft) => this.scrollEngine.scrollTo(scrollTop, scrollLeft),
			schedulePaint: () => this.scheduleOverlayPaint('fill drag'),
		});

		// Group panel renderer — mounts when showGroupPanel is true
		this.groupPanelRenderer = new GroupPanelRenderer<TRowData>(engine);
	}

	/**
	 * Mount the rendering engine inside a host DOM container.
	 */
	public mount(container: HTMLElement): void {
		this.viewportRenderer.mount(container);

		const scrollViewport = this.viewportRenderer.scrollViewport;
		if (scrollViewport) {
			scrollViewport.addEventListener('mouseover', this.onRowMouseOver);
			scrollViewport.addEventListener('mouseleave', this.onRowMouseLeave);
			this.scrollEngine.bind(scrollViewport, this.onScroll);
		}

		if (this.viewportRenderer.headerLayer && this.viewportRenderer.headerLeftLayer && this.viewportRenderer.headerRightLayer) {
			this.headerRenderer.mount(
				this.viewportRenderer.headerLayer,
				this.viewportRenderer.headerLeftLayer,
				this.viewportRenderer.headerRightLayer
			);
		}

		// Group panel: mount if showGroupPanel is already true at mount time
		if (this.viewportRenderer.groupPanel) {
			this.groupPanelRenderer.mount(this.viewportRenderer.groupPanel);
			const showPanel = this.engine.stateManager.getState().showGroupPanel ?? false;
			this.viewportRenderer.setGroupPanelVisible(showPanel);
			this.columnInteractions.setGroupPanel(this.groupPanelRenderer);
		}

		this.overlayRenderer.mount();

		// Pre-warm DOM recycling pools
		const rect = container.getBoundingClientRect();
		const estRows = Math.ceil((rect.height || 500) / 40) + 15;
		this.rowRenderer.mount(estRows);

		// Set viewport dimensions in model
		this.engine.viewport.setViewportSize(rect.width || 800, rect.height || 500);

		this.bindInvalidationSources();

		// Prime the max-scroll cache so the first scroll events don't see a stale 0
		this.updateCachedGeometryBounds();

		// Run first layout calculation and repaint
		this.engine.invalidation.consume();
		this.fullPaint();
	}

	/**
	 * Unmount and clean up all DOM resources and subscriptions.
	 */
	public unmount(): void {
		this.headerMenu.hide();

		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];

		this.scrollEngine.unbind();
		const scrollViewport = this.viewportRenderer.scrollViewport;
		if (scrollViewport) {
			scrollViewport.removeEventListener('mouseover', this.onRowMouseOver);
			scrollViewport.removeEventListener('mouseleave', this.onRowMouseLeave);
		}
		this.columnInteractions.cleanup();
		this.columnInteractions.setGroupPanel(null);
		this.fillDrag.cleanup();
		this.groupPanelRenderer.unmount();
		this.sortAnimation.destroy();
		this.scheduler.destroy();
		this.scrollScheduler.destroy();
		this.clearScrollEndTimer();
		this.clearPostScrollDecorationTimer();
		this.portalMountManager.releaseAll();

		// Release all active rows and cells
		this.rowRenderer.unmount();
		this.headerRenderer.unmount();
		this.overlayRenderer.unmount();

		this.viewportRenderer.unmount();
	}

	/**
	 * Scroll hot path â€” zero allocations, zero state reads.
	 * cachedMaxScrollLeft is updated in flushScrollFrame/fullPaintInternal/geometry callbacks.
	 */
	private onScroll = (scrollTop: number, scrollLeft: number, timestamp?: number): void => {
		const clampedScrollLeft = Math.max(0, Math.min(this.cachedMaxScrollLeft, scrollLeft));
		if (clampedScrollLeft !== scrollLeft && this.viewportRenderer.scrollViewport) {
			this.viewportRenderer.scrollViewport.scrollLeft = clampedScrollLeft;
		}
		const changed = this.engine.viewport.setScrollPosition(scrollTop, clampedScrollLeft, timestamp);
		if (!changed) return;
		this.markScrolling();
		// Schedule scroll frame first so its RAF callback is ordered before the scroll-end RAF
		this.scrollScheduler.requestFrame();
		this.scheduleScrollEnd();
	};

	private markScrolling(): void {
		if (!this.isScrolling) {
			// Once-per-gesture work — the per-event path below is just flag/counter writes.
			this.viewportRenderer.setScrollingClass(true);
		}
		this.isScrolling = true;
		this.engine.isScrolling = true;
		this.rowRenderer.isScrolling = true;
		this.portalMountManager.setScrolling(true);
		this.clearPostScrollDecorationTimer();
		this.sortAnimation.cancel();
		// Clear hover immediately so no row stays highlighted while the viewport moves.
		this.setHoveredRowIndex(null);
	}

	// RAF-counter scroll-end: fires finishScrolling after N consecutive frames with no new
	// scroll event. Device-rate-agnostic (~67ms at 60fps, ~33ms at 120fps vs fixed 80ms).
	// One persistent RAF ticker per gesture: each scroll event resets a counter (zero
	// allocation, no cancel/re-schedule churn — the old per-event closure pair cost
	// ~240 allocations + 120 cancelRAF/requestRAF pairs per second at 120Hz).
	// scrollEndTickerActive (not the RAF id) gates scheduling: schedulers that execute
	// RAF callbacks synchronously (tests) would otherwise overwrite the id AFTER the
	// callback chain already finished, wedging the ticker permanently "scheduled".
	private readonly scrollEndTick = (): void => {
		if (!this.isScrolling) {
			this.scrollEndTickerActive = false;
			this.scrollEndRafId = null;
			return;
		}
		if (this.scrollEndQuietFrames >= 3) {
			this.scrollEndTickerActive = false;
			this.scrollEndRafId = null;
			this.finishScrolling();
			return;
		}
		this.scrollEndQuietFrames++;
		this.scrollEndRafId = defaultGridScheduler.raf(this.scrollEndTick);
	};

	private scheduleScrollEnd(): void {
		this.scrollEndQuietFrames = 0;
		if (!this.scrollEndTickerActive) {
			this.scrollEndTickerActive = true;
			this.scrollEndRafId = defaultGridScheduler.raf(this.scrollEndTick);
		}
	}

	private finishScrolling(): void {
		this.clearScrollEndTimer();
		this.viewportRenderer.setScrollingClass(false);
		this.isScrolling = false;
		this.engine.isScrolling = false;
		this.rowRenderer.isScrolling = false;
		this.rowRenderer.programmaticScrollCell = null;
		this.portalMountManager.setScrolling(false);
		this.flushPendingPortalReleasesAfterScroll();
		this.needsPostScrollPortalFlush = this.needsPostScrollPortalFlush || this.portalMountManager.getDeferredCount() > 0;
		if (this.needsPostScrollPortalFlush) {
			this.scheduleBudgetedPortalFlush();
		}
		this.restoreDeferredFocus();
		if (this.flushPendingAfterScroll) {
			// Drain invalidations that were gated during the scroll in one flush.
			this.flushPendingAfterScroll = false;
			this.scheduler.requestFlush('post-scroll');
		}
		if (this.viewportDirtyAfterScroll || this.rowRenderer.dirtyCellsAfterScroll.size > 0 || this.rowRenderer.dirtyRowsAfterScroll.size > 0) {
			this.viewportDirtyAfterScroll = false;
			this.scheduleBudgetedDecoration();
		}
		if (this.overlayRenderer.overlayDirtyDuringScroll) {
			this.overlayRenderer.overlayDirtyDuringScroll = false;
			this.overlayRenderer.repaintOverlay();
		}
	}

	private clearScrollEndTimer(): void {
		this.scrollEndTickerActive = false;
		if (this.scrollEndRafId !== null) {
			defaultGridScheduler.cancelRaf(this.scrollEndRafId);
			this.scrollEndRafId = null;
		}
	}

	private flushPendingPortalReleasesAfterScroll(): void {
		if (this.rowRenderer.pendingPortalReleasesAfterScroll.size === 0) return;
		const pending = Array.from(this.rowRenderer.pendingPortalReleasesAfterScroll.values());
		this.rowRenderer.pendingPortalReleasesAfterScroll.clear();
		// flushSync=false: the DOM side of a release is a cheap warm-cache re-parent, but
		// the old `true` forced one synchronous React unmount commit for ALL pending
		// releases — a guaranteed hitch on the first post-scroll frame. With false the
		// React unmounts coalesce into a single async commit on the next microtask.
		this.portalMountManager.releaseCells(pending, false);
		this.needsPostScrollPortalFlush = true;
	}

	private scheduleBudgetedPortalFlush(): void {
		if (this.portalFlushScheduled) return;
		this.portalFlushScheduled = true;
		defaultGridScheduler.idle((deadline) => {
			this.portalFlushScheduled = false;
			if (this.isScrolling) {
				this.needsPostScrollPortalFlush = true;
				return;
			}
			const result = this.portalMountManager.flushDeferred({
				maxItems: this.portalFlushBudget,
				reason: 'scroll-idle',
				flushSync: false,
				deadline,
			});
			this.needsPostScrollPortalFlush = result.remaining > 0;
			if (result.remaining > 0) {
				this.scheduleBudgetedPortalFlush();
			}
		});
	}

	private clearPostScrollDecorationTimer(): void {
		if (this.postScrollDecorationTimer !== null) {
			defaultGridScheduler.cancelIdle(this.postScrollDecorationTimer);
			this.postScrollDecorationTimer = null;
		}
		this.postScrollDecorationScheduled = false;
	}

	private scheduleBudgetedDecoration(): void {
		if (this.postScrollDecorationScheduled) return;
		this.postScrollDecorationScheduled = true;

		this.postScrollDecorationTimer = defaultGridScheduler.idle(() => {
			this.postScrollDecorationTimer = null;
			this.postScrollDecorationScheduled = false;

			if (this.isScrolling) {
				return;
			}

			this.renderStats.postScrollDecorationChunks++;
			// One release transaction per chunk: portal releases triggered by _bindCellFull
			// batch into a single flush instead of one synchronous React commit per cell.
			this.portalMountManager.beginCellReleaseTransaction();
			let result;
			try {
				result = this.rowRenderer.decorateDirtyCellsAfterScroll({ maxCells: this.postScrollDecorationBudget });
			} finally {
				this.portalMountManager.endCellReleaseTransaction();
			}

			if (result.processed > this.renderStats.maxCellsDecoratedInOneChunk) {
				this.renderStats.maxCellsDecoratedInOneChunk = result.processed;
			}
			this.renderStats.cellsDecoratedAfterScroll += result.processed;

			if (result.remaining > 0) {
				this.scheduleBudgetedDecoration();
			}
		});
	}

	private restoreDeferredFocus(): void {
		const cell = this.rowRenderer.deferredFocusCell;
		this.rowRenderer.deferredFocusCell = null;
		if (!cell || !cell.isConnected) return;
		this.rowRenderer.applyFocus(cell);
	}

	private flushScrollFrame(): void {
		const scrollViewport = this.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;
		this.viewportRenderer.syncViewportScrollFromDom();

		const state = this.engine.stateManager.getState();
		this.cachedHasSelectionOverlay = !!state.selection.bounds && !!this.engine.getRowModel();

		// Refresh the cached scroll-left bound using the already-read state â€” no extra
		// state read. This handles viewport resizes that happened since the last frame.
		this.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);

		// Double-buffer: fill the candidate slot in-place to avoid per-frame allocation.
		// The candidate is always the buffer NOT currently stored as currentWindow.
		const candidateIdx = 1 - this._activeRenderWindowBufIdx;
		const candidateBuf = this._renderWindowBufs[candidateIdx];
		computeRenderWindowInto(this.engine, candidateBuf);
		const nextWindow = applyRenderWindowRuntimeLimits(candidateBuf, state.runtimeLimits);
		// nextWindow === candidateBuf on the fast path (limits not exceeded).
		// nextWindow is a new object on the slow path (limits applied, rare).

		// Same window bailout path
		if (sameRenderedWindow(this.rowRenderer.currentWindow, nextWindow)) {
			this.renderStats.scrollFrames++;
			this.renderStats.sameWindowBailouts = (this.renderStats.sameWindowBailouts || 0) + 1;
			this.syncCheapScrollOnly(nextWindow);
			return;
		}

		// Window changed: if nextWindow is our candidate buffer, swap the active index so
		// next frame fills the other buffer (zero allocation). Otherwise (limits applied),
		// the new object is used directly and no swap is needed.
		if (nextWindow === candidateBuf) {
			this._activeRenderWindowBufIdx = candidateIdx;
		}

		this.isScrollFrameActive = true;
		this.engine.isScrollFrameActive = true;
		this.rowRenderer.isScrollFrameActive = true;
		this.rowRenderer.currentScrollCellsPatched = 0;
		this.rowRenderer.currentScrollRowsRecycled = 0;
		this.rowRenderer.currentScrollRowsVisited = 0;
		this.rowRenderer.currentScrollRowsRebound = 0;
		this.rowRenderer.currentScrollCellsVisited = 0;
		this.rowRenderer.currentScrollCellsWritten = 0;
		this.rowRenderer.currentScrollPortalOps = 0;
		this.renderStats.scrollFrames++;
		const startStateReads = this.engine.stateManager.debugGetStateCount;
		try {
			const plan = this.engine.columns.getCompiledPlan();

			// Update the reusable ScrollRenderContext in-place â€” avoids one object
			// allocation per scroll frame while keeping all cached references fresh.
			const scrollCtx = this._scrollCtx;
			scrollCtx.state = state;
			scrollCtx.dataVersion = state.dataVersion;
			scrollCtx.styleVersion = this.rowRenderer.styleVersion;
			scrollCtx.loadingVersion = this.rowRenderer.loadingVersion;
			scrollCtx.activeEdit = state.activeEdit;
			scrollCtx.hasStyleHooks = !!(state.styleSlots?.cellClass || state.styleSlots?.beforeCellRender || state.styleSlots?.afterCellRender);
			scrollCtx.hasCustomRenderers = plan.hasCustomRenderers;
			scrollCtx.plan = plan;
			// Mutate visibleColRange in-place — avoids a new { } allocation per frame.
			scrollCtx.visibleColRange.startIdx = nextWindow.colStart;
			scrollCtx.visibleColRange.endIdx = nextWindow.colEnd;
			const visibleColRange = scrollCtx.visibleColRange;
			scrollCtx.focusedCell = state.selection.focus;
			scrollCtx.selectionBounds = state.selection.bounds ?? undefined;

			// Pass the already-computed nextWindow so rowRenderer.recycleViewport does not
			// call computeRenderWindow a second time (duplicate binary searches + state read).
			this.recycleViewport(true, scrollCtx, nextWindow);

			// Sticky group rows must render immediately â€” never defer their portal mounts.
			// If a sticky row's slot was freshly assigned (row was outside the overscan buffer),
			// its portal mount would otherwise be queued and appear blank for 1-2 frames.
			if (nextWindow.stickyGroupStack && nextWindow.stickyGroupStack.length > 0) {
				const rowModel = this.engine.getRowModel();
				if (rowModel) {
					for (const stickyGroup of nextWindow.stickyGroupStack) {
						const vr = rowModel.getVisualRow(stickyGroup.visualIndex);
						if (vr) this.portalMountManager.flushDeferredRowMount(vr.id);
					}
				}
			}

			this.rowRenderer.syncPinnedLanePositions(nextWindow, this.cachedTotalWidth);
			this.headerRenderer.syncScrollLeft(this.engine.viewport.scrollLeft, plan);
			const didSyncRange = this.headerRenderer.syncVisibleColumnRange(plan, state, visibleColRange);
			if (didSyncRange) {
				this.renderStats.headerRangeSyncsDuringScroll++;
			}
			this.renderStats.overlayCheapSyncsDuringScroll++;
			this.overlayRenderer.syncScrollPosition(this.cachedHasSelectionOverlay);
		} finally {
			const stateReadsInFrame = this.engine.stateManager.debugGetStateCount - startStateReads;
			this.renderStats.stateReadsDuringScroll += stateReadsInFrame;

			// Bounded: these grow per window-changing frame — without a cap a long scroll
			// session reallocates the backing stores forever (GC pressure during scroll).
			if (this.renderStats.cellsPatchedPerScrollFrame.length >= 1024) {
				this.renderStats.cellsPatchedPerScrollFrame.length = 0;
			}
			if (this.renderStats.rowsRecycledPerScrollFrame.length >= 1024) {
				this.renderStats.rowsRecycledPerScrollFrame.length = 0;
			}
			this.renderStats.cellsPatchedPerScrollFrame.push(this.rowRenderer.currentScrollCellsPatched);
			this.renderStats.rowsRecycledPerScrollFrame.push(this.rowRenderer.currentScrollRowsRecycled);
			this.isScrollFrameActive = false;
			this.engine.isScrollFrameActive = false;
			this.rowRenderer.isScrollFrameActive = false;
		}
	}

	private syncCheapScrollOnly(window: RenderWindow): void {
		const plan = this.engine.columns.getCompiledPlan();
		const scrollTop = this.engine.viewport.scrollTop;
		const scrollLeft = this.engine.viewport.scrollLeft;

		// 1. Header scrollLeft transform
		this.headerRenderer.syncScrollLeft(scrollLeft, plan);

		// 2. Selection overlay transform
		this.renderStats.overlayCheapSyncsDuringScroll++;
		this.overlayRenderer.syncScrollPosition(this.cachedHasSelectionOverlay);

		// 3. Pinned rows position update (if any)
		const pinTopRows = window.pinTopRows;
		const pinBottomRows = window.pinBottomRows;
		if (pinTopRows > 0 || pinBottomRows > 0) {
			const viewportHeight = this.engine.viewport.viewportHeight;
			const totalHeight = this.cachedTotalHeight;
			const rowTops = this.engine.geometry.rowTops;

			// Update pinned top rows
			for (let r = 0; r < pinTopRows && r < window.rowCount; r++) {
				const slot = this.rowRenderer.activeRows.get(r);
				if (slot) {
					slot.updatePosition(rowTops[r] + scrollTop);
				}
			}

			// Update pinned bottom rows
			for (let r = window.rowCount - pinBottomRows; r < window.rowCount; r++) {
				if (r >= pinTopRows) {
					const slot = this.rowRenderer.activeRows.get(r);
					if (slot) {
						slot.updatePosition(scrollTop + viewportHeight - (totalHeight - rowTops[r]));
					}
				}
			}
		}

		// 4. Sticky group rows position update
		const stickyGroupStack = window.stickyGroupStack;
		if (stickyGroupStack && stickyGroupStack.length > 0) {
			for (const stickyGroup of stickyGroupStack) {
				const slot = this.rowRenderer.activeRows.get(stickyGroup.visualIndex);
				if (slot) {
					slot.updatePosition(stickyGroup.top);
				}
			}
		}

		// Only update pinned lane transforms when scrollLeft actually changed.
		// During vertical-only scroll, scrollLeft is constant — skipping the call
		// avoids building translate3d strings and iterating all row slots each frame,
		// which is the primary source of the Layerize cost in profiling.
		if (scrollLeft !== this.rowRenderer.currentWindow?.scrollLeft) {
			this.rowRenderer.syncPinnedLanePositions(window, this.cachedTotalWidth);
		}

		// Update current window's scroll values
		if (this.rowRenderer.currentWindow) {
			this.rowRenderer.currentWindow.scrollTop = scrollTop;
			this.rowRenderer.currentWindow.scrollLeft = scrollLeft;
		}
	}

	private updateCachedGeometryBoundsFromState(defaultColWidth: number, defaultRowHeight: number): void {
		this.cachedTotalWidth = this.engine.geometry.getTotalWidth(defaultColWidth);
		this.cachedTotalHeight = this.engine.geometry.getTotalHeight(defaultRowHeight);
		this.cachedDefaultRowHeight = defaultRowHeight ?? 40;
		this.cachedMaxScrollLeft = Math.max(0, this.cachedTotalWidth - this.engine.viewport.viewportWidth);
	}

	private updateCachedGeometryBounds(): void {
		const state = this.engine.stateManager.getState();
		this.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);
	}

	/**
	 * Scroll-gated flush request. While a scroll (or scroll frame) is active, a paint
	 * flush competes with flushScrollFrame for the same frame budget — the single
	 * biggest source of dropped frames with live data/selection during scroll.
	 * Invalidation records accumulate in InvalidationManager regardless, so deferring
	 * the flush to finishScrolling() loses nothing: one flushPaint consumes them all.
	 * Scroll frames themselves keep visuals correct meanwhile (geometry/column version
	 * bumps change the render window, which forces a full recycle on the scroll path).
	 */
	private requestFlushGated(reason: string): void {
		if (this.isScrolling || this.engine.isScrolling || this.isScrollFrameActive || this.engine.isScrollFrameActive) {
			this.flushPendingAfterScroll = true;
			return;
		}
		this.scheduler.requestFlush(reason);
	}

	private bindInvalidationSources(): void {
		const invalidateFull = () => {
			this.engine.invalidation.invalidateFull('state');
			this.requestFlushGated('state');
		};
		const invalidateHeaders = () => {
			this.engine.invalidation.invalidateHeaders('headers');
			this.requestFlushGated('headers');
		};
		const invalidateOverlay = () => {
			this.engine.invalidation.invalidateOverlay('overlay');
			this.requestFlushGated('overlay');
		};
		const invalidateViewport = () => {
			this.engine.invalidation.invalidateViewport('viewport');
			if (this.isScrolling || this.engine.isScrolling || this.isScrollFrameActive || this.engine.isScrollFrameActive) {
				this.viewportDirtyAfterScroll = true;
				return;
			}
			this.scheduler.requestFlush('viewport');
		};
		const invalidateData = () => {
			this.engine.invalidation.invalidateViewport('data');
			if (this.isScrolling || this.engine.isScrolling || this.isScrollFrameActive || this.engine.isScrollFrameActive) {
				this.viewportDirtyAfterScroll = true;
				return;
			}
			this.scheduler.requestFlush('data');
		};
		const invalidateDefaultColumnGeometry = () => {
			this.geometryController.invalidateAll();
			this.engine.invalidation.invalidateGeometry('columns');
			this.engine.invalidation.invalidateViewport('columns');
			this.engine.invalidation.invalidateHeaders('columns');
			this.updateCachedGeometryBounds();
			this.requestFlushGated('columns');
		};
		const invalidateGeometryFull = () => {
			this.geometryController.invalidateAll();
			this.engine.invalidation.invalidateGeometry('geometry');
			this.engine.invalidation.invalidateViewport('geometry');
			this.updateCachedGeometryBounds();
			this.requestFlushGated('geometry');
		};

		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('defaultRowHeight', invalidateGeometryFull));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('defaultColWidth', invalidateDefaultColumnGeometry));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('dataVersion', invalidateData));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('loading', invalidateViewport));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('visibleRowRange', invalidateViewport));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('visibleColRange', invalidateViewport));

		this.unsubscribers.push(
			this.engine.stateManager.subscribeToKey('columns', () => {
				// Release all custom renderer instances before the column-change repaint.
				// Without this a DOM renderer mounted in portalHostElement stays visible even
				// after a column switches to text mode, because text writes to contentElement
				// (a sibling div) and never clears portalHostElement.
				this.portalMountManager.releaseAll();
				invalidateFull();
			})
		);
		this.unsubscribers.push(
			this.engine.stateManager.subscribeToKey('columnWidths', () => {
				invalidateGeometryFull();
			})
		);
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('rowHeights', invalidateGeometryFull));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('enableColumnReorder', invalidateHeaders));
		this.unsubscribers.push(
			this.engine.stateManager.subscribeToKey('sortModel', () => {
				this.sortAnimation.captureSnapshot();
			})
		);
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('activeEdit', invalidateOverlay));
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener(GridEventName.selectionChanged, (event) => {
				const { result, selection } = event.payload;
				for (const cell of result.invalidatedCells) {
					this.engine.invalidation.invalidateCell(cell.rowId, cell.colField, 'selection');
				}
				for (const rowId of result.invalidatedRows) {
					this.engine.invalidation.invalidateRow(rowId, 'selection');
				}
				if (result.overlayChanged) {
					this.engine.invalidation.invalidateOverlay('selection');
				}
				if (selection?.focus && selection.source !== 'pointer') {
					this.scrollCellIntoView(selection.focus.rowId, selection.focus.colField);
				}
				this.requestFlushGated('selection');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener(GridEventName.cellInvalidated, () => {
				this.requestFlushGated('cell');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener(GridEventName.columnResized, (event) => {
				this.geometryController.invalidateColumns([event.payload.colField]);
				this.requestFlushGated('column resize');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener(GridEventName.rowResized, (event) => {
				this.geometryController.invalidateRows([event.payload.rowId]);
				this.requestFlushGated('row resize');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener(GridEventName.renderInvalidated, (event) => {
				this.requestFlushGated(event.payload.reason);
			})
		);
		this.unsubscribers.push(
			this.engine.stateManager.subscribeToKey('showGroupPanel', () => {
				const show = this.engine.stateManager.getState().showGroupPanel ?? false;
				this.viewportRenderer.setGroupPanelVisible(show);
			})
		);
	}

	public schedulePaint(): void {
		this.scheduleFullPaint('api');
	}

	public scheduleFullPaint(reason = 'api'): void {
		this.engine.invalidation.invalidateFull(reason);
		this.requestFlushGated(reason);
	}

	public scheduleViewportPaint(reason = 'viewport'): void {
		this.engine.invalidation.invalidateViewport(reason);
		this.requestFlushGated(reason);
	}

	public scheduleHeaderPaint(reason = 'headers'): void {
		this.engine.invalidation.invalidateHeaders(reason);
		this.requestFlushGated(reason);
	}

	public scheduleOverlayPaint(reason = 'overlay'): void {
		this.engine.invalidation.invalidateOverlay(reason);
		this.requestFlushGated(reason);
	}

	public scheduleCellPaint(rowId: string, colId: string, reason = 'cell'): void {
		this.engine.invalidation.invalidateCell(rowId, colId, reason);
		this.requestFlushGated(reason);
	}

	public scheduleRowPaint(rowId: string, reason = 'row'): void {
		this.engine.invalidation.invalidateRow(rowId, reason);
		this.requestFlushGated(reason);
	}

	public scheduleColumnPaint(colId: string, reason = 'column'): void {
		this.engine.invalidation.invalidateColumn(colId, reason);
		this.requestFlushGated(reason);
	}

	public scheduleGeometryPaint(reason = 'geometry'): void {
		this.geometryController.invalidateAll();
		this.engine.invalidation.invalidateGeometry(reason);
		this.engine.invalidation.invalidateViewport(reason);
		this.engine.invalidation.invalidateHeaders(reason);
		this.requestFlushGated(reason);
	}

	private flushPaint(): void {
		this.refreshRendererEpochs();
		const frame = this.engine.invalidation.consume();
		if (!this.isScrolling && frame.reasons.includes('sort')) {
			this._pendingSortAnimation = true;
		}
		this.portalMountManager.beginCellReleaseTransaction();
		try {
			this.orchestrator.flush(frame);
		} finally {
			this.portalMountManager.endCellReleaseTransaction();
		}
	}

	private refreshRendererEpochs(): void {
		const state = this.engine.stateManager.getState();
		if (this.lastStyleSlots !== state.styleSlots) {
			this.lastStyleSlots = state.styleSlots;
			this.rowRenderer.styleVersion++;
		}
		if (this.lastLoading !== state.loading) {
			this.lastLoading = state.loading;
			this.rowRenderer.loadingVersion++;
		}
	}

	public getRenderStats(): RenderStats {
		const stats = this.orchestrator.getStats();
		const portalScrollStats = this.portalMountManager.getScrollStats();
		return {
			...stats,
			scrollFrames: this.renderStats.scrollFrames,
			viewportRecycles: this.renderStats.viewportRecycles,
			headerPaintsDuringScroll: this.renderStats.headerPaintsDuringScroll,
			headerRangeSyncsDuringScroll: this.renderStats.headerRangeSyncsDuringScroll,
			overlayPaintsDuringScroll: this.renderStats.overlayPaintsDuringScroll,
			overlayCheapSyncsDuringScroll: this.renderStats.overlayCheapSyncsDuringScroll,
			focusCallsDuringScroll: this.renderStats.focusCallsDuringScroll,
			rootTextContentWritesOnPortalCells: this.renderStats.rootTextContentWritesOnPortalCells,
			cellsBoundDuringScroll: this.rowRenderer.currentScrollCellsPatched,
			rowsVisitedDuringScroll: this.rowRenderer.currentScrollRowsVisited,
			rowsReboundDuringScroll: this.rowRenderer.currentScrollRowsRebound,
			cellsVisitedDuringScroll: this.rowRenderer.currentScrollCellsVisited,
			cellsWrittenDuringScroll: this.rowRenderer.currentScrollCellsWritten,
			portalOpsDuringScroll:
				this.rowRenderer.currentScrollPortalOps + portalScrollStats.portalMountsDuringScroll + portalScrollStats.portalReleasesDuringScroll,
			cellsDecoratedAfterScroll: this.renderStats.cellsDecoratedAfterScroll,
			cellAccessReadsDuringScroll: this.renderStats.cellAccessReadsDuringScroll,
			cellClassComputesDuringScroll: this.renderStats.cellClassComputesDuringScroll,
			dirtyCellsMarkedDuringScroll: this.rowRenderer.dirtyCellsMarkedDuringScroll,
			postScrollDirtyCellsDecorated: this.rowRenderer.postScrollDirtyCellsDecorated,
			reusableCellsSkippedDuringScroll: this.renderStats.reusableCellsSkippedDuringScroll,
			styleHookCallsDuringScroll: this.renderStats.styleHookCallsDuringScroll,
			rowsEnteredDuringScroll: this.renderStats.rowsEnteredDuringScroll,
			rowsExitedDuringScroll: this.renderStats.rowsExitedDuringScroll,
			rowsStayedDuringScroll: this.renderStats.rowsStayedDuringScroll,
			colsEnteredDuringScroll: this.renderStats.colsEnteredDuringScroll,
			colsExitedDuringScroll: this.renderStats.colsExitedDuringScroll,
			colsStayedDuringScroll: this.renderStats.colsStayedDuringScroll,
			cellsSkippedDuringScroll: this.renderStats.cellsSkippedDuringScroll,
			sameWindowBailouts: this.renderStats.sameWindowBailouts,
			stateReadsDuringScroll: this.renderStats.stateReadsDuringScroll,
			compiledPlanVersion: this.engine.columns.getCompiledPlanVersion(),
			getCellValueCallsDuringScroll: this.engine.getCellValueCallsDuringScroll,
			valueGetterCallsDuringScroll: this.engine.valueGetterCallsDuringScroll,
			formulaCallsDuringScroll: this.engine.formulaCallsDuringScroll,
			customRendererMountsDuringScroll: this.engine.customRendererMountsDuringScroll,
			customRendererHydrationChunks: this.engine.customRendererHydrationChunks,
			customRendererWarmHits: this.engine.customRendererWarmHits,
			customRendererWarmMisses: this.engine.customRendererWarmMisses,
			...portalScrollStats,
			hotDomReleases: this.renderStats.rowsRecycledPerScrollFrame.reduce((a: number, b: number) => a + b, 0),
			coldDomReleases: 0,
			cellsPatchedPerScrollFrame: this.renderStats.cellsPatchedPerScrollFrame.slice(),
			rowsRecycledPerScrollFrame: this.renderStats.rowsRecycledPerScrollFrame.slice(),
			portalMounts: {
				...this.portalMountManager.getStats(),
				custom: this.portalMountManager.customRendererManager.getStats(),
			},
		};
	}

	public resetRenderStats(): void {
		this.orchestrator.resetStats();
		this.portalMountManager.resetStats();
		this.rowRenderer.dirtyCellsMarkedDuringScroll = 0;
		this.rowRenderer.postScrollDirtyCellsDecorated = 0;
		this.rowRenderer.currentScrollCellsPatched = 0;
		this.rowRenderer.currentScrollRowsRecycled = 0;
		this.rowRenderer.currentScrollRowsVisited = 0;
		this.rowRenderer.currentScrollRowsRebound = 0;
		this.rowRenderer.currentScrollCellsVisited = 0;
		this.rowRenderer.currentScrollCellsWritten = 0;
		this.rowRenderer.currentScrollPortalOps = 0;
		this.renderStats.scrollFrames = 0;
		this.renderStats.viewportRecycles = 0;
		this.renderStats.headerPaintsDuringScroll = 0;
		this.renderStats.headerRangeSyncsDuringScroll = 0;
		this.renderStats.overlayPaintsDuringScroll = 0;
		this.renderStats.overlayCheapSyncsDuringScroll = 0;
		this.renderStats.cellsPatchedPerScrollFrame = [];
		this.renderStats.rowsRecycledPerScrollFrame = [];
		this.renderStats.stateReadsDuringScroll = 0;
		this.renderStats.focusCallsDuringScroll = 0;
		this.renderStats.cellsDecoratedAfterScroll = 0;
		this.renderStats.rootTextContentWritesOnPortalCells = 0;
		this.renderStats.rowsVisitedDuringScroll = 0;
		this.renderStats.rowsReboundDuringScroll = 0;
		this.renderStats.cellsVisitedDuringScroll = 0;
		this.renderStats.cellsWrittenDuringScroll = 0;
		this.renderStats.portalOpsDuringScroll = 0;
		this.renderStats.cellAccessReadsDuringScroll = 0;
		this.renderStats.cellClassComputesDuringScroll = 0;
		this.renderStats.reusableCellsSkippedDuringScroll = 0;
		this.renderStats.styleHookCallsDuringScroll = 0;
		this.renderStats.rowsEnteredDuringScroll = 0;
		this.renderStats.rowsExitedDuringScroll = 0;
		this.renderStats.rowsStayedDuringScroll = 0;
		this.renderStats.colsEnteredDuringScroll = 0;
		this.renderStats.colsExitedDuringScroll = 0;
		this.renderStats.colsStayedDuringScroll = 0;
		this.renderStats.cellsSkippedDuringScroll = 0;
		this.renderStats.sameWindowBailouts = 0;
		this.renderStats.postScrollDecorationChunks = 0;
		this.renderStats.maxCellsDecoratedInOneChunk = 0;

		this.engine.getCellValueCallsDuringScroll = 0;
		this.engine.valueGetterCallsDuringScroll = 0;
		this.engine.formulaCallsDuringScroll = 0;
		this.engine.customRendererMountsDuringScroll = 0;
		this.engine.customRendererHydrationChunks = 0;
		this.engine.customRendererWarmHits = 0;
		this.engine.customRendererWarmMisses = 0;
	}

	public fullPaint(): void {
		this.portalMountManager.beginCellReleaseTransaction();
		try {
			this.fullPaintInternal();
		} finally {
			this.portalMountManager.endCellReleaseTransaction();
		}
	}

	private recycleViewport(isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow): void {
		this.renderStats.viewportRecycles++;
		this.rowRenderer.recycleViewport(isScrollFrameActive, ctx, precomputedWindow);
		if (!isScrollFrameActive && this.rowRenderer.currentWindow) {
			this.rowRenderer.syncPinnedLanePositions(this.rowRenderer.currentWindow, this.cachedTotalWidth);
		}
	}

	private fullPaintInternal(): void {
		this.viewportRenderer.syncViewportScrollFromDom();

		const state = this.engine.stateManager.getState();
		const colCount = this.engine.columns.getDisplayedColumnCount();

		// Keep scroll clamps and total extents in sync after any full repaint
		// (handles column adds/removes and viewport resizes funneled through full paint).
		this.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);

		this.viewportRenderer.syncSpacerAndLayers(state, colCount);
		this.recycleViewport(false);
		if (this._pendingSortAnimation) {
			this._pendingSortAnimation = false;
			this.sortAnimation.beginAnimation();
		}
		this.headerRenderer.repaintHeaders();
		this.overlayRenderer.repaintOverlay();
	}

	public scrollCellIntoView(rowId: string, colField: string): void {
		this.rowRenderer.programmaticScrollCell = { rowId, colField };
		const scrollViewport = this.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;

		const rowModel = this.engine.getRowModel();
		if (!rowModel) return;

		const rowIndex = rowModel.getVisualIndexByRowId(rowId);
		const colIndex = this.engine.columns.getColumnIndex(colField);
		if (rowIndex === null || rowIndex === -1 || colIndex === -1) return;

		const target = computeScrollTarget({
			rowIndex,
			colIndex,
			rowCount: rowModel.getVisualRowCount(),
			colCount: this.engine.columns.getDisplayedColumnCount(),
			pinLeftColumns: this.engine.viewport.pinLeftColumns,
			pinRightColumns: this.engine.viewport.pinRightColumns,
			pinTopRows: this.engine.viewport.pinTopRows,
			pinBottomRows: this.engine.viewport.pinBottomRows,
			scrollTop: this.engine.viewport.scrollTop,
			scrollLeft: this.engine.viewport.scrollLeft,
			viewportHeight: this.engine.viewport.viewportHeight,
			viewportWidth: this.engine.viewport.viewportWidth,
			rowTops: this.engine.geometry.rowTops,
			rowHeights: this.engine.geometry.rowHeights,
			colLefts: this.engine.geometry.colLefts,
			colWidths: this.engine.geometry.colWidths,
			scrollViewportScrollHeight: scrollViewport.scrollHeight,
			scrollViewportScrollWidth: scrollViewport.scrollWidth,
			scrollViewportClientHeight: scrollViewport.clientHeight,
			scrollViewportClientWidth: scrollViewport.clientWidth,
		});

		if (target) {
			this.scrollEngine.scrollTo(target.top, target.left);
			this.engine.viewport.setScrollPosition(target.top, target.left);
		}
	}

	private onRowMouseOver = (event: MouseEvent): void => {
		// During scroll the viewport is moving — hover state would flicker across every
		// row the pointer passes over and trigger className writes + style recalcs on each.
		// Suppress until scrolling stops; finishScrolling clears the hovered row anyway.
		if (this.isScrolling) return;

		const rowEl = (event.target as HTMLElement).closest('.og-row') as HTMLElement | null;
		const rowIndexText = rowEl?.dataset.rowIndex;
		if (rowIndexText === undefined) {
			this.setHoveredRowIndex(null);
			return;
		}

		const rowIndex = Number(rowIndexText);
		this.setHoveredRowIndex(Number.isFinite(rowIndex) ? rowIndex : null);
	};

	private onRowMouseLeave = (): void => {
		this.setHoveredRowIndex(null);
	};

	private setHoveredRowIndex(rowIndex: number | null): void {
		if (this.rowRenderer.hoveredRowIndex === rowIndex) return;

		if (this.rowRenderer.hoveredRowIndex !== null) {
			this.setPooledRowHoverClass(this.rowRenderer.hoveredRowIndex, false);
		}

		this.rowRenderer.hoveredRowIndex = rowIndex;

		if (rowIndex !== null) {
			this.setPooledRowHoverClass(rowIndex, true);
		}
	}

	private setPooledRowHoverClass(rowIndex: number, hovered: boolean): void {
		const pooledRow = this.rowRenderer.activeRows.get(rowIndex);
		if (!pooledRow) return;

		pooledRow.element.classList.toggle('og-row-hovered', hovered);
	}
}

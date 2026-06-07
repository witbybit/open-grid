import { ScrollEngine } from './scrollEngine.js';
import { sameRenderedWindow, applyRenderWindowRuntimeLimits, computeRenderWindow, type RenderWindow } from './renderWindow.js';
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
import { FullWidthRowRenderer } from './fullWidthRowRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { type ColumnDef, type GridApi, type InternalGridApi, type SelectionChangeResult, type ColumnRenderPlan } from '../store.js';

/**
 * Owns the grid DOM, coordinating ViewportRenderer, RowRenderer, and other sub-renderers.
 */
export class RenderEngine<TRowData = unknown> implements IGridRenderer<TRowData> {
	private readonly engine: GridEngine<TRowData>;
	private readonly api?: InternalGridApi<TRowData>;

	private cachedColumnPlans: ColumnRenderPlan<TRowData>[] | null = null;
	private cachedHasCustomRenderers: boolean | null = null;

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
	private readonly fullWidthRowRenderer: FullWidthRowRenderer;

	private unsubscribers: Array<() => void> = [];
	private activeHeaderPopover: HTMLDivElement | null = null;
	private activeHeaderPopoverElement: HTMLElement | null = null;

	private isScrolling = false;
	private scrollEndRafId: number | null = null;
	private scrollEndFrameCount = 0;
	private viewportDirtyAfterScroll = false;
	private needsPostScrollPortalFlush = false;
	private portalFlushScheduled = false;
	private isScrollFrameActive = false;
	private postScrollDecorationScheduled = false;
	private postScrollDecorationTimer: number | null = null;
	private lastHeaderScrollLeft = 0;

	private lastStyleSlots: unknown = undefined;
	private lastLoading: unknown = undefined;

	// Cached maximum scroll-left so the raw DOM scroll handler (120/sec on high-refresh
	// displays) never needs to call getState() or geometry on the hot path.
	private cachedMaxScrollLeft = 0;
	private cachedTotalWidth = 0;
	private cachedTotalHeight = 0;

	// Reusable ScrollRenderContext updated in-place each scroll frame to avoid allocation.
	private _scrollCtx!: ScrollRenderContext<TRowData>;

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
			displayedColumns: [],
			columnPlans: [],
			visibleColRange: { startIdx: 0, endIdx: 0 },
			focusedCell: null,
			selectionBounds: undefined,
			canUseCachedDisplayValues: true,
		};
		this.portalMountManager = new PortalMountManager<TRowData>(engine);
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

		this.headerRenderer = new HeaderRenderer<TRowData>(
			engine,
			() => this.columnInteractions,
			(cell, colField) => this.showHeaderMenu(cell, colField)
		);
		this.overlayRenderer = new OverlayRenderer<TRowData>(
			engine,
			this.viewportRenderer,
			() => this.columnInteractions,
			() => this.fillDrag
		);
		this.overlayRenderer.renderStats = this.renderStats;

		this.fullWidthRowRenderer = new FullWidthRowRenderer(() => undefined);

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
		this.hideHeaderMenu();

		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];

		this.scrollEngine.unbind();
		const scrollViewport = this.viewportRenderer.scrollViewport;
		if (scrollViewport) {
			scrollViewport.removeEventListener('mouseover', this.onRowMouseOver);
			scrollViewport.removeEventListener('mouseleave', this.onRowMouseLeave);
		}
		this.columnInteractions.cleanup();
		this.fillDrag.cleanup();
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
	 * Scroll hot path — zero allocations, zero state reads.
	 * cachedMaxScrollLeft is updated in flushScrollFrame/fullPaintInternal/geometry callbacks.
	 */
	private onScroll = (scrollTop: number, scrollLeft: number): void => {
		const clampedScrollLeft = Math.max(0, Math.min(this.cachedMaxScrollLeft, scrollLeft));
		if (clampedScrollLeft !== scrollLeft && this.viewportRenderer.scrollViewport) {
			this.viewportRenderer.scrollViewport.scrollLeft = clampedScrollLeft;
		}
		const changed = this.engine.viewport.setScrollPosition(scrollTop, clampedScrollLeft);
		if (!changed) return;
		this.markScrolling();
		// Schedule scroll frame first so its RAF callback is ordered before the scroll-end RAF
		this.scrollScheduler.requestFrame();
		this.scheduleScrollEnd();
	};

	private markScrolling(): void {
		this.isScrolling = true;
		this.engine.isScrolling = true;
		this.rowRenderer.isScrolling = true;
		this.portalMountManager.setScrolling(true);
		this.clearScrollEndTimer();
		this.clearPostScrollDecorationTimer();
	}

	// RAF-counter scroll-end: fires finishScrolling after N consecutive frames with no new
	// scroll event. Device-rate-agnostic (~67ms at 60fps, ~33ms at 120fps vs fixed 80ms).
	private scheduleScrollEnd(): void {
		const targetCount = ++this.scrollEndFrameCount;
		const tick = (remaining: number) => {
			if (this.scrollEndFrameCount !== targetCount) return; // new scroll arrived
			if (remaining > 0) {
				this.scrollEndRafId = requestAnimationFrame(() => tick(remaining - 1));
			} else {
				this.scrollEndRafId = null;
				this.finishScrolling();
			}
		};
		this.scrollEndRafId = requestAnimationFrame(() => tick(3));
	}

	private finishScrolling(): void {
		this.clearScrollEndTimer();
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
		if (this.scrollEndRafId !== null) {
			cancelAnimationFrame(this.scrollEndRafId);
			this.scrollEndRafId = null;
		}
	}

	private flushPendingPortalReleasesAfterScroll(): void {
		if (this.rowRenderer.pendingPortalReleasesAfterScroll.size === 0) return;
		const pending = Array.from(this.rowRenderer.pendingPortalReleasesAfterScroll.values());
		this.rowRenderer.pendingPortalReleasesAfterScroll.clear();
		this.portalMountManager.releaseCells(pending, true);
		this.needsPostScrollPortalFlush = true;
	}

	private scheduleBudgetedPortalFlush(): void {
		if (this.portalFlushScheduled) return;
		this.portalFlushScheduled = true;
		const schedule =
			typeof window !== 'undefined' && 'requestIdleCallback' in window
				? (callback: () => void) => (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(callback)
				: (callback: () => void) => requestAnimationFrame(() => callback());

		schedule(() => {
			this.portalFlushScheduled = false;
			if (this.isScrolling) {
				this.needsPostScrollPortalFlush = true;
				return;
			}
			const result = this.portalMountManager.flushDeferred({
				maxItems: this.portalFlushBudget,
				reason: 'scroll-idle',
				flushSync: false,
			});
			this.needsPostScrollPortalFlush = result.remaining > 0;
			if (result.remaining > 0) {
				this.scheduleBudgetedPortalFlush();
			}
		});
	}

	private clearPostScrollDecorationTimer(): void {
		if (this.postScrollDecorationTimer !== null) {
			if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
				(window as any).cancelIdleCallback(this.postScrollDecorationTimer);
			} else {
				cancelAnimationFrame(this.postScrollDecorationTimer);
			}
			this.postScrollDecorationTimer = null;
		}
		this.postScrollDecorationScheduled = false;
	}

	private scheduleBudgetedDecoration(): void {
		if (this.postScrollDecorationScheduled) return;
		this.postScrollDecorationScheduled = true;

		const schedule =
			typeof window !== 'undefined' && 'requestIdleCallback' in window
				? (callback: () => void) => (window as any).requestIdleCallback(callback)
				: (callback: () => void) => requestAnimationFrame(() => callback());

		this.postScrollDecorationTimer = schedule(() => {
			this.postScrollDecorationTimer = null;
			this.postScrollDecorationScheduled = false;

			if (this.isScrolling) {
				return;
			}

			this.renderStats.postScrollDecorationChunks++;
			const result = this.rowRenderer.decorateDirtyCellsAfterScroll({ maxCells: this.postScrollDecorationBudget });

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

		// Refresh the cached scroll-left bound using the already-read state — no extra
		// state read. This handles viewport resizes that happened since the last frame.
		this.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);

		const nextWindow = applyRenderWindowRuntimeLimits(computeRenderWindow(this.engine), state.runtimeLimits);

		// Same window bailout path
		if (sameRenderedWindow(this.rowRenderer.currentWindow, nextWindow)) {
			this.renderStats.scrollFrames++;
			this.renderStats.sameWindowBailouts = (this.renderStats.sameWindowBailouts || 0) + 1;
			this.syncCheapScrollOnly(nextWindow);
			return;
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
			const displayedColumns = this.engine.columns.getDisplayedColumns();
			const colCount = displayedColumns.length;
			const visibleColRange = this.engine.viewport.getVisibleColumnRange(colCount);

			// Update the reusable ScrollRenderContext in-place — avoids one object
			// allocation per scroll frame while keeping all cached references fresh.
			const scrollCtx = this._scrollCtx;
			scrollCtx.dataVersion = state.dataVersion;
			scrollCtx.styleVersion = this.rowRenderer.styleVersion;
			scrollCtx.loadingVersion = this.rowRenderer.loadingVersion;
			scrollCtx.activeEdit = state.activeEdit;
			scrollCtx.hasStyleHooks = !!(state.styleSlots?.cellClass || state.styleSlots?.beforeCellRender || state.styleSlots?.afterCellRender);
			scrollCtx.hasCustomRenderers = this.cachedHasCustomRenderers ??= displayedColumns.some((c) => !!c.cellRenderer);
			scrollCtx.displayedColumns = displayedColumns;
			scrollCtx.columnPlans = this.cachedColumnPlans ??= displayedColumns.map((c) => this.engine.columns.getColumnPlan(c.field)!);
			scrollCtx.visibleColRange = visibleColRange;
			scrollCtx.focusedCell = state.selection.focus;
			scrollCtx.selectionBounds = state.selection.bounds ?? undefined;

			// Pass the already-computed nextWindow so rowRenderer.recycleViewport does not
			// call computeRenderWindow a second time (duplicate binary searches + state read).
			this.recycleViewport(true, scrollCtx, nextWindow);
			this.rowRenderer.syncPinnedLanePositions(nextWindow, this.cachedTotalWidth);
			this.headerRenderer.syncScrollLeft(this.engine.viewport.scrollLeft, this.cachedTotalWidth, nextWindow.colCount);
			const didSyncRange = this.headerRenderer.syncVisibleColumnRange();
			if (didSyncRange) {
				this.renderStats.headerRangeSyncsDuringScroll++;
			}
			this.lastHeaderScrollLeft = this.engine.viewport.scrollLeft;
			this.renderStats.overlayCheapSyncsDuringScroll++;
			this.overlayRenderer.syncScrollPosition();
		} finally {
			const stateReadsInFrame = this.engine.stateManager.debugGetStateCount - startStateReads;
			this.renderStats.stateReadsDuringScroll += stateReadsInFrame;

			this.renderStats.cellsPatchedPerScrollFrame.push(this.rowRenderer.currentScrollCellsPatched);
			this.renderStats.rowsRecycledPerScrollFrame.push(this.rowRenderer.currentScrollRowsRecycled);
			this.isScrollFrameActive = false;
			this.engine.isScrollFrameActive = false;
			this.rowRenderer.isScrollFrameActive = false;
		}
	}

	private syncCheapScrollOnly(window: RenderWindow): void {
		// 1. Header scrollLeft transform
		this.headerRenderer.syncScrollLeft(this.engine.viewport.scrollLeft, this.cachedTotalWidth, window.colCount);

		// 2. Selection overlay transform
		this.renderStats.overlayCheapSyncsDuringScroll++;
		this.overlayRenderer.syncScrollPosition();

		// 3. Pinned rows position update (if any)
		const pinTopRows = window.pinTopRows;
		const pinBottomRows = window.pinBottomRows;
		if (pinTopRows > 0 || pinBottomRows > 0) {
			const scrollTop = this.engine.viewport.scrollTop;
			const viewportHeight = this.engine.viewport.viewportHeight;
			const totalHeight = this.cachedTotalHeight;

			// Update pinned top rows
			for (let r = 0; r < pinTopRows && r < window.rowCount; r++) {
				const slot = this.rowRenderer.activeRows.get(r);
				if (slot) {
					const rowTop = this.engine.geometry.rowTops[r] + scrollTop;
					slot.updatePosition(rowTop);
				}
			}

			// Update pinned bottom rows
			for (let r = window.rowCount - pinBottomRows; r < window.rowCount; r++) {
				if (r >= pinTopRows) {
					const slot = this.rowRenderer.activeRows.get(r);
					if (slot) {
						const bottomOffset = totalHeight - this.engine.geometry.rowTops[r];
						const rowTop = scrollTop + viewportHeight - bottomOffset;
						slot.updatePosition(rowTop);
					}
				}
			}
		}

		this.rowRenderer.syncPinnedLanePositions(window, this.cachedTotalWidth);

		// Update current window's scroll values
		if (this.rowRenderer.currentWindow) {
			this.rowRenderer.currentWindow.scrollTop = this.engine.viewport.scrollTop;
			this.rowRenderer.currentWindow.scrollLeft = this.engine.viewport.scrollLeft;
		}
	}

	private updateCachedGeometryBoundsFromState(defaultColWidth: number, defaultRowHeight: number): void {
		this.cachedTotalWidth = this.engine.geometry.getTotalWidth(defaultColWidth);
		this.cachedTotalHeight = this.engine.geometry.getTotalHeight(defaultRowHeight);
		this.cachedMaxScrollLeft = Math.max(0, this.cachedTotalWidth - this.engine.viewport.viewportWidth);
	}

	private updateCachedGeometryBounds(): void {
		const state = this.engine.stateManager.getState();
		this.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);
	}

	private bindInvalidationSources(): void {
		const invalidateFull = () => {
			clearColumnCaches();
			this.engine.invalidation.invalidateFull('state');
			this.scheduler.requestFlush('state');
		};
		const invalidateHeaders = () => {
			this.engine.invalidation.invalidateHeaders('headers');
			this.scheduler.requestFlush('headers');
		};
		const invalidateOverlay = () => {
			this.engine.invalidation.invalidateOverlay('overlay');
			this.scheduler.requestFlush('overlay');
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
		const clearColumnCaches = () => {
			this.cachedColumnPlans = null;
			this.cachedHasCustomRenderers = null;
		};
		const invalidateDefaultColumnGeometry = () => {
			clearColumnCaches();
			this.geometryController.invalidateAll();
			this.engine.invalidation.invalidateGeometry('columns');
			this.engine.invalidation.invalidateViewport('columns');
			this.engine.invalidation.invalidateHeaders('columns');
			this.updateCachedGeometryBounds();
			this.scheduler.requestFlush('columns');
		};
		const invalidateGeometryFull = () => {
			this.geometryController.invalidateAll();
			this.engine.invalidation.invalidateGeometry('geometry');
			this.engine.invalidation.invalidateViewport('geometry');
			this.updateCachedGeometryBounds();
			this.scheduler.requestFlush('geometry');
		};

		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('defaultRowHeight', invalidateGeometryFull));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('defaultColWidth', invalidateDefaultColumnGeometry));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('dataVersion', invalidateData));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('loading', invalidateViewport));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('visibleRowRange', invalidateViewport));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('visibleColRange', invalidateViewport));

		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('columns', invalidateFull));
		this.unsubscribers.push(
			this.engine.stateManager.subscribeToKey('columnWidths', () => {
				clearColumnCaches();
				invalidateGeometryFull();
			})
		);
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('rowHeights', invalidateGeometryFull));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('enableColumnReorder', invalidateHeaders));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('activeEdit', invalidateOverlay));
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener<{ selection: any; result: SelectionChangeResult }>('selectionChanged', (event) => {
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
				this.scheduler.requestFlush('selection');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener('cellInvalidated', () => {
				this.scheduler.requestFlush('cell');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener<{ colField: string }>('columnResized', (event) => {
				this.geometryController.invalidateColumns([event.payload.colField]);
				this.scheduler.requestFlush('column resize');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener<{ rowId: string }>('rowResized', (event) => {
				this.geometryController.invalidateRows([event.payload.rowId]);
				this.scheduler.requestFlush('row resize');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener<{ reason: string }>('renderInvalidated', (event) => {
				this.scheduler.requestFlush(event.payload.reason);
			})
		);
	}

	public schedulePaint(): void {
		this.scheduleFullPaint('api');
	}

	public scheduleFullPaint(reason = 'api'): void {
		this.engine.invalidation.invalidateFull(reason);
		this.scheduler.requestFlush(reason);
	}

	public scheduleViewportPaint(reason = 'viewport'): void {
		this.engine.invalidation.invalidateViewport(reason);
		this.scheduler.requestFlush(reason);
	}

	public scheduleHeaderPaint(reason = 'headers'): void {
		this.engine.invalidation.invalidateHeaders(reason);
		this.scheduler.requestFlush(reason);
	}

	public scheduleOverlayPaint(reason = 'overlay'): void {
		this.engine.invalidation.invalidateOverlay(reason);
		this.scheduler.requestFlush(reason);
	}

	public scheduleCellPaint(rowId: string, colId: string, reason = 'cell'): void {
		this.engine.invalidation.invalidateCell(rowId, colId, reason);
		this.scheduler.requestFlush(reason);
	}

	public scheduleRowPaint(rowId: string, reason = 'row'): void {
		this.engine.invalidation.invalidateRow(rowId, reason);
		this.scheduler.requestFlush(reason);
	}

	public scheduleColumnPaint(colId: string, reason = 'column'): void {
		this.engine.invalidation.invalidateColumn(colId, reason);
		this.scheduler.requestFlush(reason);
	}

	public scheduleGeometryPaint(reason = 'geometry'): void {
		this.geometryController.invalidateAll();
		this.engine.invalidation.invalidateGeometry(reason);
		this.engine.invalidation.invalidateViewport(reason);
		this.engine.invalidation.invalidateHeaders(reason);
		this.scheduler.requestFlush(reason);
	}

	private flushPaint(): void {
		this.refreshRendererEpochs();
		this.portalMountManager.beginCellReleaseTransaction();
		try {
			this.orchestrator.flush(this.engine.invalidation.consume());
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
			getCellValueCallsDuringScroll: this.engine.getCellValueCallsDuringScroll,
			valueGetterCallsDuringScroll: this.engine.valueGetterCallsDuringScroll,
			formulaCallsDuringScroll: this.engine.formulaCallsDuringScroll,
			customRendererMountsDuringScroll: this.engine.customRendererMountsDuringScroll,
			customRendererHydrationChunks: this.engine.customRendererHydrationChunks,
			customRendererWarmHits: this.engine.customRendererWarmHits,
			customRendererWarmMisses: this.engine.customRendererWarmMisses,
			...portalScrollStats,
			hotDomReleases: (this.rowRenderer.rowPool?.hotReleases ?? 0) + (this.rowRenderer.cellPool?.hotReleases ?? 0),
			coldDomReleases: (this.rowRenderer.rowPool?.coldReleases ?? 0) + (this.rowRenderer.cellPool?.coldReleases ?? 0),
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
		this.rowRenderer.rowPool?.resetStats();
		this.rowRenderer.cellPool?.resetStats();
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
		this.lastHeaderScrollLeft = this.engine.viewport.scrollLeft;
		this.headerRenderer.repaintHeaders();
		this.overlayRenderer.repaintOverlay();
	}

	private hideHeaderMenu = (): void => {
		if (this.activeHeaderPopover) {
			this.activeHeaderPopover.classList.remove('og-visible');
			const el = this.activeHeaderPopover;
			const colField = this.activeHeaderPopoverElement?.dataset.colField;
			if (colField) {
				this.portalMountManager.releaseHeaderMenu({ colField, container: el });
			}
			setTimeout(() => {
				el.remove();
			}, 120);
			this.activeHeaderPopover = null;
		}
		this.activeHeaderPopoverElement = null;
		document.removeEventListener('mousedown', this.handleOutsidePopoverClick);
		window.removeEventListener('scroll', this.hideHeaderMenu, { capture: true });
		window.removeEventListener('resize', this.hideHeaderMenu);
	};

	private handleOutsidePopoverClick = (e: MouseEvent): void => {
		if (this.activeHeaderPopover && !this.activeHeaderPopover.contains(e.target as Node)) {
			const clickedMenuBtn = (e.target as HTMLElement).closest('.og-header-menu-button');
			if (clickedMenuBtn && clickedMenuBtn.closest('.og-header-cell') === this.activeHeaderPopoverElement) {
				return;
			}
			this.hideHeaderMenu();
		}
	};

	private showHeaderMenu(headerCell: HTMLElement, colField: string): void {
		if (this.activeHeaderPopover && this.activeHeaderPopoverElement === headerCell) {
			this.hideHeaderMenu();
			return;
		}
		this.hideHeaderMenu();

		const rect = headerCell.getBoundingClientRect();
		const state = this.engine.stateManager.getState();
		const column = state.columns.find((c) => c.field === colField);
		if (!column) return;

		const popover = document.createElement('div');
		popover.className = 'og-header-popover';
		this.activeHeaderPopover = popover;
		this.activeHeaderPopoverElement = headerCell;

		if (column.headerMenuComponent && this.portalMountManager.onMountHeaderMenu) {
			try {
				this.portalMountManager.mountHeaderMenu({
					colField,
					column,
					close: this.hideHeaderMenu,
					container: popover,
				});
				document.body.appendChild(popover);
				this.positionPopover(popover, rect);

				document.addEventListener('mousedown', this.handleOutsidePopoverClick);
				window.addEventListener('scroll', this.hideHeaderMenu, { capture: true, passive: true });
				window.addEventListener('resize', this.hideHeaderMenu);
				return;
			} catch (err) {
				console.error('RenderEngine: Error mounting custom React header menu', err);
			}
		}

		if (column.headerMenuRenderer) {
			try {
				column.headerMenuRenderer({
					colField,
					column,
					api: (this.api || this.engine.stateManager) as unknown as GridApi<TRowData>,
					close: this.hideHeaderMenu,
					container: popover,
				});
				document.body.appendChild(popover);
				this.positionPopover(popover, rect);

				document.addEventListener('mousedown', this.handleOutsidePopoverClick);
				window.addEventListener('scroll', this.hideHeaderMenu, { capture: true, passive: true });
				window.addEventListener('resize', this.hideHeaderMenu);
				return;
			} catch (err) {
				console.error('RenderEngine: Error rendering custom header menu', err);
			}
		}

		const sortContainer = document.createElement('div');
		sortContainer.className = 'og-popover-sort-section';

		const currentSort = state.sortModel?.find((s) => s.colId === colField);

		const sortAsc = document.createElement('div');
		sortAsc.className = 'og-popover-item' + (currentSort?.sort === 'asc' ? ' og-active' : '');
		sortAsc.innerHTML = `
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7-7 7 7"/></svg>
			<span>Sort Ascending</span>
		`;
		sortAsc.addEventListener('click', () => {
			this.engine.setSortModel([{ colId: colField, sort: 'asc' }]);
			this.hideHeaderMenu();
		});
		sortContainer.appendChild(sortAsc);

		const sortDesc = document.createElement('div');
		sortDesc.className = 'og-popover-item' + (currentSort?.sort === 'desc' ? ' og-active' : '');
		sortDesc.innerHTML = `
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7 7 7-7"/></svg>
			<span>Sort Descending</span>
		`;
		sortDesc.addEventListener('click', () => {
			this.engine.setSortModel([{ colId: colField, sort: 'desc' }]);
			this.hideHeaderMenu();
		});
		sortContainer.appendChild(sortDesc);

		if (currentSort) {
			const clearSort = document.createElement('div');
			clearSort.className = 'og-popover-item og-danger';
			clearSort.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
				<span>Clear Sorting</span>
			`;
			clearSort.addEventListener('click', () => {
				this.engine.setSortModel(null);
				this.hideHeaderMenu();
			});
			sortContainer.appendChild(clearSort);
		}

		popover.appendChild(sortContainer);

		const divider = document.createElement('div');
		divider.className = 'og-popover-divider';
		popover.appendChild(divider);

		const filterContainer = document.createElement('div');
		filterContainer.className = 'og-popover-filter-section';

		const filterTitle = document.createElement('div');
		filterTitle.className = 'og-popover-section-title';
		filterTitle.textContent = 'Filter Column';
		filterContainer.appendChild(filterTitle);

		let currentOperator = 'contains';
		let currentFilterVal = '';
		if (state.filterModel && state.filterModel[colField] !== undefined) {
			const filterObj = state.filterModel[colField];
			if (filterObj && typeof filterObj === 'object' && 'filter' in filterObj) {
				currentOperator = (filterObj as any).type ?? 'contains';
				currentFilterVal = String((filterObj as any).filter ?? '');
			} else {
				currentFilterVal = String(filterObj ?? '');
			}
		}

		const select = document.createElement('select');
		select.className = 'og-popover-select';
		const operators = [
			{ value: 'contains', label: 'Contains' },
			{ value: 'equals', label: 'Equals' },
			{ value: 'startsWith', label: 'Starts with' },
			{ value: 'endsWith', label: 'Ends with' },
			{ value: 'gt', label: 'Greater than' },
			{ value: 'gte', label: 'Greater or equal' },
			{ value: 'lt', label: 'Less than' },
			{ value: 'lte', label: 'Less or equal' },
		];
		operators.forEach((op) => {
			const opt = document.createElement('option');
			opt.value = op.value;
			opt.textContent = op.label;
			if (op.value === currentOperator) {
				opt.selected = true;
			}
			select.appendChild(opt);
		});
		filterContainer.appendChild(select);

		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'og-popover-input';
		input.placeholder = 'Filter value...';
		input.value = currentFilterVal;
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				applyBtn.click();
			}
		});
		filterContainer.appendChild(input);

		const btnGroup = document.createElement('div');
		btnGroup.className = 'og-popover-btn-group';

		const clearBtn = document.createElement('button');
		clearBtn.className = 'og-popover-btn og-btn-secondary';
		clearBtn.textContent = 'Clear';
		clearBtn.addEventListener('click', () => {
			const nextFilterModel = { ...(state.filterModel || {}) };
			delete nextFilterModel[colField];
			this.engine.setFilterModel(Object.keys(nextFilterModel).length > 0 ? nextFilterModel : null);
			this.hideHeaderMenu();
		});
		btnGroup.appendChild(clearBtn);

		const applyBtn = document.createElement('button');
		applyBtn.className = 'og-popover-btn og-btn-primary';
		applyBtn.textContent = 'Apply';
		applyBtn.addEventListener('click', () => {
			const term = input.value.trim();
			const nextFilterModel = { ...(state.filterModel || {}) };
			if (term === '') {
				delete nextFilterModel[colField];
			} else {
				nextFilterModel[colField] = {
					type: select.value as any,
					filter: term,
				};
			}
			this.engine.setFilterModel(Object.keys(nextFilterModel).length > 0 ? nextFilterModel : null);
			this.hideHeaderMenu();
		});
		btnGroup.appendChild(applyBtn);

		filterContainer.appendChild(btnGroup);
		popover.appendChild(filterContainer);

		document.body.appendChild(popover);
		this.positionPopover(popover, rect);

		document.addEventListener('mousedown', this.handleOutsidePopoverClick);
		window.addEventListener('scroll', this.hideHeaderMenu, { capture: true, passive: true });
		window.addEventListener('resize', this.hideHeaderMenu);
	}

	private positionPopover(popover: HTMLDivElement, rect: DOMRect): void {
		const popoverWidth = 220;
		const popoverHeight = popover.offsetHeight || 215;

		let left = rect.left;
		let top = rect.bottom + 4;

		if (left + popoverWidth > window.innerWidth) {
			left = window.innerWidth - popoverWidth - 8;
		}
		if (top + popoverHeight > window.innerHeight) {
			top = rect.top - popoverHeight - 4;
		}

		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;

		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(() => {
				popover.classList.add('og-visible');
			});
		} else {
			popover.classList.add('og-visible');
		}
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

		const rowCount = rowModel.getVisualRowCount();
		const colCount = this.engine.columns.getDisplayedColumnCount();

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;

		const scrollTop = this.engine.viewport.scrollTop;
		const scrollLeft = this.engine.viewport.scrollLeft;
		const viewportHeight = this.engine.viewport.viewportHeight;
		const viewportWidth = this.engine.viewport.viewportWidth;

		let pinnedLeftWidth = 0;
		for (let i = 0; i < pinLeftColumns && i < colCount; i++) {
			pinnedLeftWidth += this.engine.geometry.colWidths[i] || 0;
		}

		let pinnedRightWidth = 0;
		for (let i = 0; i < pinRightColumns && i < colCount; i++) {
			pinnedRightWidth += this.engine.geometry.colWidths[colCount - 1 - i] || 0;
		}

		let pinnedTopHeight = 0;
		for (let i = 0; i < pinTopRows && i < rowCount; i++) {
			pinnedTopHeight += this.engine.geometry.rowHeights[i] || 0;
		}

		let pinnedBottomHeight = 0;
		for (let i = 0; i < pinBottomRows && i < rowCount; i++) {
			pinnedBottomHeight += this.engine.geometry.rowHeights[rowCount - 1 - i] || 0;
		}

		let targetScrollTop = scrollTop;
		let targetScrollLeft = scrollLeft;

		// 1. Vertical Scroll Into View
		if (rowIndex >= pinTopRows && rowIndex < rowCount - pinBottomRows) {
			const rowTop = this.engine.geometry.rowTops[rowIndex] || 0;
			const rowHeight = this.engine.geometry.rowHeights[rowIndex] || 0;

			const visibleTopLimit = scrollTop + pinnedTopHeight;
			const visibleBottomLimit = scrollTop + (viewportHeight - 40) - pinnedBottomHeight;

			if (rowTop < visibleTopLimit) {
				targetScrollTop = rowTop - pinnedTopHeight;
			} else if (rowTop + rowHeight > visibleBottomLimit) {
				targetScrollTop = rowTop + rowHeight - (viewportHeight - 40) + pinnedBottomHeight;
			}
		}

		// 2. Horizontal Scroll Into View
		if (colIndex >= pinLeftColumns && colIndex < colCount - pinRightColumns) {
			const colLeft = this.engine.geometry.colLefts[colIndex] || 0;
			const colWidth = this.engine.geometry.colWidths[colIndex] || 0;

			const visibleLeftLimit = scrollLeft + pinnedLeftWidth;
			const visibleRightLimit = scrollLeft + viewportWidth - pinnedRightWidth;

			if (colLeft < visibleLeftLimit) {
				targetScrollLeft = colLeft - pinnedLeftWidth;
			} else if (colLeft + colWidth > visibleRightLimit) {
				targetScrollLeft = colLeft + colWidth - viewportWidth + pinnedRightWidth;
			}
		}

		// Clamp scroll positions (only if layout dimensions are populated, e.g. not in headless JSDOM)
		if (scrollViewport.scrollHeight > 0) {
			const maxScrollTop = Math.max(0, scrollViewport.scrollHeight - scrollViewport.clientHeight);
			targetScrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));
		} else {
			targetScrollTop = Math.max(0, targetScrollTop);
		}
		if (scrollViewport.scrollWidth > 0) {
			const maxScrollLeft = Math.max(0, scrollViewport.scrollWidth - scrollViewport.clientWidth);
			targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));
		} else {
			targetScrollLeft = Math.max(0, targetScrollLeft);
		}

		if (targetScrollTop !== scrollTop || targetScrollLeft !== scrollLeft) {
			this.scrollEngine.scrollTo(targetScrollTop, targetScrollLeft);
			this.engine.viewport.setScrollPosition(targetScrollTop, targetScrollLeft);
		}
	}

	private onRowMouseOver = (event: MouseEvent): void => {
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

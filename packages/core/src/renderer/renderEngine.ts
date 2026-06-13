import { HeaderMenuController } from './headerMenuController.js';
import { ScrollEngine } from './scrollEngine.js';
import { createEmptyRenderWindow, type RenderWindow } from './renderWindow.js';
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
import { LayoutTransitionController } from './layoutTransitionController.js';
import { GroupPanelRenderer } from './groupPanelRenderer.js';
import { StatusBarRenderer } from './statusBarRenderer.js';
import { PaginationBarRenderer } from './paginationBarRenderer.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { StickyGroupRenderer } from './stickyGroupRenderer.js';
import { RenderInvalidationCoordinator } from './RenderInvalidationCoordinator.js';
import { collectRenderStats, createRenderRuntimeStats, resetRenderTelemetry } from './renderTelemetry.js';
import { RenderPaintCoordinator, type RenderPaintCoordinatorState } from './renderPaintCoordinator.js';
import { RenderScrollCoordinator, type RenderScrollCoordinatorState } from './renderScrollCoordinator.js';
import { RenderViewportCoordinator } from './renderViewportCoordinator.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GridApi, InternalGridApi } from '../store.js';

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
	private readonly paintCoordinator!: RenderPaintCoordinator<TRowData>;
	private readonly scrollCoordinator!: RenderScrollCoordinator<TRowData>;
	private readonly viewportCoordinator!: RenderViewportCoordinator<TRowData>;

	public readonly portalMountManager: PortalMountManager<TRowData>;
	public readonly viewportRenderer: ViewportRenderer<TRowData>;
	public readonly rowRenderer: RowRenderer<TRowData>;
	public readonly cellRenderer: CellRenderer;
	public readonly headerRenderer: HeaderRenderer<TRowData>;
	public readonly overlayRenderer: OverlayRenderer<TRowData>;
	public readonly groupPanelRenderer: GroupPanelRenderer<TRowData>;
	public readonly statusBarRenderer: StatusBarRenderer<TRowData>;
	public readonly paginationBarRenderer: PaginationBarRenderer<TRowData>;
	public readonly stickyGroupRenderer: StickyGroupRenderer<TRowData>;
	private readonly invalidationCoordinator: RenderInvalidationCoordinator<TRowData>;
	private readonly headerMenu: HeaderMenuController<TRowData>;

	private readonly layoutTransition: LayoutTransitionController<TRowData>;
	private _pendingTransition = false;

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

	private renderStats = createRenderRuntimeStats();

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
			rowVersions: this.engine.rowVersions,
			globalVersion: 0,
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
		this.layoutTransition = new LayoutTransitionController(() => this.rowRenderer.activeRows);

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
			syncViewport: (_frame) => {
				const layoutPlan = this.viewportCoordinator.syncLayoutPlan();
				this.viewportCoordinator.recycleViewport(false, undefined, layoutPlan.renderWindow);
				this.stickyGroupRenderer.sync(layoutPlan);
			},
			syncHeaders: (frame) => this.headerRenderer.sync(frame),
			syncOverlay: (frame) => this.overlayRenderer.sync(frame),
			syncRows: (frame) => this.rowRenderer.repaintInvalidatedRowsAndCells(frame),
			syncCells: (frame) => this.rowRenderer.repaintInvalidatedRowsAndCells(frame),
			fullPaint: () => this.fullPaint(),
		});

		this.columnInteractions = new ColumnInteractionController<TRowData>({
			engine,
			getOverlayLayer: () => this.viewportRenderer.overlayLayer,
			getScrollViewport: () => this.viewportRenderer.scrollViewport,
			getLayoutPlan: () => this.viewportRenderer.getLayoutPlan(),
			schedulePaint: () => this.scheduleHeaderPaint('column interaction'),
		});
		this.fillDrag = new FillDragController<TRowData>({
			engine,
			getOverlayLayer: () => this.viewportRenderer.overlayLayer,
			getScrollViewport: () => this.viewportRenderer.scrollViewport,
			getOverlayBox: (minRow, maxRow, minCol, maxCol) => this.overlayRenderer.getClampedOverlayBox(minRow, maxRow, minCol, maxCol),
			scrollTo: (scrollTop, scrollLeft) => this.scrollEngine.scrollTo(scrollTop, scrollLeft),
			schedulePaint: () => this.scheduleOverlayPaint('fill drag'),
			getLayoutPlan: () => this.viewportRenderer.getLayoutPlan(),
		});

		// Group panel renderer — mounts when showGroupPanel is true
		this.groupPanelRenderer = new GroupPanelRenderer<TRowData>(engine);
		this.statusBarRenderer = new StatusBarRenderer<TRowData>(engine);
		this.paginationBarRenderer = new PaginationBarRenderer<TRowData>(engine);
		this.stickyGroupRenderer = new StickyGroupRenderer<TRowData>(engine, this.portalMountManager);
		const scrollState: RenderScrollCoordinatorState<TRowData> = {
			isScrolling: this.isScrolling,
			scrollEndRafId: this.scrollEndRafId,
			scrollEndQuietFrames: this.scrollEndQuietFrames,
			scrollEndTickerActive: this.scrollEndTickerActive,
			viewportDirtyAfterScroll: this.viewportDirtyAfterScroll,
			flushPendingAfterScroll: this.flushPendingAfterScroll,
			needsPostScrollPortalFlush: this.needsPostScrollPortalFlush,
			portalFlushScheduled: this.portalFlushScheduled,
			isScrollFrameActive: this.isScrollFrameActive,
			postScrollDecorationScheduled: this.postScrollDecorationScheduled,
			postScrollDecorationTimer: this.postScrollDecorationTimer,
			cachedMaxScrollLeft: this.cachedMaxScrollLeft,
			cachedTotalWidth: this.cachedTotalWidth,
			cachedTotalHeight: this.cachedTotalHeight,
			cachedDefaultRowHeight: this.cachedDefaultRowHeight,
			cachedHasSelectionOverlay: this.cachedHasSelectionOverlay,
			scrollCtx: this._scrollCtx,
			renderWindowBufs: this._renderWindowBufs,
			activeRenderWindowBufIdx: this._activeRenderWindowBufIdx,
			portalFlushBudget: this.portalFlushBudget,
			postScrollDecorationBudget: this.postScrollDecorationBudget,
		};
		this.scrollCoordinator = new RenderScrollCoordinator<TRowData>(
			{
				engine,
				viewportRenderer: this.viewportRenderer,
				rowRenderer: this.rowRenderer,
				headerRenderer: this.headerRenderer,
				overlayRenderer: this.overlayRenderer,
				stickyGroupRenderer: this.stickyGroupRenderer,
				portalMountManager: this.portalMountManager,
				scheduler: this.scheduler,
				requestScrollFrame: () => this.scrollScheduler.requestFrame(),
				layoutTransition: this.layoutTransition,
				renderStats: this.renderStats,
				recycleViewport: (isScrollFrameActive, ctx, precomputedWindow) =>
					this.viewportCoordinator.recycleViewport(isScrollFrameActive, ctx, precomputedWindow),
				syncLayoutPlan: (renderWindow) => this.viewportCoordinator.syncLayoutPlan(renderWindow),
			},
			scrollState
		);
		this.viewportCoordinator = new RenderViewportCoordinator<TRowData>({
			engine,
			viewportRenderer: this.viewportRenderer,
			rowRenderer: this.rowRenderer,
			scrollEngine: this.scrollEngine,
			renderStats: this.renderStats,
		});
		const paintState: RenderPaintCoordinatorState = {
			pendingTransition: this._pendingTransition,
			lastStyleSlots: this.lastStyleSlots,
			lastLoading: this.lastLoading,
		};
		this.paintCoordinator = new RenderPaintCoordinator<TRowData>(
			{
				engine,
				viewportRenderer: this.viewportRenderer,
				rowRenderer: this.rowRenderer,
				headerRenderer: this.headerRenderer,
				overlayRenderer: this.overlayRenderer,
				stickyGroupRenderer: this.stickyGroupRenderer,
				portalMountManager: this.portalMountManager,
				orchestrator: this.orchestrator,
				scrollCoordinator: this.scrollCoordinator,
				layoutTransition: this.layoutTransition,
				recycleViewport: (isScrollFrameActive, ctx, precomputedWindow) =>
					this.viewportCoordinator.recycleViewport(isScrollFrameActive, ctx, precomputedWindow),
				syncLayoutPlan: (renderWindow) => this.viewportCoordinator.syncLayoutPlan(renderWindow),
				updateCachedGeometryBoundsFromState: (defaultColWidth, defaultRowHeight) =>
					this.updateCachedGeometryBoundsFromState(defaultColWidth, defaultRowHeight),
			},
			paintState
		);
		this.invalidationCoordinator = new RenderInvalidationCoordinator<TRowData>({
			engine,
			geometryController: this.geometryController,
			portalMountManager: this.portalMountManager,
			layoutTransition: this.layoutTransition,
			scheduler: this.scheduler,
			syncLayoutPlan: () => {
				this.viewportCoordinator.syncLayoutPlan();
			},
			scrollCellIntoView: (rowId, colField) => this.viewportCoordinator.scrollCellIntoView(rowId, colField),
			updateCachedGeometryBounds: () => this.updateCachedGeometryBounds(),
			getIsScrolling: () => this.scrollCoordinator.getIsScrolling(),
			getIsScrollFrameActive: () => this.scrollCoordinator.getIsScrollFrameActive(),
			markFlushPendingAfterScroll: () => {
				this.scrollCoordinator.markFlushPendingAfterScroll();
			},
			markViewportDirtyAfterScroll: () => {
				this.scrollCoordinator.markViewportDirtyAfterScroll();
			},
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
		if (this.viewportRenderer.stickyGroupLayer) {
			this.stickyGroupRenderer.mount(this.viewportRenderer.stickyGroupLayer);
		}

		// Group panel: mount if showGroupPanel is already true at mount time
		if (this.viewportRenderer.groupPanel) {
			this.groupPanelRenderer.mount(this.viewportRenderer.groupPanel);
			this.viewportCoordinator.syncLayoutPlan();
			this.columnInteractions.setGroupPanel(this.groupPanelRenderer);
		}

		// Bottom chrome: status bar + pagination. The layers always exist (the registry
		// builds them); their `apply()` hides them with display:none until configured, so
		// mounting the content unconditionally is safe and lets config toggle at runtime.
		const statusBarLayer = this.viewportRenderer.getLayer('status-bar');
		if (statusBarLayer) this.statusBarRenderer.mount(statusBarLayer);
		const paginationLayer = this.viewportRenderer.getLayer('pagination');
		if (paginationLayer) this.paginationBarRenderer.mount(paginationLayer);

		this.overlayRenderer.mount();

		// Pre-warm DOM recycling pools
		const rect = container.getBoundingClientRect();
		const estRows = Math.ceil((rect.height || 500) / 40) + 15;
		this.rowRenderer.mount(estRows);

		// Set viewport dimensions in model
		this.engine.viewport.setViewportSize(rect.width || 800, rect.height || 500);

		this.invalidationCoordinator.bind();

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

		this.invalidationCoordinator.destroy();
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
		this.statusBarRenderer.unmount();
		this.paginationBarRenderer.unmount();
		this.stickyGroupRenderer.unmount();
		this.layoutTransition.destroy();
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
		this.scrollCoordinator.onScroll(scrollTop, scrollLeft, timestamp);
	};

	private markScrolling(): void {
		this.scrollCoordinator.markScrolling();
	}

	private scheduleScrollEnd(): void {
		this.scrollCoordinator.scheduleScrollEnd();
	}

	private finishScrolling(): void {
		this.scrollCoordinator.finishScrolling();
	}

	private clearScrollEndTimer(): void {
		this.scrollCoordinator.clearScrollEndTimer();
	}

	private flushPendingPortalReleasesAfterScroll(): void {
		this.scrollCoordinator.flushPendingPortalReleasesAfterScroll();
	}

	private scheduleBudgetedPortalFlush(): void {
		this.scrollCoordinator.scheduleBudgetedPortalFlush();
	}

	private clearPostScrollDecorationTimer(): void {
		this.scrollCoordinator.clearPostScrollDecorationTimer();
	}

	private scheduleBudgetedDecoration(): void {
		this.scrollCoordinator.scheduleBudgetedDecoration();
	}

	private restoreDeferredFocus(): void {
		this.scrollCoordinator.restoreDeferredFocus();
	}

	private flushScrollFrame(): void {
		this.scrollCoordinator.flushScrollFrame();
	}

	private syncCheapScrollOnly(layoutPlan: GridLayoutPlan): void {
		this.scrollCoordinator.syncCheapScrollOnly(layoutPlan);
	}

	private updateCachedGeometryBoundsFromState(defaultColWidth: number, defaultRowHeight: number): void {
		this.scrollCoordinator.updateCachedGeometryBoundsFromState(defaultColWidth, defaultRowHeight);
	}

	private updateCachedGeometryBounds(): void {
		const state = this.engine.stateManager.getState();
		this.scrollCoordinator.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);
	}

	public schedulePaint(): void {
		this.invalidationCoordinator.schedulePaint();
	}

	public scheduleFullPaint(reason = 'api'): void {
		this.invalidationCoordinator.scheduleFullPaint(reason);
	}

	public scheduleViewportPaint(reason = 'viewport'): void {
		this.invalidationCoordinator.scheduleViewportPaint(reason);
	}

	public scheduleHeaderPaint(reason = 'headers'): void {
		this.invalidationCoordinator.scheduleHeaderPaint(reason);
	}

	public scheduleOverlayPaint(reason = 'overlay'): void {
		this.invalidationCoordinator.scheduleOverlayPaint(reason);
	}

	public scheduleCellPaint(rowId: string, colId: string, reason = 'cell'): void {
		this.invalidationCoordinator.scheduleCellPaint(rowId, colId, reason);
	}

	public scheduleRowPaint(rowId: string, reason = 'row'): void {
		this.invalidationCoordinator.scheduleRowPaint(rowId, reason);
	}

	public scheduleColumnPaint(colId: string, reason = 'column'): void {
		this.invalidationCoordinator.scheduleColumnPaint(colId, reason);
	}

	public scheduleGeometryPaint(reason = 'geometry'): void {
		this.invalidationCoordinator.scheduleGeometryPaint(reason);
	}

	private flushPaint(): void {
		this.paintCoordinator.flushPaint();
	}

	public getRenderStats(): RenderStats {
		return collectRenderStats({
			engine: this.engine,
			orchestrator: this.orchestrator,
			portalMountManager: this.portalMountManager,
			rowRenderer: this.rowRenderer,
			runtimeStats: this.renderStats,
		});
	}

	public resetRenderStats(): void {
		resetRenderTelemetry(this.engine, this.orchestrator, this.portalMountManager, this.rowRenderer, this.renderStats);
	}

	public fullPaint(): void {
		this.paintCoordinator.fullPaint();
	}

	public scrollCellIntoView(rowId: string, colField: string): void {
		this.viewportCoordinator.scrollCellIntoView(rowId, colField);
	}

	private onRowMouseOver = (event: MouseEvent): void => {
		// During scroll the viewport is moving — hover state would flicker across every
		// row the pointer passes over and trigger className writes + style recalcs on each.
		// Suppress until scrolling stops; finishScrolling clears the hovered row anyway.
		if (this.scrollCoordinator.getIsScrolling()) return;

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

import { ScrollEngine } from './scrollEngine.js';
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
import { CellRenderer } from './cellRenderer.js';
import { HeaderRenderer } from './headerRenderer.js';
import { OverlayRenderer } from './overlayRenderer.js';
import { FullWidthRowRenderer } from './fullWidthRowRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { type ColumnDef, type GridApi, type InternalGridApi } from '../store.js';

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

	public readonly portalMountManager = new PortalMountManager<TRowData>();
	public readonly viewportRenderer: ViewportRenderer<TRowData>;
	public readonly rowRenderer: RowRenderer<TRowData>;
	public readonly cellRenderer: CellRenderer;
	private readonly headerRenderer: HeaderRenderer;
	private readonly overlayRenderer: OverlayRenderer;
	private readonly fullWidthRowRenderer: FullWidthRowRenderer;

	private selectionBorder: HTMLDivElement | null = null;
	private selectionDragBounds: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null = null;

	private headerCells = new Map<number, HTMLDivElement>();
	private unsubscribers: Array<() => void> = [];
	private activeHeaderPopover: HTMLDivElement | null = null;
	private activeHeaderPopoverElement: HTMLElement | null = null;

	private isScrolling = false;
	private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
	private overlayDirtyDuringScroll = false;
	private viewportDirtyAfterScroll = false;
	private needsPostScrollPortalFlush = false;
	private portalFlushScheduled = false;
	private isScrollFrameActive = false;
	private lastHeaderScrollLeft = 0;

	private lastStyleSlots: unknown = undefined;
	private lastSelection: unknown = undefined;
	private lastLoading: unknown = undefined;

	private readonly portalFlushBudget = 50;

	private renderStats = {
		scrollFrames: 0,
		viewportRecycles: 0,
		headerPaintsDuringScroll: 0,
		headerRangeSyncsDuringScroll: 0,
		overlayPaintsDuringScroll: 0,
		overlayCheapSyncsDuringScroll: 0,
		cellsPatchedPerScrollFrame: [] as number[],
		rowsRecycledPerScrollFrame: [] as number[],
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

		this.headerRenderer = new HeaderRenderer(
			() => this.paintHeaders(),
			() => undefined,
			() => this.syncVisibleHeaders()
		);
		this.overlayRenderer = new OverlayRenderer(
			() => this.paintOverlay(),
			() => {
				if (this.hasVisibleSelectionOverlay()) this.overlayDirtyDuringScroll = true;
			}
		);
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
			getOverlayBox: (minRow, maxRow, minCol, maxCol) => this.getClampedOverlayBox(minRow, maxRow, minCol, maxCol),
			scrollTo: (scrollTop, scrollLeft) => this.scrollEngine.scrollTo(scrollTop, scrollLeft),
			schedulePaint: () => this.scheduleOverlayPaint('fill drag'),
		});
	}

	/**
	 * Mount the rendering engine inside a host DOM container.
	 */
	public mount(container: HTMLElement): void {
		this.viewportRenderer.mount(container, this.onScroll);

		const scrollViewport = this.viewportRenderer.scrollViewport;
		if (scrollViewport) {
			scrollViewport.addEventListener('mouseover', this.onRowMouseOver);
			scrollViewport.addEventListener('mouseleave', this.onRowMouseLeave);
		}

		// Pre-warm DOM recycling pools
		const rect = container.getBoundingClientRect();
		const estRows = Math.ceil((rect.height || 500) / 40) + 15;
		this.rowRenderer.mount(estRows);

		// Set viewport dimensions in model
		this.engine.viewport.setViewportSize(rect.width || 800, rect.height || 500);

		this.bindInvalidationSources();

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
		this.portalMountManager.releaseAll();

		// Release all active rows and cells
		this.rowRenderer.unmount();
		this.clearHeaderCells();

		this.viewportRenderer.unmount();

		this.selectionBorder = null;
		this.selectionDragBounds = null;
	}

	/**
	 * Scroll hot path
	 */
	private onScroll = (scrollTop: number, scrollLeft: number): void => {
		const changed = this.engine.viewport.setScrollPosition(scrollTop, scrollLeft);
		if (!changed) return;
		this.markScrolling();
		this.scrollScheduler.requestFrame();
	};

	private markScrolling(): void {
		this.isScrolling = true;
		this.rowRenderer.isScrolling = true;
		this.portalMountManager.setScrolling(true);
		this.clearScrollEndTimer();
		this.scrollEndTimer = setTimeout(() => this.finishScrolling(), 80);
	}

	private finishScrolling(): void {
		this.clearScrollEndTimer();
		this.isScrolling = false;
		this.rowRenderer.isScrolling = false;
		this.portalMountManager.setScrolling(false);
		this.flushPendingPortalReleasesAfterScroll();
		this.needsPostScrollPortalFlush = this.needsPostScrollPortalFlush || this.portalMountManager.getDeferredCount() > 0;
		if (this.needsPostScrollPortalFlush) {
			this.scheduleBudgetedPortalFlush();
		}
		this.restoreDeferredFocus();
		if (this.viewportDirtyAfterScroll || this.rowRenderer.dirtyCellsAfterScroll.size > 0 || this.rowRenderer.dirtyRowsAfterScroll.size > 0) {
			this.viewportDirtyAfterScroll = false;
			this.rowRenderer.decorateDirtyCellsAfterScroll();
		}
		if (this.overlayDirtyDuringScroll) {
			this.overlayDirtyDuringScroll = false;
			this.paintOverlay();
		}
	}

	private clearScrollEndTimer(): void {
		if (this.scrollEndTimer) {
			clearTimeout(this.scrollEndTimer);
			this.scrollEndTimer = null;
		}
	}

	private flushPendingPortalReleasesAfterScroll(): void {
		if (this.rowRenderer.pendingPortalReleasesAfterScroll.length === 0) return;
		const pending = this.rowRenderer.pendingPortalReleasesAfterScroll;
		this.rowRenderer.pendingPortalReleasesAfterScroll = [];
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

	private restoreDeferredFocus(): void {
		const cell = this.rowRenderer.deferredFocusCell;
		this.rowRenderer.deferredFocusCell = null;
		if (!cell || !cell.isConnected) return;
		this.rowRenderer.applyFocus(cell);
	}

	private flushScrollFrame(): void {
		const scrollViewport = this.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;
		this.isScrollFrameActive = true;
		this.rowRenderer.isScrollFrameActive = true;
		this.rowRenderer.currentScrollCellsPatched = 0;
		this.rowRenderer.currentScrollRowsRecycled = 0;
		this.renderStats.scrollFrames++;
		try {
			this.viewportRenderer.syncViewportScrollFromDom();
			this.recycleViewport(true);
			if (this.engine.viewport.scrollLeft !== this.lastHeaderScrollLeft) {
				this.renderStats.headerRangeSyncsDuringScroll++;
				this.headerRenderer.syncVisibleColumnRange();
			}
			this.headerRenderer.syncScrollLeft(this.engine.viewport.scrollLeft);
			this.renderStats.overlayCheapSyncsDuringScroll++;
			this.overlayRenderer.syncScrollPosition();
		} finally {
			this.renderStats.cellsPatchedPerScrollFrame.push(this.rowRenderer.currentScrollCellsPatched);
			this.renderStats.rowsRecycledPerScrollFrame.push(this.rowRenderer.currentScrollRowsRecycled);
			this.isScrollFrameActive = false;
			this.rowRenderer.isScrollFrameActive = false;
		}
	}

	private bindInvalidationSources(): void {
		const invalidateFull = () => {
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
			this.scheduler.requestFlush('viewport');
		};
		const invalidateData = () => {
			this.engine.invalidation.invalidateViewport('data');
			this.scheduler.requestFlush('data');
		};
		const invalidateDefaultColumnGeometry = () => {
			this.geometryController.invalidateAll();
			this.engine.invalidation.invalidateGeometry('columns');
			this.engine.invalidation.invalidateViewport('columns');
			this.engine.invalidation.invalidateHeaders('columns');
			this.scheduler.requestFlush('columns');
		};
		const invalidateGeometryFull = () => {
			this.geometryController.invalidateAll();
			this.engine.invalidation.invalidateGeometry('geometry');
			this.engine.invalidation.invalidateViewport('geometry');
			this.scheduler.requestFlush('geometry');
		};

		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('defaultRowHeight', invalidateGeometryFull));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('defaultColWidth', invalidateDefaultColumnGeometry));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('dataVersion', invalidateData));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('loading', invalidateViewport));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('visibleRowRange', invalidateViewport));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('visibleColRange', invalidateViewport));

		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('columns', invalidateFull));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('columnWidths', invalidateGeometryFull));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('rowHeights', invalidateGeometryFull));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('enableColumnReorder', invalidateHeaders));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('selection', invalidateOverlay));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('activeEdit', invalidateOverlay));
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
		if (this.lastSelection !== state.selection) {
			this.lastSelection = state.selection;
			this.rowRenderer.selectionVersion++;
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
			focusCallsDuringScroll: 0,
			rootTextContentWritesOnPortalCells: 0,
			cellsBoundDuringScroll: this.rowRenderer.currentScrollCellsPatched,
			cellsDecoratedAfterScroll: 0,
			cellAccessReadsDuringScroll: 0,
			cellClassComputesDuringScroll: 0,
			dirtyCellsMarkedDuringScroll: this.rowRenderer.dirtyCellsMarkedDuringScroll,
			postScrollDirtyCellsDecorated: this.rowRenderer.postScrollDirtyCellsDecorated,
			reusableCellsSkippedDuringScroll: 0,
			styleHookCallsDuringScroll: 0,
			...portalScrollStats,
			hotDomReleases: (this.rowRenderer.rowPool?.hotReleases ?? 0) + (this.rowRenderer.cellPool?.hotReleases ?? 0),
			coldDomReleases: (this.rowRenderer.rowPool?.coldReleases ?? 0) + (this.rowRenderer.cellPool?.coldReleases ?? 0),
			cellsPatchedPerScrollFrame: this.renderStats.cellsPatchedPerScrollFrame.slice(),
			rowsRecycledPerScrollFrame: this.renderStats.rowsRecycledPerScrollFrame.slice(),
			portalMounts: this.portalMountManager.getStats(),
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
		this.renderStats.scrollFrames = 0;
		this.renderStats.viewportRecycles = 0;
		this.renderStats.headerPaintsDuringScroll = 0;
		this.renderStats.headerRangeSyncsDuringScroll = 0;
		this.renderStats.overlayPaintsDuringScroll = 0;
		this.renderStats.overlayCheapSyncsDuringScroll = 0;
		this.renderStats.cellsPatchedPerScrollFrame = [];
		this.renderStats.rowsRecycledPerScrollFrame = [];
	}

	public fullPaint(): void {
		this.portalMountManager.beginCellReleaseTransaction();
		try {
			this.fullPaintInternal();
		} finally {
			this.portalMountManager.endCellReleaseTransaction();
		}
	}

	private recycleViewport(isScrollFrameActive: boolean): void {
		this.renderStats.viewportRecycles++;
		this.rowRenderer.recycleViewport(isScrollFrameActive);
	}

	private fullPaintInternal(): void {
		this.viewportRenderer.syncViewportScrollFromDom();

		const state = this.engine.stateManager.getState();
		const colCount = this.engine.columns.getDisplayedColumnCount();

		this.viewportRenderer.syncSpacerAndLayers(state, colCount);
		this.recycleViewport(false);
		this.paintHeaders();
		this.paintOverlay();
	}

	private paintHeaders(): void {
		if (this.isScrolling) this.renderStats.headerPaintsDuringScroll++;
		this.syncVisibleHeaders();
	}

	private syncVisibleHeaders(): void {
		if (!this.viewportRenderer.headerLayer || !this.viewportRenderer.headerLeftLayer || !this.viewportRenderer.headerRightLayer) return;

		const state = this.engine.stateManager.getState();
		const columns = this.engine.columns.getDisplayedColumns();
		const colCount = columns.length;
		if (colCount === 0) {
			this.clearHeaderCells();
			this.lastHeaderScrollLeft = this.engine.viewport.scrollLeft;
			return;
		}

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const newColRange = this.engine.viewport.getVisibleColumnRange(colCount);
		const rendered = new Set<number>();

		const renderHeaderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;

			let headerCell = this.headerCells.get(c);
			if (!headerCell) {
				headerCell = this.createHeaderCellElement();
				this.headerCells.set(c, headerCell);
			}
			rendered.add(c);

			let className = 'og-header-cell';
			let cellLeft = this.engine.geometry.colLefts[c];
			const cellWidth = this.engine.geometry.colWidths[c];

			let targetLayer = this.viewportRenderer.headerLayer;

			if (c < pinLeftColumns) {
				className += ' og-header-cell-pinned-left';
				targetLayer = this.viewportRenderer.headerLeftLayer;
			} else if (c >= colCount - pinRightColumns) {
				className += ' og-header-cell-pinned-right';
				const firstRightPinColLeft = this.engine.geometry.colLefts[colCount - pinRightColumns];
				cellLeft = cellLeft - firstRightPinColLeft;
				targetLayer = this.viewportRenderer.headerRightLayer;
			}

			if (state.styleSlots?.headerCellClass) {
				try {
					const customHeaderClass = state.styleSlots.headerCellClass(col);
					if (customHeaderClass) {
						className += ' ' + customHeaderClass;
					}
				} catch (e) {
					console.error('RenderEngine: Error in headerCellClass styleSlot', e);
				}
			}
			if (state.enableColumnReorder && col.movable !== false) {
				className += ' og-header-cell-movable';
			}
			if (this.columnInteractions.isDraggingColumn(col.field)) {
				className += ' og-header-cell-dragging';
			}

			if (headerCell.className !== className) headerCell.className = className;
			const nextTransform = `translate3d(${cellLeft}px, 0, 0)`;
			if (headerCell.style.transform !== nextTransform) headerCell.style.transform = nextTransform;
			const nextWidth = `${cellWidth}px`;
			if (headerCell.style.width !== nextWidth) headerCell.style.width = nextWidth;

			const textSpan = headerCell.firstElementChild as HTMLSpanElement | null;
			if (textSpan && textSpan.textContent !== (col.header || col.field)) {
				textSpan.textContent = col.header || col.field;
			}

			const currentSort = state.sortModel?.find((s) => s.colId === col.field);
			const sortIndicator = headerCell.querySelector('.og-header-sort-indicator') as HTMLDivElement | null;
			if (sortIndicator) {
				if (currentSort) {
					sortIndicator.style.display = 'flex';
					sortIndicator.innerHTML =
						currentSort.sort === 'asc'
							? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`
							: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`;
				} else {
					sortIndicator.style.display = 'none';
					sortIndicator.innerHTML = '';
				}
			}

			if (headerCell.dataset.colField !== col.field) headerCell.dataset.colField = col.field;
			const colIndexText = String(c);
			if (headerCell.dataset.colIndex !== colIndexText) headerCell.dataset.colIndex = colIndexText;
			if (headerCell.parentNode !== targetLayer) {
				targetLayer!.appendChild(headerCell);
			}
		};

		for (let c = 0; c < pinLeftColumns; c++) {
			renderHeaderCell(c);
		}
		for (let c = newColRange.startIdx; c <= newColRange.endIdx; c++) {
			if (c >= pinLeftColumns && c < colCount - pinRightColumns) {
				renderHeaderCell(c);
			}
		}
		for (let c = colCount - pinRightColumns; c < colCount; c++) {
			if (c >= 0) {
				renderHeaderCell(c);
			}
		}

		for (const [colIdx, cell] of this.headerCells.entries()) {
			if (!rendered.has(colIdx) || colIdx >= colCount) {
				cell.remove();
				this.headerCells.delete(colIdx);
			}
		}
		this.lastHeaderScrollLeft = this.engine.viewport.scrollLeft;
	}

	private createHeaderCellElement(): HTMLDivElement {
		const headerCell = document.createElement('div');
		headerCell.addEventListener('mousedown', this.columnInteractions.onHeaderCellMouseDown);

		const textSpan = document.createElement('span');
		textSpan.style.overflow = 'hidden';
		textSpan.style.textOverflow = 'ellipsis';
		textSpan.style.whiteSpace = 'nowrap';
		textSpan.style.flex = '1';
		headerCell.appendChild(textSpan);

		const sortIndicator = document.createElement('div');
		sortIndicator.className = 'og-header-sort-indicator';
		headerCell.appendChild(sortIndicator);

		const menuButton = document.createElement('div');
		menuButton.className = 'og-header-menu-button';
		menuButton.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2.5"></circle><circle cx="12" cy="5" r="2.5"></circle><circle cx="12" cy="19" r="2.5"></circle></svg>`;
		menuButton.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});
		menuButton.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			const colField = headerCell.dataset.colField;
			if (colField) {
				this.showHeaderMenu(headerCell, colField);
			}
		});
		headerCell.appendChild(menuButton);

		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'og-header-resize-handle';
		resizeHandle.addEventListener('mousedown', this.columnInteractions.onHeaderResizeMouseDown);
		headerCell.appendChild(resizeHandle);

		return headerCell;
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

	private clearHeaderCells(): void {
		for (const cell of this.headerCells.values()) {
			cell.remove();
		}
		this.headerCells.clear();
	}

	private paintOverlay(): void {
		if (this.isScrolling) this.renderStats.overlayPaintsDuringScroll++;
		if (!this.viewportRenderer.overlayLayer) return;

		this.columnInteractions.reattachOverlays();

		const state = this.engine.stateManager.getState();
		const bounds = state.selection.bounds;

		if (!bounds || !this.engine.getRowModel()) {
			this.hideSelectionOverlay();
			return;
		}

		const rowModel = this.engine.getRowModel()!;
		const rowCount = rowModel.getVisualRowCount();
		const colCount = this.engine.columns.getDisplayedColumnCount();

		const minRow = Math.max(0, bounds.minRow);
		const maxRow = Math.min(rowCount - 1, bounds.maxRow);
		const minCol = Math.max(0, bounds.minCol);
		const maxCol = Math.min(colCount - 1, bounds.maxCol);

		if (minRow > maxRow || minCol > maxCol) {
			this.hideSelectionOverlay();
			return;
		}

		const box = this.getClampedOverlayBox(minRow, maxRow, minCol, maxCol);
		if (!box) {
			this.hideSelectionOverlay();
			return;
		}

		const selectionBorder = this.ensureSelectionBorder();
		this.selectionDragBounds = { minRow, maxRow, minCol, maxCol };

		selectionBorder.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
		selectionBorder.style.width = `${box.width}px`;
		selectionBorder.style.height = `${box.height}px`;
		selectionBorder.style.display = 'block';

		if (selectionBorder.parentNode !== this.viewportRenderer.overlayLayer) {
			this.viewportRenderer.overlayLayer.appendChild(selectionBorder);
		}

		this.fillDrag.reattachPreview();
	}

	private hasVisibleSelectionOverlay(): boolean {
		const state = this.engine.stateManager.getState();
		return !!state.selection.bounds && !!this.engine.getRowModel();
	}

	private getClampedOverlayBox(minRow: number, maxRow: number, minCol: number, maxCol: number): OverlayBox | null {
		const state = this.engine.stateManager.getState();
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const colCount = this.engine.columns.getDisplayedColumnCount();

		if (rowCount === 0 || colCount === 0 || minRow < 0 || minCol < 0 || maxRow >= rowCount || maxCol >= colCount) {
			return null;
		}

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

		const getClampedX = (c: number): { left: number; right: number } => {
			const cellLeft = this.engine.geometry.colLefts[c] || 0;
			const cellWidth = this.engine.geometry.colWidths[c] || 0;

			if (c < pinLeftColumns) {
				return { left: cellLeft, right: cellLeft + cellWidth };
			}
			if (c >= colCount - pinRightColumns) {
				const firstRightPinColIdx = colCount - pinRightColumns;
				const firstRightPinColLeft = this.engine.geometry.colLefts[firstRightPinColIdx] || 0;
				const left = viewportWidth - pinnedRightWidth + (cellLeft - firstRightPinColLeft);
				return { left, right: left + cellWidth };
			}

			const unclippedLeft = cellLeft - scrollLeft;
			const unclippedRight = unclippedLeft + cellWidth;
			const left = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedLeft));
			const right = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedRight));
			return { left, right };
		};

		const getClampedY = (r: number): { top: number; bottom: number } => {
			const rowTop = this.engine.geometry.rowTops[r] || 0;
			const rowHeight = this.engine.geometry.rowHeights[r] || 0;

			if (r < pinTopRows) {
				return { top: rowTop, bottom: rowTop + rowHeight };
			}
			if (r >= rowCount - pinBottomRows) {
				const totalHeight = this.engine.geometry.getTotalHeight(state.defaultRowHeight);
				const bottomOffset = totalHeight - rowTop;
				const top = viewportHeight - 40 - bottomOffset;
				return { top, bottom: top + rowHeight };
			}

			const unclippedTop = rowTop - scrollTop;
			const unclippedBottom = unclippedTop + rowHeight;
			const top = Math.max(pinnedTopHeight, Math.min(viewportHeight - 40 - pinnedBottomHeight, unclippedTop));
			const bottom = Math.max(pinnedTopHeight, Math.min(viewportHeight - 40 - pinnedBottomHeight, unclippedBottom));
			return { top, bottom };
		};

		const xRangeMin = getClampedX(minCol);
		const xRangeMax = getClampedX(maxCol);
		const yRangeMin = getClampedY(minRow);
		const yRangeMax = getClampedY(maxRow);
		const width = xRangeMax.right - xRangeMin.left;
		const height = yRangeMax.bottom - yRangeMin.top;

		if (width <= 0 || height <= 0) {
			return null;
		}

		return { left: xRangeMin.left, top: yRangeMin.top, width, height };
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
		pooledRow.leftElement?.classList.toggle('og-row-hovered', hovered);
		pooledRow.rightElement?.classList.toggle('og-row-hovered', hovered);
	}

	private ensureSelectionBorder(): HTMLDivElement {
		if (!this.selectionBorder) {
			this.selectionBorder = document.createElement('div');
			this.selectionBorder.className = 'og-selection-border';

			const fillHandle = document.createElement('div');
			fillHandle.className = 'og-selection-fill-handle';
			fillHandle.addEventListener('mousedown', this.onSelectionFillHandleMouseDown);
			this.selectionBorder.appendChild(fillHandle);
		}

		return this.selectionBorder;
	}

	private hideSelectionOverlay(): void {
		this.selectionDragBounds = null;
		if (this.selectionBorder) {
			this.selectionBorder.style.display = 'none';
		}
	}

	private onSelectionFillHandleMouseDown = (e: MouseEvent): void => {
		if (!this.selectionDragBounds) return;
		e.preventDefault();
		e.stopPropagation();
		const { minRow, maxRow, minCol, maxCol } = this.selectionDragBounds;
		this.fillDrag.start(e, minRow, maxRow, minCol, maxCol);
	};
}

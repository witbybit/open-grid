import { DOMPool, PooledRow } from './domPool.js';
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
import { type ColumnDef, type VisualRow, type GridApi, type InternalGridApi, type RowNode } from '../store.js';
import { CORE_STYLES } from './styles.js';

/**
 * Owns the grid DOM, row/cell recycling, and rAF paint batching.
 */
export class RenderEngine<TRowData = unknown> implements IGridRenderer<TRowData> {
	private engine: GridEngine<TRowData>;
	private rowPool!: DOMPool<HTMLDivElement>;
	private cellPool!: DOMPool<HTMLDivElement>;
	private scrollEngine: ScrollEngine<TRowData>;
	private columnInteractions: ColumnInteractionController<TRowData>;
	private fillDrag: FillDragController<TRowData>;
	private scheduler: RenderScheduler;
	private scrollScheduler: ScrollFrameScheduler;
	private orchestrator: RenderOrchestrator;
	private geometryController: GeometryController<TRowData>;
	public readonly portalMountManager = new PortalMountManager<TRowData>();
	private viewportRenderer: ViewportRenderer;
	private rowRenderer: RowRenderer;
	private cellRenderer: CellRenderer;
	private headerRenderer: HeaderRenderer;
	private overlayRenderer: OverlayRenderer;
	private fullWidthRowRenderer: FullWidthRowRenderer;

	// Viewport DOM elements
	private container: HTMLElement | null = null;
	private scrollViewport: HTMLDivElement | null = null;
	private scrollSpacer: HTMLDivElement | null = null;

	// Layer DOM elements
	private centerLayer: HTMLDivElement | null = null;
	private leftLayer: HTMLDivElement | null = null;
	private rightLayer: HTMLDivElement | null = null;
	private headerLayer: HTMLDivElement | null = null;
	private headerLeftLayer: HTMLDivElement | null = null;
	private headerRightLayer: HTMLDivElement | null = null;
	private overlayLayer: HTMLDivElement | null = null;
	private selectionBorder: HTMLDivElement | null = null;
	private styleTag: HTMLStyleElement | null = null;

	// Active tracking maps
	private activeRows = new Map<number, PooledRow>(); // rowIndex -> PooledRow
	private headerCells = new Map<number, HTMLDivElement>();
	private unsubscribers: Array<() => void> = [];
	private activeHeaderPopover: HTMLDivElement | null = null;
	private activeHeaderPopoverElement: HTMLElement | null = null;
	private hoveredRowIndex: number | null = null;
	private isScrolling = false;
	private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
	private overlayDirtyDuringScroll = false;
	private isScrollFrameActive = false;
	private currentScrollCellsPatched = 0;
	private currentScrollRowsRecycled = 0;
	private renderStats = {
		scrollFrames: 0,
		viewportRecycles: 0,
		headerPaintsDuringScroll: 0,
		overlayPaintsDuringScroll: 0,
		cellsPatchedPerScrollFrame: [] as number[],
		rowsRecycledPerScrollFrame: [] as number[],
	};

	private selectionDragBounds: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null = null;

	public readonly api?: InternalGridApi<TRowData>;

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
		this.viewportRenderer = new ViewportRenderer((frame) => {
			this.syncViewportScrollFromDom();
			this.recycleViewport();
			this.paintHeaders();
			this.paintOverlay();
			this.fullWidthRowRenderer.sync(frame);
		});
		this.rowRenderer = new RowRenderer((frame) => this.repaintInvalidatedRowsAndCells(frame));
		this.cellRenderer = new CellRenderer((frame) => this.repaintInvalidatedRowsAndCells(frame));
		this.headerRenderer = new HeaderRenderer(
			() => this.paintHeaders(),
			() => undefined
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
			syncViewport: (frame) => this.viewportRenderer.sync(frame),
			syncHeaders: (frame) => this.headerRenderer.sync(frame),
			syncOverlay: (frame) => this.overlayRenderer.sync(frame),
			syncRows: (frame) => this.rowRenderer.sync(frame),
			syncCells: (frame) => this.cellRenderer.sync(frame),
			fullPaint: () => this.fullPaintInternal(),
		});
		this.columnInteractions = new ColumnInteractionController<TRowData>({
			engine,
			getOverlayLayer: () => this.overlayLayer,
			getScrollViewport: () => this.scrollViewport,
			schedulePaint: () => this.scheduleHeaderPaint('column interaction'),
		});
		this.fillDrag = new FillDragController<TRowData>({
			engine,
			getOverlayLayer: () => this.overlayLayer,
			getScrollViewport: () => this.scrollViewport,
			getOverlayBox: (minRow, maxRow, minCol, maxCol) => this.getClampedOverlayBox(minRow, maxRow, minCol, maxCol),
			scrollTo: (scrollTop, scrollLeft) => this.scrollEngine.scrollTo(scrollTop, scrollLeft),
			schedulePaint: () => this.scheduleOverlayPaint('fill drag'),
		});
	}

	/**
	 * Mount the rendering engine inside a host DOM container.
	 */
	public mount(container: HTMLElement): void {
		this.container = container;

		// Inject stylesheet for structural containment and z-index layering
		this.injectStyles();

		// Create the viewport wrapper
		this.container.classList.add('og-grid-container');

		// Create scrollable container viewport
		this.scrollViewport = document.createElement('div');
		this.scrollViewport.className = 'og-scroll-viewport';

		// Create spacer representing virtual height/width
		this.scrollSpacer = document.createElement('div');
		this.scrollSpacer.className = 'og-scroll-spacer';

		// Create scrollable layers for center, pinned columns, and headers.
		this.centerLayer = document.createElement('div');
		this.centerLayer.className = 'og-layer-center';

		this.leftLayer = document.createElement('div');
		this.leftLayer.className = 'og-layer-left';

		this.rightLayer = document.createElement('div');
		this.rightLayer.className = 'og-layer-right';

		// Create horizontal-scrolling header layers
		this.headerLayer = document.createElement('div');
		this.headerLayer.className = 'og-layer-header';

		this.headerLeftLayer = document.createElement('div');
		this.headerLeftLayer.className = 'og-layer-header-left';

		this.headerRightLayer = document.createElement('div');
		this.headerRightLayer.className = 'og-layer-header-right';

		// Create visual overlay layer (selection & focus ring)
		this.overlayLayer = document.createElement('div');
		this.overlayLayer.className = 'og-layer-overlay';

		// Assemble DOM tree using CSS Grid overlap
		this.scrollViewport.appendChild(this.scrollSpacer);
		this.scrollViewport.appendChild(this.centerLayer);
		this.scrollViewport.appendChild(this.leftLayer);
		this.scrollViewport.appendChild(this.rightLayer);
		this.scrollViewport.appendChild(this.headerLayer);
		this.scrollViewport.appendChild(this.headerLeftLayer);
		this.scrollViewport.appendChild(this.headerRightLayer);
		this.container.appendChild(this.scrollViewport);
		this.container.appendChild(this.overlayLayer);

		// Bind scroll events to scroll engine
		this.scrollEngine.bind(this.scrollViewport, this.onScroll);
		this.scrollViewport.addEventListener('mouseover', this.onRowMouseOver);
		this.scrollViewport.addEventListener('mouseleave', this.onRowMouseLeave);

		// Pre-warm DOM recycling pools
		const rect = container.getBoundingClientRect();
		const estRows = Math.ceil((rect.height || 500) / 40) + 15;
		const estCols = Math.ceil((rect.width || 800) / 100) + 10;

		this.rowPool = new DOMPool(() => this.createRowElement(), estRows);
		this.cellPool = new DOMPool(() => this.createCellElement(), estRows * estCols);

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
		if (this.scrollViewport) {
			this.scrollViewport.removeEventListener('mouseover', this.onRowMouseOver);
			this.scrollViewport.removeEventListener('mouseleave', this.onRowMouseLeave);
		}
		this.columnInteractions.cleanup();
		this.fillDrag.cleanup();
		this.scheduler.destroy();
		this.scrollScheduler.destroy();
		this.clearScrollEndTimer();
		this.portalMountManager.releaseAll();

		// Release all active rows and cells
		this.clearActiveRows();
		this.clearHeaderCells();

		if (this.rowPool) this.rowPool.clear();
		if (this.cellPool) this.cellPool.clear();

		if (this.styleTag) {
			this.styleTag.remove();
			this.styleTag = null;
		}

		this.selectionBorder = null;
		this.selectionDragBounds = null;

		if (this.container) {
			this.container.classList.remove('og-grid-container');
			this.container.textContent = '';
			this.container = null;
		}
	}

	/**
	 * Scroll hot path:
	 * DOM scroll event -> ViewportModel scroll offsets -> direct rAF scheduler
	 * -> viewport-only row/cell recycle and positioning -> deferred portal cleanup
	 * after scroll idle. Headers, overlays, full paint, and sync portal flushes stay
	 * out of this frame unless another explicit invalidation path requests them.
	 */
	private onScroll = (scrollTop: number, scrollLeft: number): void => {
		this.engine.viewport.setScrollPosition(scrollTop, scrollLeft);
		this.markScrolling();
		this.scrollScheduler.requestFrame();
	};

	private markScrolling(): void {
		this.isScrolling = true;
		this.portalMountManager.setScrolling(true);
		this.clearScrollEndTimer();
		this.scrollEndTimer = setTimeout(() => this.finishScrolling(), 80);
	}

	private finishScrolling(): void {
		this.clearScrollEndTimer();
		this.isScrolling = false;
		this.portalMountManager.setScrolling(false);
		this.portalMountManager.flushDeferred(false);
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

	private flushScrollFrame(): void {
		if (!this.scrollViewport) return;
		this.isScrollFrameActive = true;
		this.currentScrollCellsPatched = 0;
		this.currentScrollRowsRecycled = 0;
		this.renderStats.scrollFrames++;
		try {
			this.syncViewportScrollFromDom();
			this.recycleViewport();
			this.headerRenderer.syncScrollLeft(this.engine.viewport.scrollLeft);
			this.overlayRenderer.syncPosition();
		} finally {
			this.renderStats.cellsPatchedPerScrollFrame.push(this.currentScrollCellsPatched);
			this.renderStats.rowsRecycledPerScrollFrame.push(this.currentScrollRowsRecycled);
			this.isScrollFrameActive = false;
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
			this.engine.eventBus.addEventListener<{ rowId: string; colField: string }>('cellInvalidated', (event) => {
				this.engine.invalidation.invalidateCell(event.payload.rowId, event.payload.colField, 'cell');
				this.engine.invalidation.invalidateRow(event.payload.rowId, 'cell');
				this.scheduler.requestFlush('cell');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener<{ colField: string }>('columnResized', (event) => {
				this.geometryController.invalidateColumns([event.payload.colField]);
				this.engine.invalidation.invalidateGeometry('column resize');
				this.engine.invalidation.invalidateColumn(event.payload.colField, 'column resize');
				this.engine.invalidation.invalidateHeaders('column resize');
				this.scheduler.requestFlush('column resize');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener<{ rowId: string }>('rowResized', (event) => {
				this.geometryController.invalidateRows([event.payload.rowId]);
				this.engine.invalidation.invalidateGeometry('row resize');
				this.engine.invalidation.invalidateRow(event.payload.rowId, 'row resize');
				this.scheduler.requestFlush('row resize');
			})
		);
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener<{ reason: string }>('renderInvalidated', (event) => {
				this.scheduler.requestFlush(event.payload.reason);
			})
		);
	}

	/**
	 * Schedules a paint task in the next animation frame, preventing synchronous re-entrancy.
	 */
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
		this.portalMountManager.beginCellReleaseTransaction();
		try {
			this.orchestrator.flush(this.engine.invalidation.consume());
		} finally {
			this.portalMountManager.endCellReleaseTransaction();
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
			overlayPaintsDuringScroll: this.renderStats.overlayPaintsDuringScroll,
			...portalScrollStats,
			hotDomReleases: (this.rowPool?.hotReleases ?? 0) + (this.cellPool?.hotReleases ?? 0),
			coldDomReleases: (this.rowPool?.coldReleases ?? 0) + (this.cellPool?.coldReleases ?? 0),
			cellsPatchedPerScrollFrame: this.renderStats.cellsPatchedPerScrollFrame.slice(),
			rowsRecycledPerScrollFrame: this.renderStats.rowsRecycledPerScrollFrame.slice(),
			portalMounts: this.portalMountManager.getStats(),
		};
	}

	public resetRenderStats(): void {
		this.orchestrator.resetStats();
		this.portalMountManager.resetStats();
		this.rowPool?.resetStats();
		this.cellPool?.resetStats();
		this.renderStats.scrollFrames = 0;
		this.renderStats.viewportRecycles = 0;
		this.renderStats.headerPaintsDuringScroll = 0;
		this.renderStats.overlayPaintsDuringScroll = 0;
		this.renderStats.cellsPatchedPerScrollFrame = [];
		this.renderStats.rowsRecycledPerScrollFrame = [];
	}

	/**
	 * Completely rebuilds grid structures, spacers, and forces recycling refresh.
	 */
	public fullPaint(): void {
		this.portalMountManager.beginCellReleaseTransaction();
		try {
			this.fullPaintInternal();
		} finally {
			this.portalMountManager.endCellReleaseTransaction();
		}
	}

	private fullPaintInternal(): void {
		this.syncViewportScrollFromDom();

		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const state = this.engine.stateManager.getState();
		const colCount = state.columns.length;

		// 1. Sync spacer height/width matching total virtual content boundaries
		const totalHeight = this.engine.geometry.getTotalHeight(state.defaultRowHeight);
		const totalWidth = this.engine.geometry.getTotalWidth(state.defaultColWidth);

		if (this.scrollSpacer) {
			this.scrollSpacer.style.height = `${totalHeight}px`;
			this.scrollSpacer.style.width = `${totalWidth}px`;
		}

		if (this.centerLayer) {
			const viewportWidth = this.engine.viewport.viewportWidth;
			const targetWidth = `${Math.max(totalWidth, viewportWidth)}px`;

			this.centerLayer.style.width = targetWidth;
			this.centerLayer.style.height = `${totalHeight}px`;

			if (this.headerLayer) this.headerLayer.style.width = targetWidth;

			const pinLeftWidth =
				this.engine.viewport.pinLeftColumns > 0 ? this.engine.geometry.colLefts[this.engine.viewport.pinLeftColumns] || 0 : 0;
			if (this.leftLayer) this.leftLayer.style.width = `${pinLeftWidth}px`;
			if (this.headerLeftLayer) this.headerLeftLayer.style.width = `${pinLeftWidth}px`;

			const firstRightPinColIdx = colCount - this.engine.viewport.pinRightColumns;
			const pinRightWidth =
				this.engine.viewport.pinRightColumns > 0 ? totalWidth - (this.engine.geometry.colLefts[firstRightPinColIdx] || totalWidth) : 0;
			if (this.rightLayer) this.rightLayer.style.width = `${pinRightWidth}px`;
			if (this.headerRightLayer) this.headerRightLayer.style.width = `${pinRightWidth}px`;
		}

		// 2. Recycle viewport
		this.recycleViewport();

		// 3. Draw headers
		this.paintHeaders();

		// 4. Draw selection overlay and focus indicators
		this.paintOverlay();
	}

	private syncViewportScrollFromDom(): void {
		if (!this.scrollViewport) return;

		this.engine.viewport.setScrollPosition(this.scrollViewport.scrollTop, this.scrollViewport.scrollLeft);
	}

	/**
	 * Perform row & cell level recycling, reusing DOM elements out of screen.
	 */
	private recycleViewport(): void {
		this.renderStats.viewportRecycles++;
		const rowModel = this.engine.getRowModel();
		let rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const state = this.engine.stateManager.getState();
		if (state.loading && rowCount === 0) {
			rowCount = state.loadingSkeletonCount ?? 15;
		}
		const colCount = state.columns.length;

		if (rowCount === 0 || colCount === 0) {
			this.clearActiveRows();
			return;
		}

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;
		const scrollTop = this.engine.viewport.scrollTop;
		const viewportHeight = this.engine.viewport.viewportHeight;

		// Calculate current visible row and column indexes using viewport models
		const newRowRange = this.engine.viewport.getVisibleRowRange(rowCount);
		const newColRange = this.engine.viewport.getVisibleColumnRange(colCount);

		// If server row model is registered, trigger loading visible blocks
		if (rowModel && typeof rowModel.loadVisibleBlocks === 'function') {
			rowModel.loadVisibleBlocks(newRowRange.startIdx, newRowRange.endIdx);
		}

		const startRow = newRowRange.startIdx;
		const endRow = newRowRange.endIdx;

		// Phase 1: Releasing scrolled-out rows back to the recycling pool
		for (const [rowIndex, pooledRow] of this.activeRows.entries()) {
			const isPinnedTop = rowIndex < pinTopRows && rowIndex < rowCount;
			const isPinnedBottom = rowIndex >= rowCount - pinBottomRows && rowIndex < rowCount;
			const isScrollable = rowIndex >= startRow && rowIndex <= endRow;

			if (!isPinnedTop && !isPinnedBottom && !isScrollable) {
				this.releaseRow(rowIndex, pooledRow);
				if (this.isScrollFrameActive) this.currentScrollRowsRecycled++;
			}
		}

		// Phase 2: Render/Reposition rows in current range
		const columns = state.columns;

		const renderRow = (r: number) => {
			let visualRow = rowModel ? rowModel.getVisualRow(r) : null;
			if (!visualRow && state.loading) {
				visualRow = {
					kind: 'loading',
					id: `loading:${r}`,
					rowIndex: r,
				};
			}
			if (!visualRow) return;

			let pooledRow = this.activeRows.get(r);

			if (!pooledRow) {
				// Acquire unused row divs from the pool
				const rowEl = this.rowPool.acquire();
				const leftEl = this.rowPool.acquire();
				const rightEl = this.rowPool.acquire();

				pooledRow = {
					element: rowEl,
					leftElement: leftEl,
					rightElement: rightEl,
					cells: new Map(),
					boundRowId: visualRow.id,
				};
				this.activeRows.set(r, pooledRow);
				if (this.isScrollFrameActive) this.currentScrollRowsRecycled++;

				// Append row divs to center layer
				if (this.centerLayer) this.centerLayer.appendChild(rowEl);
				if (this.leftLayer) this.leftLayer.appendChild(leftEl);
				if (this.rightLayer) this.rightLayer.appendChild(rightEl);
			} else if (pooledRow.boundRowId !== visualRow.id) {
				if (pooledRow.element.dataset.rowKey) {
					this.portalMountManager.releaseRow({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
					delete pooledRow.element.dataset.rowKey;
				}
				this.releaseAllCellsInRow(pooledRow);
				pooledRow.boundRowId = visualRow.id;
			}

			// Reposition row using transforms to avoid layout-bound top/left updates.
			let rowTop = this.engine.geometry.rowTops[r];
			const rowHeight = this.engine.geometry.rowHeights[r];

			if (r < pinTopRows) {
				rowTop = rowTop + scrollTop;
			} else if (r >= rowCount - pinBottomRows) {
				const totalHeight = this.engine.geometry.getTotalHeight(state.defaultRowHeight);
				const bottomOffset = totalHeight - this.engine.geometry.rowTops[r];
				rowTop = scrollTop + viewportHeight - bottomOffset;
			}

			pooledRow.element.style.transform = `translate3d(0, ${rowTop}px, 0)`;
			pooledRow.element.style.height = `${rowHeight}px`;
			pooledRow.element.dataset.rowIndex = String(r);
			pooledRow.element.dataset.rowId = visualRow.id;

			if (pooledRow.leftElement) {
				pooledRow.leftElement.style.transform = `translate3d(0, ${rowTop}px, 0)`;
				pooledRow.leftElement.style.height = `${rowHeight}px`;
				pooledRow.leftElement.dataset.rowIndex = String(r);
				pooledRow.leftElement.dataset.rowId = visualRow.id;
			}
			if (pooledRow.rightElement) {
				pooledRow.rightElement.style.transform = `translate3d(0, ${rowTop}px, 0)`;
				pooledRow.rightElement.style.height = `${rowHeight}px`;
				pooledRow.rightElement.dataset.rowIndex = String(r);
				pooledRow.rightElement.dataset.rowId = visualRow.id;
			}

			if (visualRow.kind === 'loading') {
				if (pooledRow.element.dataset.rowKey) {
					this.portalMountManager.releaseRow({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
					delete pooledRow.element.dataset.rowKey;
					pooledRow.element.textContent = '';
				}
				this.updateVisualRowClassName(pooledRow, visualRow, r, state);
				this.recycleLoadingRowCells(pooledRow, visualRow, r, newColRange.startIdx, newColRange.endIdx, columns);
				return;
			}

			if (visualRow.kind !== 'data') {
				this.updateVisualRowClassName(pooledRow, visualRow, r, state);
				this.releaseAllCellsInRow(pooledRow);
				const rowKey = visualRow.id;
				if (pooledRow.element.dataset.rowKey !== rowKey) {
					if (pooledRow.element.dataset.rowKey) {
						this.portalMountManager.releaseRow({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
					}
					pooledRow.element.textContent = '';
					pooledRow.element.dataset.rowKey = rowKey;
				}
				this.portalMountManager.mountRow({
					rowKey,
					container: pooledRow.element,
					visualRow,
				});
				return;
			}

			const node = visualRow.node;
			if (pooledRow.element.dataset.rowKey) {
				this.portalMountManager.releaseRow({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
				delete pooledRow.element.dataset.rowKey;
				pooledRow.element.textContent = '';
			}
			this.updateRowClassName(pooledRow, node, r, state);

			// Recycle individual cells inside this row
			this.recycleRowCells(pooledRow, node, r, newColRange.startIdx, newColRange.endIdx, columns);
		};

		// 1. Render pinned top rows
		for (let r = 0; r < pinTopRows; r++) {
			renderRow(r);
		}

		// 2. Render scrollable rows
		for (let r = startRow; r <= endRow; r++) {
			if (r >= pinTopRows && r < rowCount - pinBottomRows) {
				renderRow(r);
			}
		}

		// 3. Render pinned bottom rows
		for (let r = rowCount - pinBottomRows; r < rowCount; r++) {
			if (r >= 0) {
				renderRow(r);
			}
		}
	}

	private repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return;

		const state = this.engine.stateManager.getState();
		const columns = state.columns;

		for (const rowId of frame.rows) {
			const rowIndex = rowModel.getVisualIndexByRowId(rowId);
			const pooledRow = rowIndex >= 0 ? this.activeRows.get(rowIndex) : undefined;
			const row = rowIndex >= 0 ? rowModel.getVisualRow(rowIndex) : null;
			if (pooledRow && row?.kind === 'data') {
				this.updateRowClassName(pooledRow, row.node, rowIndex, state);
			}
		}

		for (const key of frame.cells) {
			const { rowId, colField } = this.parseCellKey(key);
			const rowIndex = rowModel.getVisualIndexByRowId(rowId);
			const colIndex = this.engine.columns.getColumnIndex(colField);
			if (rowIndex < 0 || colIndex < 0) continue;

			const pooledRow = this.activeRows.get(rowIndex);
			const row = rowModel.getVisualRow(rowIndex);
			if (!pooledRow || row?.kind !== 'data' || !pooledRow.cells.has(colIndex)) continue;

			this.recycleRowCells(pooledRow, row.node, rowIndex, colIndex, colIndex, columns, false);
		}

		for (const colField of frame.columns) {
			const colIndex = this.engine.columns.getColumnIndex(colField);
			if (colIndex < 0) continue;
			for (const [rowIndex, pooledRow] of this.activeRows) {
				const row = rowModel.getVisualRow(rowIndex);
				if (row?.kind === 'data' && pooledRow.cells.has(colIndex)) {
					this.recycleRowCells(pooledRow, row.node, rowIndex, colIndex, colIndex, columns, false);
				}
			}
		}
	}

	private parseCellKey(key: string): { rowId: string; colField: string } {
		const colonIdx = key.indexOf(':');
		return colonIdx === -1 ? { rowId: key, colField: '' } : { rowId: key.substring(0, colonIdx), colField: key.substring(colonIdx + 1) };
	}

	private updateRowClassName(pooledRow: PooledRow, node: RowNode<TRowData>, rowIndex: number, state = this.engine.stateManager.getState()): void {
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;

		const isFocusedRow = state.selection.focus?.rowId === node.id;
		const isSelectedRow = !!state.selection.bounds && rowIndex >= state.selection.bounds.minRow && rowIndex <= state.selection.bounds.maxRow;
		const isLoadingRow = this.engine.data.isRowLoading(node.id);
		let rowClassName = 'og-row';
		if (rowIndex < pinTopRows) {
			rowClassName += ' og-row-pinned-top';
		} else if (rowIndex >= rowCount - pinBottomRows) {
			rowClassName += ' og-row-pinned-bottom';
		}
		if (this.hoveredRowIndex === rowIndex) {
			rowClassName += ' og-row-hovered';
		}
		if (isSelectedRow || isFocusedRow) {
			rowClassName += ' og-row-selected';
		}
		if (isFocusedRow) {
			rowClassName += ' og-row-focused';
		}
		if (isLoadingRow) {
			rowClassName += ' og-row-loading';
		}
		if (state.styleSlots?.rowClass && node.data) {
			try {
				const customRowClass = state.styleSlots.rowClass(node.data, {
					row: node.data,
					rowId: node.id,
					rowIndex,
					isFocused: isFocusedRow,
					isSelected: isSelectedRow || isFocusedRow,
					isLoading: isLoadingRow,
					selection: state.selection,
				});
				if (customRowClass) {
					rowClassName += ' ' + customRowClass;
				}
			} catch (e) {
				console.error('RenderEngine: Error in rowClass styleSlot', e);
			}
		}
		pooledRow.element.className = rowClassName;
		if (pooledRow.leftElement) pooledRow.leftElement.className = rowClassName;
		if (pooledRow.rightElement) pooledRow.rightElement.className = rowClassName;
	}

	private updateVisualRowClassName(
		pooledRow: PooledRow,
		visualRow: Exclude<VisualRow<TRowData>, { kind: 'data' }>,
		rowIndex: number,
		state = this.engine.stateManager.getState()
	): void {
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;

		let rowClassName = `og-row og-row-${visualRow.kind}`;
		if (rowIndex < pinTopRows) {
			rowClassName += ' og-row-pinned-top';
		} else if (rowIndex >= rowCount - pinBottomRows) {
			rowClassName += ' og-row-pinned-bottom';
		}
		if (this.hoveredRowIndex === rowIndex) {
			rowClassName += ' og-row-hovered';
		}
		if (state.selection.focus?.rowId === visualRow.id) {
			rowClassName += ' og-row-focused';
		}

		if (visualRow.kind === 'group' && state.styleSlots?.groupRowClass) {
			try {
				const customClass = state.styleSlots.groupRowClass(visualRow);
				if (customClass) {
					rowClassName += ' ' + customClass;
				}
			} catch (e) {
				console.error('RenderEngine: Error in groupRowClass styleSlot', e);
			}
		} else if (visualRow.kind === 'detail' && state.styleSlots?.detailRowClass) {
			try {
				const customClass = state.styleSlots.detailRowClass(visualRow);
				if (customClass) {
					rowClassName += ' ' + customClass;
				}
			} catch (e) {
				console.error('RenderEngine: Error in detailRowClass styleSlot', e);
			}
		}

		pooledRow.element.className = rowClassName;
		if (pooledRow.leftElement) pooledRow.leftElement.className = rowClassName;
		if (pooledRow.rightElement) pooledRow.rightElement.className = rowClassName;
	}

	/**
	 * Recycles cells horizontally inside an active row.
	 */
	private recycleRowCells(
		pooledRow: PooledRow,
		node: RowNode<TRowData>,
		rowIndex: number,
		startCol: number,
		endCol: number,
		columns: ColumnDef<TRowData>[],
		releaseOutOfRange = true
	): void {
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const colCount = columns.length;

		// 1. Release cells out-of-column bounds
		if (releaseOutOfRange) {
			const colsToRelease: number[] = [];
			for (const [c, cell] of pooledRow.cells.entries()) {
				if (cell) {
					if (c >= colCount) {
						colsToRelease.push(c);
						continue;
					}

					const isPinnedLeft = c < pinLeftColumns;
					const isPinnedRight = c >= colCount - pinRightColumns;
					const isScrollable = c >= startCol && c <= endCol;

					if (!isPinnedLeft && !isPinnedRight && !isScrollable) {
						colsToRelease.push(c);
					}
				}
			}
			this.releaseCellsInColumns(pooledRow, colsToRelease);
		}

		// 2. Bind cells in visible range
		const renderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;

			let cell = pooledRow.cells.get(c);

			if (!cell) {
				cell = this.cellPool.acquire();
				pooledRow.cells.set(c, cell);
			}

			let cellLeft = this.engine.geometry.colLefts[c];
			const cellWidth = this.engine.geometry.colWidths[c];

			let targetRowEl = pooledRow.element;

			if (c < pinLeftColumns) {
				targetRowEl = pooledRow.leftElement!;
			} else if (c >= colCount - pinRightColumns) {
				const firstRightPinColLeft = this.engine.geometry.colLefts[colCount - pinRightColumns];
				cellLeft = cellLeft - firstRightPinColLeft;
				targetRowEl = pooledRow.rightElement!;
			} else {
				// Normal cells do not need scrollLeft subtracted anymore due to CSS grid
			}

			if (cell.parentNode !== targetRowEl) {
				targetRowEl.appendChild(cell);
			}

			cell.style.transform = `translate3d(${cellLeft}px, 0, 0)`;
			cell.style.width = `${cellWidth}px`;
			cell.dataset.colField = col.field;
			cell.dataset.rowIndex = String(rowIndex);

			const state = this.engine.stateManager.getState();
			const access = this.engine.cellAccess.get(node.id, rowIndex, node, node.data, c, col);

			// Handle classes including pinning, focus, and loading
			let cellClassName = 'og-cell';
			if (c < pinLeftColumns) {
				cellClassName += ' og-cell-pinned-left';
			} else if (c >= colCount - pinRightColumns) {
				cellClassName += ' og-cell-pinned-right';
			}
			if (access.isFocused) {
				cellClassName += ' og-cell-focused';
				cell.tabIndex = -1;
				const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
				if (
					activeEl &&
					(activeEl === document.body ||
						(this.container &&
							this.container.contains(activeEl) &&
							activeEl !== cell &&
							!cell.contains(activeEl) &&
							!this.isEditorInteractiveElement(activeEl)))
				) {
					cell.focus();
				}
			} else {
				cell.removeAttribute('tabindex');
			}
			if (access.isSelected) {
				cellClassName += ' og-cell-selected';
			}
			if (access.isLoading) {
				cellClassName += ' og-cell-loading';
			}
			if (state.styleSlots?.cellClass && node.data) {
				try {
					const customCellClass = state.styleSlots.cellClass(col, node.data, {
						row: node.data,
						rowId: node.id,
						rowIndex,
						col,
						colField: col.field,
						colIndex: c,
						isFocused: access.isFocused,
						isRowFocused: access.isRowFocused,
						isRowSelected: access.isRowSelected || access.isRowFocused,
						isSelected: access.isSelected,
						isEditing: access.isEditing,
						value: access.value,
						rawValue: access.rawValue,
						isLoading: access.isLoading,
						selection: state.selection,
					});
					if (customCellClass) {
						cellClassName += ' ' + customCellClass;
					}
				} catch (e) {
					console.error('RenderEngine: Error in cellClass styleSlot', e);
				}
			}
			cell.className = cellClassName;
			if (state.styleSlots?.beforeCellRender) {
				try {
					state.styleSlots.beforeCellRender(access, cell);
				} catch (e) {
					console.error('RenderEngine: Error in beforeCellRender styleSlot', e);
				}
			}

			// Bind value
			const cellValue = access.value;
			const cellKey = createCellKey(node.id, col.field);

			// Custom renderer hook trigger or fast direct text bind (bypassed if loading to paint native skeletons synchronously or scrolling extremely fast)
			const isFastScrolling = this.engine.viewport.isScrollingFast || this.isScrollFrameActive;
			if (isFastScrolling && cell.dataset.cellKey === cellKey) {
				// Keep existing portal content mounted while the user is moving quickly.
				// Churning portals during scroll costs more than temporarily stale custom content.
			} else if ((col.cellRenderer || access.isEditing) && !access.isLoading && isFastScrolling) {
				const nextValText = cellValue != null ? String(cellValue) : '';
				if (cell.textContent !== nextValText) {
					cell.textContent = nextValText;
				}
			} else if ((col.cellRenderer || access.isEditing) && !access.isLoading) {
				if (cell.dataset.cellKey !== cellKey) {
					if (cell.dataset.cellKey) {
						this.releaseCellPortal(cell);
						this.portalMountManager.flushCellReleaseTransaction(!this.isScrollFrameActive);
					}
					// Set content empty so custom React portal doesn't clash with stale text
					cell.textContent = '';
					cell.dataset.cellKey = cellKey;
				}
				const portalHost = this.ensureCellPortalHost(cell);
				this.portalMountManager.mountCell({
					cellKey,
					container: portalHost,
					value: cellValue,
					node,
					col,
					isEditing: access.isEditing,
					isLoading: access.isLoading,
				});
			} else {
				if (cell.dataset.cellKey) {
					this.releaseCellPortal(cell);
					delete cell.dataset.cellKey;
				}
				if (access.isLoading) {
					if (!cell.querySelector('.og-cell-loading-skeleton')) {
						cell.textContent = '';
						const skeleton = document.createElement('div');
						skeleton.className = 'og-cell-loading-skeleton';
						cell.appendChild(skeleton);
					}
				} else {
					// Clean up skeleton if transitioning from loading to loaded state
					const skeletonEl = cell.querySelector('.og-cell-loading-skeleton');
					if (skeletonEl) {
						skeletonEl.remove();
					}
					// Fast path text mutation
					const nextValText = cellValue != null ? String(cellValue) : '';
					if (cell.textContent !== nextValText) {
						cell.textContent = nextValText;
					}
				}
			}
			if (state.styleSlots?.afterCellRender) {
				try {
					state.styleSlots.afterCellRender(access, cell);
				} catch (e) {
					console.error('RenderEngine: Error in afterCellRender styleSlot', e);
				}
			}
			if (this.isScrollFrameActive) this.currentScrollCellsPatched++;
		};

		// 3. Render left pinned cells
		for (let c = 0; c < pinLeftColumns; c++) {
			renderCell(c);
		}

		// 4. Render scrollable cells
		for (let c = startCol; c <= endCol; c++) {
			if (c >= pinLeftColumns && c < colCount - pinRightColumns) {
				renderCell(c);
			}
		}

		// 5. Render right pinned cells
		for (let c = colCount - pinRightColumns; c < colCount; c++) {
			if (c >= 0) {
				renderCell(c);
			}
		}
	}

	private recycleLoadingRowCells(
		pooledRow: PooledRow,
		_visualRow: Extract<VisualRow<TRowData>, { kind: 'loading' }>,
		rowIndex: number,
		startCol: number,
		endCol: number,
		columns: ColumnDef<TRowData>[],
		releaseOutOfRange = true
	): void {
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const colCount = columns.length;

		if (releaseOutOfRange) {
			const colsToRelease: number[] = [];
			for (const [c] of pooledRow.cells.entries()) {
				if (c >= colCount) {
					colsToRelease.push(c);
					continue;
				}

				const isPinnedLeft = c < pinLeftColumns;
				const isPinnedRight = c >= colCount - pinRightColumns;
				const isScrollable = c >= startCol && c <= endCol;
				if (!isPinnedLeft && !isPinnedRight && !isScrollable) {
					colsToRelease.push(c);
				}
			}
			this.releaseCellsInColumns(pooledRow, colsToRelease);
		}

		const renderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;

			let cell = pooledRow.cells.get(c);
			if (!cell) {
				cell = this.cellPool.acquire();
				pooledRow.cells.set(c, cell);
			}

			let cellLeft = this.engine.geometry.colLefts[c];
			const cellWidth = this.engine.geometry.colWidths[c];
			let targetRowEl = pooledRow.element;

			if (c < pinLeftColumns) {
				targetRowEl = pooledRow.leftElement!;
			} else if (c >= colCount - pinRightColumns) {
				const firstRightPinColLeft = this.engine.geometry.colLefts[colCount - pinRightColumns];
				cellLeft = cellLeft - firstRightPinColLeft;
				targetRowEl = pooledRow.rightElement!;
			}

			if (cell.parentNode !== targetRowEl) {
				targetRowEl.appendChild(cell);
			}

			if (cell.dataset.cellKey) {
				this.releaseCellPortal(cell);
				delete cell.dataset.cellKey;
			}

			cell.style.transform = `translate3d(${cellLeft}px, 0, 0)`;
			cell.style.width = `${cellWidth}px`;
			cell.dataset.colField = col.field;
			cell.dataset.rowIndex = String(rowIndex);
			cell.className = 'og-cell og-cell-loading';
			if (!cell.querySelector('.og-cell-loading-skeleton')) {
				cell.textContent = '';
				const skeleton = document.createElement('div');
				skeleton.className = 'og-cell-loading-skeleton';
				cell.appendChild(skeleton);
			}
			if (this.isScrollFrameActive) this.currentScrollCellsPatched++;
		};

		for (let c = 0; c < pinLeftColumns; c++) {
			renderCell(c);
		}
		for (let c = startCol; c <= endCol; c++) {
			if (c >= pinLeftColumns && c < colCount - pinRightColumns) {
				renderCell(c);
			}
		}
		for (let c = colCount - pinRightColumns; c < colCount; c++) {
			if (c >= 0) {
				renderCell(c);
			}
		}
	}

	private getCellPortalHost(cell: HTMLDivElement): HTMLDivElement | null {
		for (let i = 0; i < cell.children.length; i++) {
			const child = cell.children[i];
			if (child instanceof HTMLDivElement && child.classList.contains('og-cell-portal-host')) {
				return child;
			}
		}
		return null;
	}

	private ensureCellPortalHost(cell: HTMLDivElement): HTMLDivElement {
		let portalHost = this.getCellPortalHost(cell);
		if (!portalHost) {
			cell.textContent = '';
			portalHost = document.createElement('div');
			portalHost.className = 'og-cell-portal-host';
			cell.appendChild(portalHost);
			return portalHost;
		}

		let child = cell.firstChild;
		while (child) {
			const next = child.nextSibling;
			if (child !== portalHost) {
				child.remove();
			}
			child = next;
		}
		return portalHost;
	}

	private isEditorInteractiveElement(element: Element): boolean {
		return element.matches('input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"]');
	}

	/**
	 * Release and return a cell element to the DOMPool.
	 */
	private releaseCell(pooledRow: PooledRow, colIdx: number): void {
		this.releaseCellInternal(pooledRow, colIdx, false);
	}

	private releaseCellInternal(pooledRow: PooledRow, colIdx: number, skipPortalRelease: boolean): void {
		const cell = pooledRow.cells.get(colIdx);
		if (cell) {
			if (!skipPortalRelease && cell.dataset.cellKey) {
				this.releaseCellPortal(cell);
				delete cell.dataset.cellKey;
			} else if (!skipPortalRelease) {
				// Trigger unmount hook if a framework adapter owns this cell's content.
				const col = this.engine.stateManager.getState().columns[colIdx];
				if (col) {
					const cellKey = createCellKey(pooledRow.boundRowId, col.field);
					this.portalMountManager.releaseCell({ cellKey });
				}
			}

			// Detach from ANY parent (center, left pinned, or right pinned row element)
			this.portalMountManager.flushCellReleaseTransaction(!this.isScrollFrameActive);
			if (cell.parentNode) {
				try {
					cell.remove();
				} catch (e) {
					// Safe unmount boundary catch
				}
			}
			if (this.isScrollFrameActive) {
				this.cellPool.releaseHot(cell);
			} else {
				this.cellPool.releaseCold(cell);
			}
			pooledRow.cells.delete(colIdx);
		}
	}

	private releaseAllCellsInRow(pooledRow: PooledRow): void {
		this.releaseCellsInColumns(pooledRow, Array.from(pooledRow.cells.keys()));
	}

	private releaseCellsInColumns(pooledRow: PooledRow, colIdxs: number[]): void {
		if (colIdxs.length === 0) return;
		for (const colIdx of colIdxs) {
			const cell = pooledRow.cells.get(colIdx);
			if (cell?.dataset.cellKey) {
				this.releaseCellPortal(cell);
				delete cell.dataset.cellKey;
			}
		}
		this.portalMountManager.flushCellReleaseTransaction(!this.isScrollFrameActive);

		for (const colIdx of colIdxs) {
			this.releaseCellInternal(pooledRow, colIdx, true);
		}
	}

	private releaseCellPortal(cell: HTMLDivElement): void {
		if (!cell.dataset.cellKey) return;
		this.portalMountManager.releaseCell({
			cellKey: cell.dataset.cellKey,
			container: this.getCellPortalHost(cell) ?? cell,
			flushSync: true,
		});
	}

	/**
	 * Release and return an entire row and all its cells to the pools.
	 */
	private releaseRow(rowIndex: number, pooledRow: PooledRow): void {
		if (pooledRow.element.dataset.rowKey) {
			this.portalMountManager.releaseRow({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
			delete pooledRow.element.dataset.rowKey;
			pooledRow.element.textContent = '';
		}

		// Release all cell DOMs inside row
		this.releaseAllCellsInRow(pooledRow);

		// Detach row elements and recycle
		if (pooledRow.element.parentNode) pooledRow.element.remove();
		if (pooledRow.leftElement && pooledRow.leftElement.parentNode) pooledRow.leftElement.remove();
		if (pooledRow.rightElement && pooledRow.rightElement.parentNode) pooledRow.rightElement.remove();

		if (this.isScrollFrameActive) {
			this.rowPool.releaseHot(pooledRow.element);
			if (pooledRow.leftElement) this.rowPool.releaseHot(pooledRow.leftElement);
			if (pooledRow.rightElement) this.rowPool.releaseHot(pooledRow.rightElement);
		} else {
			this.rowPool.releaseCold(pooledRow.element);
			if (pooledRow.leftElement) this.rowPool.releaseCold(pooledRow.leftElement);
			if (pooledRow.rightElement) this.rowPool.releaseCold(pooledRow.rightElement);
		}
		this.activeRows.delete(rowIndex);
	}

	/**
	 * Empties all active visible rows back into recycling.
	 */
	private clearActiveRows(): void {
		for (const [rowIndex, pooledRow] of this.activeRows.entries()) {
			this.releaseRow(rowIndex, pooledRow);
		}
		this.activeRows.clear();
	}

	/**
	 * Renders the grid column headers.
	 */
	private paintHeaders(): void {
		if (this.isScrolling) this.renderStats.headerPaintsDuringScroll++;
		if (!this.headerLayer || !this.headerLeftLayer || !this.headerRightLayer) return;

		const columns = this.engine.stateManager.getState().columns;
		const colCount = columns.length;
		if (colCount === 0) {
			this.clearHeaderCells();
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

			let targetLayer = this.headerLayer;

			if (c < pinLeftColumns) {
				className += ' og-header-cell-pinned-left';
				targetLayer = this.headerLeftLayer;
			} else if (c >= colCount - pinRightColumns) {
				className += ' og-header-cell-pinned-right';
				const firstRightPinColLeft = this.engine.geometry.colLefts[colCount - pinRightColumns];
				cellLeft = cellLeft - firstRightPinColLeft;
				targetLayer = this.headerRightLayer;
			} else {
				// No manual scrollLeft subtraction needed due to native CSS Grid scrolling!
			}

			const state = this.engine.stateManager.getState();
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

			headerCell.className = className;
			headerCell.style.transform = `translate3d(${cellLeft}px, 0, 0)`;
			headerCell.style.width = `${cellWidth}px`;

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

			headerCell.dataset.colField = col.field;
			headerCell.dataset.colIndex = String(c);
			if (headerCell.parentNode !== targetLayer) {
				targetLayer!.appendChild(headerCell);
			}
		};

		// 1. Render pinned left headers
		for (let c = 0; c < pinLeftColumns; c++) {
			renderHeaderCell(c);
		}

		// 2. Render scrollable headers
		for (let c = newColRange.startIdx; c <= newColRange.endIdx; c++) {
			if (c >= pinLeftColumns && c < colCount - pinRightColumns) {
				renderHeaderCell(c);
			}
		}

		// 3. Render pinned right headers
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

		// Support custom React header popover component if registered
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

		// Support custom headerMenuRenderer if provided by the developer
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

		// Default Sort Options
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

		// Default Filter Section
		const filterContainer = document.createElement('div');
		filterContainer.className = 'og-popover-filter-section';

		const filterTitle = document.createElement('div');
		filterTitle.className = 'og-popover-section-title';
		filterTitle.textContent = 'Filter Column';
		filterContainer.appendChild(filterTitle);

		let currentOperator: string = 'contains';
		let currentFilterVal: string = '';
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
		const operators: { value: string; label: string }[] = [
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

	/**
	 * Computes selection overlays & active focus coordinates off-screen.
	 */
	private paintOverlay(): void {
		if (this.isScrolling) this.renderStats.overlayPaintsDuringScroll++;
		if (!this.overlayLayer) return;

		this.columnInteractions.reattachOverlays();

		const state = this.engine.stateManager.getState();
		const bounds = state.selection.bounds;

		if (!bounds || !this.engine.getRowModel()) {
			this.hideSelectionOverlay();
			return;
		}

		const rowModel = this.engine.getRowModel()!;
		const rowCount = rowModel.getVisualRowCount();
		const columns = state.columns;
		const colCount = columns.length;

		// Check if selection limits lie inside current loaded row scope
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

		// Position selection border overlay absolute
		selectionBorder.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
		selectionBorder.style.width = `${box.width}px`;
		selectionBorder.style.height = `${box.height}px`;
		selectionBorder.style.display = 'block';

		if (selectionBorder.parentNode !== this.overlayLayer) {
			this.overlayLayer.appendChild(selectionBorder);
		}

		// Re-append the fill preview border if actively dragging so it doesn't get cleared by textContent = ''
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
		const colCount = state.columns.length;

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
		if (this.hoveredRowIndex === rowIndex) return;

		if (this.hoveredRowIndex !== null) {
			this.setPooledRowHoverClass(this.hoveredRowIndex, false);
		}

		this.hoveredRowIndex = rowIndex;

		if (rowIndex !== null) {
			this.setPooledRowHoverClass(rowIndex, true);
		}
	}

	private setPooledRowHoverClass(rowIndex: number, hovered: boolean): void {
		const pooledRow = this.activeRows.get(rowIndex);
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

	/**
	 * Factory function for building a row element wrapper.
	 */
	private createRowElement(): HTMLDivElement {
		const el = document.createElement('div');
		el.className = 'og-row';
		return el;
	}

	/**
	 * Factory function for building a cell element wrapper.
	 */
	private createCellElement(): HTMLDivElement {
		const el = document.createElement('div');
		el.className = 'og-cell';
		return el;
	}

	/**
	 * Injects the structural styles required by the DOM renderer.
	 */
	private injectStyles(): void {
		if (typeof document === 'undefined') return;

		this.styleTag = document.createElement('style');
		this.styleTag.textContent = CORE_STYLES;
		document.head.appendChild(this.styleTag);
	}
}

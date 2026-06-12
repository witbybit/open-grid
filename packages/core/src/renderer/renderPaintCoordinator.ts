import type { GridEngine } from '../engine/GridEngine.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import type { OverlayRenderer } from './overlayRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { RenderOrchestrator } from './renderOrchestrator.js';
import type { RowRenderer } from './rowRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { HeaderRenderer } from './headerRenderer.js';
import type { StickyGroupRenderer } from './stickyGroupRenderer.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { RenderWindow } from './renderWindow.js';
import type { SortAnimationController } from './sortAnimationController.js';

export interface RenderPaintCoordinatorState {
	pendingSortAnimation: boolean;
	lastStyleSlots: unknown;
	lastLoading: unknown;
}

export interface RenderPaintCoordinatorDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	viewportRenderer: ViewportRenderer<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	headerRenderer: HeaderRenderer<TRowData>;
	overlayRenderer: OverlayRenderer<TRowData>;
	stickyGroupRenderer: StickyGroupRenderer<TRowData>;
	portalMountManager: PortalMountManager<TRowData>;
	orchestrator: RenderOrchestrator;
	scrollCoordinator: ScrollCoordinatorLike;
	sortAnimation: SortAnimationController<TRowData>;
	recycleViewport: (isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow) => void;
	syncLayoutPlan: (renderWindow?: RenderWindow) => GridLayoutPlan;
	updateCachedGeometryBoundsFromState: (defaultColWidth: number, defaultRowHeight: number) => void;
}

export class RenderPaintCoordinator<TRowData = unknown> {
	constructor(
		private readonly deps: RenderPaintCoordinatorDeps<TRowData>,
		private readonly state: RenderPaintCoordinatorState
	) {}

	public flushPaint = (): void => {
		this.refreshRendererEpochs();
		const frame = this.deps.engine.invalidation.consume();
		if (!this.deps.scrollCoordinator.getIsScrolling() && frame.reasons.includes('sort')) {
			this.state.pendingSortAnimation = true;
		}
		this.deps.portalMountManager.beginCellReleaseTransaction();
		try {
			this.deps.orchestrator.flush(frame);
		} finally {
			this.deps.portalMountManager.endCellReleaseTransaction();
		}
	};

	public fullPaint = (): void => {
		this.deps.portalMountManager.beginCellReleaseTransaction();
		try {
			this.fullPaintInternal();
		} finally {
			this.deps.portalMountManager.endCellReleaseTransaction();
		}
	};

	public refreshRendererEpochs(): void {
		const state = this.deps.engine.stateManager.getState();
		if (this.state.lastStyleSlots !== state.styleSlots) {
			this.state.lastStyleSlots = state.styleSlots;
			this.deps.rowRenderer.styleVersion++;
		}
		if (this.state.lastLoading !== state.loading) {
			this.state.lastLoading = state.loading;
			this.deps.rowRenderer.loadingVersion++;
		}
	}

	private fullPaintInternal(): void {
		this.deps.viewportRenderer.syncViewportScrollFromDom();

		const state = this.deps.engine.stateManager.getState();

		// Keep scroll clamps and total extents in sync after any full repaint
		// (handles column adds/removes and viewport resizes funneled through full paint).
		this.deps.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);

		const layoutPlan = this.deps.syncLayoutPlan();
		this.deps.recycleViewport(false, undefined, layoutPlan.renderWindow);
		this.deps.stickyGroupRenderer.sync(layoutPlan);
		if (this.state.pendingSortAnimation) {
			this.state.pendingSortAnimation = false;
			this.deps.sortAnimation.beginAnimation();
		}
		this.deps.headerRenderer.repaintHeaders(layoutPlan);
		this.deps.overlayRenderer.repaintOverlay();
	}
}

export interface ScrollCoordinatorLike {
	getIsScrolling(): boolean;
}

import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import { CORE_STYLES } from './styles.js';
import type { GridLayoutPlan } from './layoutPlan.js';

export class ViewportRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly geometryController: GeometryController<TRowData>;

	public container: HTMLElement | null = null;
	public scrollViewport: HTMLDivElement | null = null;

	// Single rows container — all row elements live here (no separate left/right layers)
	public rowsContainer: HTMLDivElement | null = null;

	// Group panel — optional sticky strip above the header for groupBy chips.
	// Only present in the DOM; shown/hidden by syncLayoutPlan().
	public groupPanel: HTMLDivElement | null = null;

	// Header layers — kept as three overlapping absolute divs inside a sticky wrapper
	public headerWrapper: HTMLDivElement | null = null;
	public headerLayer: HTMLDivElement | null = null;
	public headerLeftLayer: HTMLDivElement | null = null;
	public headerRightLayer: HTMLDivElement | null = null;
	public stickyGroupLayer: HTMLDivElement | null = null;

	// Overlay sits outside the scroll viewport so it covers the full grid without scrolling
	public overlayLayer: HTMLDivElement | null = null;

	private styleTag: HTMLStyleElement | null = null;
	private layoutPlan: GridLayoutPlan | null = null;

	constructor(engine: GridEngine<TRowData>, geometryController: GeometryController<TRowData>) {
		this.engine = engine;
		this.geometryController = geometryController;
	}

	public mount(container: HTMLElement): void {
		this.container = container;
		this.injectStyles();
		this.container.classList.add('og-grid-container');

		// Single scroll container — the only element that has overflow:auto
		this.scrollViewport = document.createElement('div');
		this.scrollViewport.className = 'og-scroll-viewport';

		// ── Group panel (sticky, above header, hidden by default) ────────────
		this.groupPanel = document.createElement('div');
		this.groupPanel.className = 'og-group-panel';
		this.groupPanel.style.display = 'none';
		this.scrollViewport.appendChild(this.groupPanel);

		// ── Header (sticky top, three overlapping absolute divs) ────────────
		const headerWrapper = document.createElement('div');
		headerWrapper.className = 'og-layer-header-wrapper';
		this.headerWrapper = headerWrapper;

		this.headerLayer = document.createElement('div');
		this.headerLayer.className = 'og-layer-header';

		this.headerLeftLayer = document.createElement('div');
		this.headerLeftLayer.className = 'og-layer-header-left';

		this.headerRightLayer = document.createElement('div');
		this.headerRightLayer.className = 'og-layer-header-right';

		headerWrapper.appendChild(this.headerLayer);
		headerWrapper.appendChild(this.headerLeftLayer);
		headerWrapper.appendChild(this.headerRightLayer);

		// ── Rows container (single compositor layer, no per-row will-change) ─
		this.rowsContainer = document.createElement('div');
		this.rowsContainer.className = 'og-rows-container';
		this.stickyGroupLayer = document.createElement('div');
		this.stickyGroupLayer.className = 'og-layer-sticky-groups';

		this.scrollViewport.appendChild(headerWrapper);
		this.scrollViewport.appendChild(this.stickyGroupLayer);
		this.scrollViewport.appendChild(this.rowsContainer);

		// ── Overlay (outside scroll container, absolute over grid) ────────────
		this.overlayLayer = document.createElement('div');
		this.overlayLayer.className = 'og-layer-overlay';

		this.container.appendChild(this.scrollViewport);
		this.container.appendChild(this.overlayLayer);
	}

	public unmount(): void {
		if (this.container) {
			this.container.classList.remove('og-grid-container');
			this.container.textContent = '';
		}
		if (this.styleTag && this.styleTag.parentNode) {
			this.styleTag.remove();
		}
		this.container = null;
		this.scrollViewport = null;
		this.rowsContainer = null;
		this.groupPanel = null;
		this.headerWrapper = null;
		this.headerLayer = null;
		this.headerLeftLayer = null;
		this.headerRightLayer = null;
		this.stickyGroupLayer = null;
		this.overlayLayer = null;
		this.styleTag = null;
	}

	public syncViewportScrollFromDom(): void {
		if (!this.scrollViewport) return;
		this.engine.viewport.setScrollPosition(this.scrollViewport.scrollTop, this.scrollViewport.scrollLeft);
	}

	/**
	 * Toggle the container-level scrolling marker class. CSS uses it to disable row
	 * hover matching and background transitions during scroll — both trigger style
	 * recalc/paint work per frame as the cursor sweeps moving rows.
	 */
	public setScrollingClass(scrolling: boolean): void {
		this.container?.classList.toggle('og-is-scrolling', scrolling);
	}

	public syncLayoutPlan(plan: GridLayoutPlan): void {
		this.layoutPlan = plan;
		this.container?.style.setProperty('--og-leaf-header-height', `${plan.chrome.leafHeaderHeight}px`);
		this.container?.style.setProperty('--og-total-header-height', `${plan.chrome.totalHeaderHeight}px`);
		this.container?.style.setProperty('--og-group-panel-height', `${plan.chrome.groupPanelHeight}px`);
		this.container?.style.setProperty('--og-overlay-top', `${plan.origins.overlayTop}px`);
		const visible = plan.chrome.groupPanelHeight > 0;
		if (this.groupPanel) {
			this.groupPanel.style.display = visible ? 'flex' : 'none';
			this.groupPanel.style.height = visible ? `${plan.chrome.groupPanelHeight}px` : '0';
		}
		if (this.headerWrapper) {
			this.headerWrapper.style.top = `${plan.origins.headerTop}px`;
			this.headerWrapper.style.height = `${plan.chrome.totalHeaderHeight}px`;
		}
		if (this.overlayLayer) {
			this.overlayLayer.style.top = `${plan.origins.overlayTop}px`;
		}

		const totalWidth = plan.dimensions.totalColumnsWidth;
		const contentWidth = plan.dimensions.contentWidth;
		const colCount = plan.renderWindow.colCount;

		if (this.rowsContainer) {
			this.rowsContainer.style.height = `${plan.dimensions.contentHeight}px`;
			this.rowsContainer.style.width = `${contentWidth}px`;
		}

		if (this.headerWrapper) {
			this.headerWrapper.style.width = `${contentWidth}px`;
		}
		if (this.headerLayer) {
			this.headerLayer.style.width = `${contentWidth}px`;
		}
		if (this.stickyGroupLayer) {
			this.stickyGroupLayer.style.width = `${contentWidth}px`;
			this.stickyGroupLayer.style.transform = `translate3d(0, ${plan.origins.stickyGroupLayerTop}px, 0)`;
		}

		if (this.headerLeftLayer) {
			this.headerLeftLayer.style.width = `${plan.columns.pinLeftWidth}px`;
		}
		if (this.headerRightLayer) {
			this.headerRightLayer.style.width = `${plan.columns.pinRightWidth}px`;
		}
	}

	public getLayoutPlan(): GridLayoutPlan | null {
		return this.layoutPlan;
	}

	private injectStyles(): void {
		if (typeof document === 'undefined') return;
		this.styleTag = document.createElement('style');
		this.styleTag.textContent = CORE_STYLES;
		document.head.appendChild(this.styleTag);
	}
}

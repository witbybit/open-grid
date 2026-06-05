import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import type { InvalidationFrame } from './invalidationManager.js';
import type { GridState } from '../store.js';
import { CORE_STYLES } from './styles.js';

export class ViewportRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly geometryController: GeometryController<TRowData>;

	// Viewport DOM elements
	public container: HTMLElement | null = null;
	public scrollViewport: HTMLDivElement | null = null;
	public scrollSpacer: HTMLDivElement | null = null;

	// Layer DOM elements
	public centerLayer: HTMLDivElement | null = null;
	public leftLayer: HTMLDivElement | null = null;
	public rightLayer: HTMLDivElement | null = null;
	public headerLayer: HTMLDivElement | null = null;
	public headerLeftLayer: HTMLDivElement | null = null;
	public headerRightLayer: HTMLDivElement | null = null;
	public overlayLayer: HTMLDivElement | null = null;
	private styleTag: HTMLStyleElement | null = null;

	constructor(engine: GridEngine<TRowData>, geometryController: GeometryController<TRowData>) {
		this.engine = engine;
		this.geometryController = geometryController;
	}

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
		this.scrollSpacer = null;
		this.centerLayer = null;
		this.leftLayer = null;
		this.rightLayer = null;
		this.headerLayer = null;
		this.headerLeftLayer = null;
		this.headerRightLayer = null;
		this.overlayLayer = null;
		this.styleTag = null;
	}

	public syncViewportScrollFromDom(): void {
		if (!this.scrollViewport) return;
		this.engine.viewport.setScrollPosition(this.scrollViewport.scrollTop, this.scrollViewport.scrollLeft);
	}

	public syncSpacerAndLayers(state: GridState<TRowData>, colCount: number): void {
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
	}

	private injectStyles(): void {
		if (typeof document === 'undefined') return;
		this.styleTag = document.createElement('style');
		this.styleTag.textContent = CORE_STYLES;
		document.head.appendChild(this.styleTag);
	}
}

/**
 * LayerRegistry — builds and manages the DOM layer stack for the grid.
 *
 * Layers are created once in the constructor and positioned/sized via
 * applyLayout(). No layout constants live outside this file; every CSS
 * write is derived from the params passed to applyLayout().
 */

export interface GridLayers {
	scrollViewport: HTMLDivElement;
	rowsContainer: HTMLDivElement;
	headerWrapper: HTMLDivElement;
	headerLeft: HTMLDivElement;
	headerCenter: HTMLDivElement;
	headerRight: HTMLDivElement;
	floatingFilterWrapper: HTMLDivElement;
	floatingFilterLeft: HTMLDivElement;
	floatingFilterCenter: HTMLDivElement;
	floatingFilterRight: HTMLDivElement;
	stickyGroupsLayer: HTMLDivElement;
	overlayLayer: HTMLDivElement;
	statusBarLayer: HTMLDivElement | null;
	paginationLayer: HTMLDivElement | null;
}

export interface ApplyLayoutParams {
	totalRowsHeight: number;
	contentWidth: number;
	headerHeight: number;
	floatingFilterHeight: number;
	pinLeftWidth: number;
	pinRightWidth: number;
	showStatusBar: boolean;
	statusBarHeight: number;
	showPagination: boolean;
	paginationHeight: number;
}

function div(className: string): HTMLDivElement {
	const el = document.createElement('div');
	el.className = className;
	return el;
}

export class LayerRegistry {
	readonly layers: GridLayers;

	private readonly _container: HTMLElement;
	private readonly _scrollListener: EventListener;
	private _scrollCallbacks: Array<(scrollTop: number, scrollLeft: number) => void> = [];

	constructor(container: HTMLElement) {
		this._container = container;

		// ── scroll-viewport ───────────────────────────────────────────────
		const scrollViewport = div('og-scroll-viewport');
		Object.assign(scrollViewport.style, {
			position: 'relative',
			overflow: 'auto',
			flex: '1 1 0',
			minHeight: '0',
		});

		// ── rows-container (scrollable content area) ──────────────────────
		const rowsContainer = div('og-rows-container');
		Object.assign(rowsContainer.style, {
			position: 'relative',
		});

		// ── header-wrapper (sticky top) ───────────────────────────────────
		const headerWrapper = div('og-layer-header-wrapper');
		Object.assign(headerWrapper.style, {
			position: 'sticky',
			top: '0',
			zIndex: '2',
			display: 'flex',
			flexDirection: 'row',
		});

		const headerLeft = div('og-layer-header-left');
		Object.assign(headerLeft.style, {
			flexShrink: '0',
			overflow: 'hidden',
			display: 'none',
		});

		const headerCenter = div('og-layer-header');
		Object.assign(headerCenter.style, {
			flex: '1',
			overflow: 'hidden',
		});

		const headerRight = div('og-layer-header-right');
		Object.assign(headerRight.style, {
			flexShrink: '0',
			overflow: 'hidden',
			display: 'none',
		});

		headerWrapper.appendChild(headerLeft);
		headerWrapper.appendChild(headerCenter);
		headerWrapper.appendChild(headerRight);

		// ── floating-filter-wrapper (sticky below header) ─────────────────
		const floatingFilterWrapper = div('og-layer-floating-filter-wrapper');
		Object.assign(floatingFilterWrapper.style, {
			position: 'sticky',
			zIndex: '2',
			display: 'none',
			flexDirection: 'row',
		});

		const floatingFilterLeft = div('og-layer-floating-filter-left');
		Object.assign(floatingFilterLeft.style, {
			flexShrink: '0',
			overflow: 'hidden',
			display: 'none',
		});

		const floatingFilterCenter = div('og-layer-floating-filter');
		Object.assign(floatingFilterCenter.style, {
			flex: '1',
			overflow: 'hidden',
		});

		const floatingFilterRight = div('og-layer-floating-filter-right');
		Object.assign(floatingFilterRight.style, {
			flexShrink: '0',
			overflow: 'hidden',
			display: 'none',
		});

		floatingFilterWrapper.appendChild(floatingFilterLeft);
		floatingFilterWrapper.appendChild(floatingFilterCenter);
		floatingFilterWrapper.appendChild(floatingFilterRight);

		// ── sticky-groups (absolute, pointer-events: none) ────────────────
		const stickyGroupsLayer = div('og-layer-sticky-groups');
		Object.assign(stickyGroupsLayer.style, {
			position: 'absolute',
			top: '0',
			left: '0',
			right: '0',
			pointerEvents: 'none',
			zIndex: '1',
		});

		// Assemble scroll-viewport children (order: header, filter, rows, sticky-groups)
		scrollViewport.appendChild(headerWrapper);
		scrollViewport.appendChild(floatingFilterWrapper);
		scrollViewport.appendChild(rowsContainer);
		scrollViewport.appendChild(stickyGroupsLayer);

		// ── overlay (absolute, for loading / empty state) ─────────────────
		const overlayLayer = div('og-layer-overlay');
		Object.assign(overlayLayer.style, {
			position: 'absolute',
			top: '0',
			left: '0',
			right: '0',
			bottom: '0',
			pointerEvents: 'none',
			zIndex: '10',
		});

		// Mount primary structure into container
		container.style.position = 'relative';
		container.appendChild(scrollViewport);
		container.appendChild(overlayLayer);

		this.layers = {
			scrollViewport,
			rowsContainer,
			headerWrapper,
			headerLeft,
			headerCenter,
			headerRight,
			floatingFilterWrapper,
			floatingFilterLeft,
			floatingFilterCenter,
			floatingFilterRight,
			stickyGroupsLayer,
			overlayLayer,
			statusBarLayer: null,
			paginationLayer: null,
		};

		// ── scroll forwarding ─────────────────────────────────────────────
		this._scrollListener = () => {
			const { scrollTop, scrollLeft } = scrollViewport;
			for (const cb of this._scrollCallbacks) {
				cb(scrollTop, scrollLeft);
			}
		};
		scrollViewport.addEventListener('scroll', this._scrollListener, { passive: true });
	}

	// ── applyLayout ────────────────────────────────────────────────────────

	applyLayout(params: ApplyLayoutParams): void {
		const {
			totalRowsHeight,
			contentWidth,
			headerHeight,
			floatingFilterHeight,
			pinLeftWidth,
			pinRightWidth,
			showStatusBar,
			statusBarHeight,
			showPagination,
			paginationHeight,
		} = params;

		const l = this.layers;

		// rows-container
		l.rowsContainer.style.height = `${totalRowsHeight}px`;
		l.rowsContainer.style.width = `${contentWidth}px`;

		// header-wrapper
		l.headerWrapper.style.height = `${headerHeight}px`;
		l.headerWrapper.style.width = `${contentWidth}px`;

		// header pins
		if (pinLeftWidth > 0) {
			l.headerLeft.style.width = `${pinLeftWidth}px`;
			l.headerLeft.style.display = '';
		} else {
			l.headerLeft.style.display = 'none';
		}

		if (pinRightWidth > 0) {
			l.headerRight.style.width = `${pinRightWidth}px`;
			l.headerRight.style.display = '';
		} else {
			l.headerRight.style.display = 'none';
		}

		// floating-filter-wrapper (sticky just below header)
		const filterVisible = floatingFilterHeight > 0;
		l.floatingFilterWrapper.style.display = filterVisible ? 'flex' : 'none';
		if (filterVisible) {
			l.floatingFilterWrapper.style.top = `${headerHeight}px`;
			l.floatingFilterWrapper.style.height = `${floatingFilterHeight}px`;
			l.floatingFilterWrapper.style.width = `${contentWidth}px`;
		}

		// floating filter pins
		if (pinLeftWidth > 0) {
			l.floatingFilterLeft.style.width = `${pinLeftWidth}px`;
			l.floatingFilterLeft.style.display = '';
		} else {
			l.floatingFilterLeft.style.display = 'none';
		}

		if (pinRightWidth > 0) {
			l.floatingFilterRight.style.width = `${pinRightWidth}px`;
			l.floatingFilterRight.style.display = '';
		} else {
			l.floatingFilterRight.style.display = 'none';
		}

		// sticky-groups
		l.stickyGroupsLayer.style.width = `${contentWidth}px`;

		// status-bar (bottom chrome, fixed relative to container)
		if (showStatusBar && statusBarHeight > 0) {
			const bar = this._ensureStatusBar();
			bar.style.display = 'flex';
			bar.style.height = `${statusBarHeight}px`;
			// position from bottom of container, above pagination if present
			const paginationOffset = showPagination ? paginationHeight : 0;
			bar.style.bottom = `${paginationOffset}px`;
			bar.style.top = 'auto';
		} else if (l.statusBarLayer) {
			l.statusBarLayer.style.display = 'none';
		}

		// pagination-bar (bottom chrome, fixed relative to container)
		if (showPagination && paginationHeight > 0) {
			const bar = this._ensurePaginationBar();
			bar.style.display = 'flex';
			bar.style.height = `${paginationHeight}px`;
			bar.style.bottom = '0';
			bar.style.top = 'auto';
		} else if (l.paginationLayer) {
			l.paginationLayer.style.display = 'none';
		}

		// shrink scroll-viewport to leave room for bottom chrome
		const bottomChromeHeight =
			(showStatusBar ? statusBarHeight : 0) + (showPagination ? paginationHeight : 0);
		this.layers.scrollViewport.style.paddingBottom =
			bottomChromeHeight > 0 ? `${bottomChromeHeight}px` : '';
	}

	// ── scroll listener ────────────────────────────────────────────────────

	onScroll(listener: (scrollTop: number, scrollLeft: number) => void): () => void {
		this._scrollCallbacks.push(listener);
		return () => {
			this._scrollCallbacks = this._scrollCallbacks.filter((cb) => cb !== listener);
		};
	}

	// ── destroy ────────────────────────────────────────────────────────────

	destroy(): void {
		this.layers.scrollViewport.removeEventListener('scroll', this._scrollListener);
		this._scrollCallbacks = [];
		this._container.innerHTML = '';
	}

	// ── private helpers ────────────────────────────────────────────────────

	private _ensureStatusBar(): HTMLDivElement {
		if (!this.layers.statusBarLayer) {
			const bar = div('og-layer-status-bar');
			Object.assign(bar.style, {
				position: 'absolute',
				left: '0',
				right: '0',
				zIndex: '5',
			});
			this._container.appendChild(bar);
			(this.layers as { statusBarLayer: HTMLDivElement | null }).statusBarLayer = bar;
		}
		return this.layers.statusBarLayer!;
	}

	private _ensurePaginationBar(): HTMLDivElement {
		if (!this.layers.paginationLayer) {
			const bar = div('og-layer-pagination-bar');
			Object.assign(bar.style, {
				position: 'absolute',
				left: '0',
				right: '0',
				zIndex: '5',
			});
			this._container.appendChild(bar);
			(this.layers as { paginationLayer: HTMLDivElement | null }).paginationLayer = bar;
		}
		return this.layers.paginationLayer!;
	}
}

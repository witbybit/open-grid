import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import { CORE_STYLES } from './styles.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { LAYER_REGISTRY } from './layerRegistry.js';
import type { BuiltInThemeName, ThemeTokens } from './themes.js';
import { ThemeManager, DARK_THEME, getBuiltInTheme, isBuiltInThemeName } from './themes.js';

export class ViewportRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly geometryController: GeometryController<TRowData>;

	public container: HTMLElement | null = null;
	private lastAriaRowCount = -1;
	private lastAriaColCount = -1;
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
	private themeManager: ThemeManager | null = null;
	private themeSelector = '';
	private static nextThemeScopeId = 0;

	// All registry-built layers, keyed by descriptor id. Named fields above are
	// assigned from this map after mount for the renderers that hold references.
	private readonly layers = new Map<string, HTMLDivElement>();

	constructor(engine: GridEngine<TRowData>, geometryController: GeometryController<TRowData>) {
		this.engine = engine;
		this.geometryController = geometryController;
	}

	public mount(container: HTMLElement): void {
		this.container = container;
		this.injectStyles();
		this.container.classList.add('og-grid-container');
		// ARIA grid root. Row/col counts are kept current in syncLayoutPlan().
		this.container.setAttribute('role', 'grid');
		this.container.setAttribute('aria-multiselectable', 'true');

		const stateThemeName = this.engine.getState().themeName;
		const initialThemeName: BuiltInThemeName = isBuiltInThemeName(stateThemeName ?? '') ? stateThemeName : 'dark';
		const themeScopeId = ++ViewportRenderer.nextThemeScopeId;
		this.container.dataset.ogThemeScope = String(themeScopeId);
		this.themeSelector = `[data-og-theme-scope="${themeScopeId}"]`;

		// Initialize theme manager with grid-scoped CSS variables.
		this.themeManager = new ThemeManager(getBuiltInTheme(initialThemeName), initialThemeName);
		this.themeManager.mount(this.themeSelector);

		// Single scroll container — the only element that has overflow:auto. This and the
		// grid container are the two DOM roots the layer registry parents layers onto.
		this.scrollViewport = document.createElement('div');
		this.scrollViewport.className = 'og-scroll-viewport';
		this.container.appendChild(this.scrollViewport);

		this.buildLayers();
	}

	/**
	 * Build every structural layer from LAYER_REGISTRY. Layers are created first, then
	 * appended parent-before-child so a layer can parent onto another layer's id. Within
	 * a parent, siblings append in ascending `order`. Named fields (rowsContainer,
	 * headerLayer, …) are bound from the resulting map for renderers that hold refs.
	 */
	private buildLayers(): void {
		this.layers.clear();
		for (const d of LAYER_REGISTRY) {
			const el = document.createElement('div');
			el.className = d.className;
			d.init?.(el);
			this.layers.set(d.id, el);
		}

		const ordered = [...LAYER_REGISTRY].sort((a, b) => a.order - b.order);
		const placed = new Set<string>(['scroll-viewport', 'container']);
		let remaining = ordered.length;
		// Resolve in passes: append a layer only once its parent exists in the DOM.
		while (remaining > 0) {
			let progressed = false;
			for (const d of ordered) {
				if (placed.has(d.id) || !placed.has(d.parent)) continue;
				const parent =
					d.parent === 'scroll-viewport' ? this.scrollViewport : d.parent === 'container' ? this.container : this.layers.get(d.parent);
				parent?.appendChild(this.layers.get(d.id)!);
				placed.add(d.id);
				progressed = true;
				remaining--;
			}
			if (!progressed) break; // guards against a descriptor referencing an unknown parent
		}

		this.groupPanel = this.layers.get('group-panel') ?? null;
		this.headerWrapper = this.layers.get('header-wrapper') ?? null;
		this.headerLayer = this.layers.get('header') ?? null;
		this.headerLeftLayer = this.layers.get('header-left') ?? null;
		this.headerRightLayer = this.layers.get('header-right') ?? null;
		this.stickyGroupLayer = this.layers.get('sticky-groups') ?? null;
		this.rowsContainer = this.layers.get('rows') ?? null;
		this.overlayLayer = this.layers.get('overlay') ?? null;
	}

	/** Look up a registry-built layer element by descriptor id. */
	public getLayer(id: string): HTMLDivElement | null {
		return this.layers.get(id) ?? null;
	}

	public unmount(): void {
		this.themeManager?.unmount();
		this.themeManager = null;

		if (this.container) {
			this.container.classList.remove('og-grid-container');
			this.container.removeAttribute('role');
			this.container.removeAttribute('aria-multiselectable');
			this.container.removeAttribute('aria-rowcount');
			this.container.removeAttribute('aria-colcount');
			delete this.container.dataset.ogThemeScope;
			this.container.textContent = '';
		}
		this.lastAriaRowCount = -1;
		this.lastAriaColCount = -1;
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
		this.layers.clear();
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

		// Container-level CSS custom properties (consumed by stylesheet rules, not a layer).
		this.container?.style.setProperty('--og-leaf-header-height', `${plan.chrome.leafHeaderHeight}px`);
		this.container?.style.setProperty('--og-total-header-height', `${plan.chrome.totalHeaderHeight}px`);
		this.container?.style.setProperty('--og-group-panel-height', `${plan.chrome.groupPanelHeight}px`);
		this.container?.style.setProperty('--og-overlay-top', `${plan.origins.overlayTop}px`);
		this.container?.style.setProperty('--og-bottom-chrome-height', `${plan.chrome.bottomChromeHeight}px`);

		// ARIA counts — guarded so we only touch the DOM when they actually change.
		if (this.container) {
			const rowCount = this.engine.getRowModel()?.getVisualRowCount() ?? 0;
			const colCount = this.engine.columns.getCompiledPlan().displayedColumns.length;
			if (this.lastAriaRowCount !== rowCount) {
				this.lastAriaRowCount = rowCount;
				this.container.setAttribute('aria-rowcount', String(rowCount));
			}
			if (this.lastAriaColCount !== colCount) {
				this.lastAriaColCount = colCount;
				this.container.setAttribute('aria-colcount', String(colCount));
			}
		}

		// Every structural layer positions itself from the plan via its descriptor.
		for (const d of LAYER_REGISTRY) {
			if (!d.apply) continue;
			const el = this.layers.get(d.id);
			if (el) d.apply(el, plan);
		}
	}

	public getLayoutPlan(): GridLayoutPlan | null {
		return this.layoutPlan;
	}

	/**
	 * Get the theme manager instance for runtime theme switching.
	 * Useful for exposing theme control to the application.
	 */
	public getThemeManager(): ThemeManager | null {
		return this.themeManager;
	}

	/**
	 * Set a custom theme immediately.
	 */
	public setTheme(theme: ThemeTokens): void {
		this.themeManager?.setTheme(theme, this.themeSelector);
	}

	/**
	 * Switch to a built-in theme by name (e.g., 'light', 'dark', 'cool-blue').
	 */
	public switchTheme(themeName: string): void {
		if (!isBuiltInThemeName(themeName)) return;
		this.themeManager?.switchTheme(themeName, this.themeSelector);
	}

	/**
	 * Get the currently active theme.
	 */
	public getTheme(): ThemeTokens {
		return this.themeManager?.getTheme() ?? DARK_THEME;
	}

	public getThemeName(): BuiltInThemeName | null {
		return this.themeManager?.getThemeName() ?? null;
	}

	/**
	 * Subscribe to theme changes.
	 * Returns an unsubscribe function.
	 */
	public onThemeChange(listener: (theme: ThemeTokens) => void): () => void {
		return this.themeManager?.onThemeChange(listener) ?? (() => {});
	}

	private injectStyles(): void {
		if (typeof document === 'undefined') return;
		this.styleTag = document.createElement('style');
		this.styleTag.textContent = CORE_STYLES;
		document.head.appendChild(this.styleTag);
	}
}

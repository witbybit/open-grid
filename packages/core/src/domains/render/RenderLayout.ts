import type { RendererEngineView } from './RendererEngineView.js';

// Chrome band heights (px). The new renderer owns these; the old renderer/layoutPlan constants are
// deleted with the old engine.
export const LEAF_HEADER_HEIGHT = 40;
export const GROUP_PANEL_HEIGHT = 42;
export const FILTER_CHIP_BAR_HEIGHT = 32;
export const FLOATING_FILTER_HEIGHT = 36;
export const STATUS_BAR_HEIGHT = 32;

/**
 * The lean layout the new renderer paints against, computed purely from {@link RendererEngineView}
 * (ARCHITECTURE.md §3 R12). Replaces the old `computeGridLayoutPlan` + its reads of engine internals
 * (`geometry.colLefts` arrays, `columns.getCompiledPlan()`, `stateManager.getState()`). Column-group
 * header bands and pinned rows are added when those features land; flat headers work now.
 */
export interface RenderLayout {
	readonly viewport: { readonly width: number; readonly height: number; readonly scrollTop: number; readonly scrollLeft: number };
	readonly dimensions: { readonly totalRowsHeight: number; readonly totalColumnsWidth: number; readonly contentWidth: number };
	readonly chrome: {
		readonly headerHeight: number;
		readonly groupPanelHeight: number;
		readonly filterChipBarHeight: number;
		readonly floatingFilterHeight: number;
		readonly statusBarHeight: number;
		readonly topChromeHeight: number;
		readonly bottomChromeHeight: number;
	};
	readonly columns: { readonly leftWidth: number; readonly centerWidth: number; readonly rightWidth: number };
	readonly rows: { readonly firstIndex: number; readonly lastIndex: number };
	readonly origins: { readonly headerTop: number; readonly rowLayerTop: number; readonly bottomChromeTop: number };
}

export function computeRenderLayout<TRow>(view: RendererEngineView<TRow>): RenderLayout {
	const vp = view.getViewport();
	const geo = view.getGeometry();
	const cfg = view.getDisplayConfig();
	const win = view.getVisibleWindow();

	const headerHeight = LEAF_HEADER_HEIGHT;
	const groupPanelHeight = cfg.showGroupPanel ? GROUP_PANEL_HEIGHT : 0;
	const filterChipBarHeight = cfg.showFilterChipBar ? FILTER_CHIP_BAR_HEIGHT : 0;
	const floatingFilterHeight = cfg.showFloatingFilters ? FLOATING_FILTER_HEIGHT : 0;
	const statusBarHeight = cfg.showStatusBar ? STATUS_BAR_HEIGHT : 0;

	const topChromeHeight = groupPanelHeight + filterChipBarHeight + headerHeight + floatingFilterHeight;
	const bottomChromeHeight = statusBarHeight;

	const totalRowsHeight = geo.totalHeight;
	const totalColumnsWidth = geo.totalWidth;

	return {
		viewport: { width: vp.width, height: vp.height, scrollTop: vp.scrollTop, scrollLeft: vp.scrollLeft },
		dimensions: { totalRowsHeight, totalColumnsWidth, contentWidth: Math.max(totalColumnsWidth, vp.width) },
		chrome: { headerHeight, groupPanelHeight, filterChipBarHeight, floatingFilterHeight, statusBarHeight, topChromeHeight, bottomChromeHeight },
		columns: { leftWidth: geo.columns.leftWidth, centerWidth: geo.columns.centerWidth, rightWidth: geo.columns.rightWidth },
		rows: { firstIndex: win.firstIndex, lastIndex: win.lastIndex },
		origins: {
			headerTop: groupPanelHeight + filterChipBarHeight,
			rowLayerTop: topChromeHeight,
			bottomChromeTop: Math.max(0, vp.height - bottomChromeHeight),
		},
	};
}

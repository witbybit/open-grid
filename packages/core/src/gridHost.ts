import { getStoreFromApi } from './createGrid.js';
import { RenderEngine } from './renderer/renderEngine.js';
import type { RenderStats } from './renderer/renderOrchestrator.js';
import type {
	GridCellContentMount,
	GridCellContentUnmount,
	GridRowContentMount,
	GridRowContentUnmount,
	GridHeaderMenuMount,
	GridHeaderMenuUnmount,
} from './renderer/IGridRenderer.js';
import type { GridApi } from './store.js';
import type { ColumnDef, InternalColumnDef } from './columnDef.js';

export function hasImperativeRendererCapability<TRowData = unknown>(column: ColumnDef<TRowData>): boolean {
	return (column as InternalColumnDef<TRowData>).cellRendererCapabilities?.imperativeUpdate === true;
}

export interface GridCellContentAdapter<TRowData = unknown> {
	mountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	unmountCellContent?: (unmount: GridCellContentUnmount) => void;
	flushCellContent?: (flush: { flushSync?: boolean }) => void;
}

export interface GridRowContentAdapter<TRowData = unknown> {
	mountRowContent?: (mount: GridRowContentMount<TRowData>) => void;
	unmountRowContent?: (unmount: GridRowContentUnmount) => void;
}

export interface GridHeaderMenuAdapter<TRowData = unknown> {
	mountHeaderMenu?: (mount: GridHeaderMenuMount<TRowData>) => void;
	unmountHeaderMenu?: (unmount: GridHeaderMenuUnmount) => void;
}

export interface GridHostOptions<TRowData = unknown> {
	pins?: {
		left?: number;
		right?: number;
		top?: number;
		bottom?: number;
	};
	cellContent?: GridCellContentAdapter<TRowData>;
	rowContent?: GridRowContentAdapter<TRowData>;
	headerMenu?: GridHeaderMenuAdapter<TRowData>;
}

export interface GridHost {
	setViewportPins(pins: NonNullable<GridHostOptions['pins']>): void;
	schedulePaint(): void;
	scheduleFullPaint(reason?: string): void;
	scheduleViewportPaint(reason?: string): void;
	scheduleHeaderPaint(reason?: string): void;
	scheduleOverlayPaint(reason?: string): void;
	scheduleGeometryPaint(reason?: string): void;
	getRenderStats(): RenderStats;
	resetRenderStats(): void;
	/** Set a custom theme immediately. */
	setTheme(theme: import('./renderer/themes.js').ThemeTokens): void;
	/** Switch to a built-in theme by name. */
	switchTheme(themeName: string): void;
	/** Get the currently active theme. */
	getTheme(): import('./renderer/themes.js').ThemeTokens;
	/** Get the active built-in theme name, or null for a custom theme. */
	getThemeName(): import('./renderer/themes.js').BuiltInThemeName | null;
	/** List supported built-in theme names. */
	getAvailableThemes(): import('./renderer/themes.js').BuiltInThemeName[];
	/** Subscribe to theme changes. Returns an unsubscribe function. */
	onThemeChange(listener: (theme: import('./renderer/themes.js').ThemeTokens) => void): () => void;
	destroy(): void;
}

export interface GridAdapterHandle<TRowData = unknown> {
	/** Resolve the cell pointer (rowId + colField) from a DOM element inside a cell. */
	getCellPointerFromElement(element: Element): import('./store.js').GridCellPointer | null;
	/** Get full cell access data from a DOM element inside a cell. */
	getCellAccessFromElement(element: Element): import('./store.js').GridCellAccess<TRowData> | null;
	/** Get full cell access data by row id and column field. */
	getCellAccess(rowId: string, colField: string): import('./store.js').GridCellAccess<TRowData> | null;
	/** Get the visible descendant row ids for a group row. */
	getGroupVisibleDescendantRowIds(groupId: string): string[];
	/** Returns true when the column uses the imperative-update renderer protocol. */
	isImperativeRendererColumn(column: import('./columnDef.js').ColumnDef<TRowData>): boolean;
}

export type GridHostWithAdapter<TRowData = unknown> = GridHost & { adapterHandle: GridAdapterHandle<TRowData> };

export function mountGridHost<TRowData>(
	api: GridApi<TRowData>,
	container: HTMLElement,
	options: GridHostOptions<TRowData> = {}
): GridHostWithAdapter<TRowData> {
	const store = getStoreFromApi(api);
	const engine = store.engine;
	const internalApi = store;
	const renderEngine = new RenderEngine(engine, internalApi);

	renderEngine.onMountCellContent = options.cellContent?.mountCellContent;
	renderEngine.onUnmountCellContent = options.cellContent?.unmountCellContent;
	renderEngine.portalMountManager.onFlushCellContent = options.cellContent?.flushCellContent;
	renderEngine.onMountRowContent = options.rowContent?.mountRowContent;
	renderEngine.onUnmountRowContent = options.rowContent?.unmountRowContent;
	renderEngine.onMountHeaderMenu = options.headerMenu?.mountHeaderMenu;
	renderEngine.onUnmountHeaderMenu = options.headerMenu?.unmountHeaderMenu;

	engine.getRenderStats = () => renderEngine.getRenderStats();
	engine.resetRenderStats = () => renderEngine.resetRenderStats();
	engine.getTheme = () => renderEngine.viewportRenderer.getTheme();
	engine.getThemeName = () => renderEngine.viewportRenderer.getThemeName();
	engine.getAvailableThemes = () => renderEngine.viewportRenderer.getThemeManager()?.getAvailableThemes() ?? [];
	engine.switchTheme = (themeName) => renderEngine.viewportRenderer.switchTheme(themeName);
	engine.mergeTheme = (partial) => renderEngine.viewportRenderer.mergeTheme(partial);
	engine.onThemeChange = (listener) => renderEngine.viewportRenderer.onThemeChange(listener);

	if (options.pins) {
		internalApi.setViewportPins(options.pins);
	}

	store.setContainerElement(container);
	renderEngine.mount(container);

	const observer = new ResizeObserver((entries) => {
		if (!entries || entries.length === 0) return;
		const { width, height } = entries[0].contentRect;
		if (internalApi.setViewportSize(width, height)) {
			internalApi.updateVisibleRanges();
			renderEngine.scheduleGeometryPaint('resize');
		}
	});
	observer.observe(container);

	const adapterHandle: GridAdapterHandle<TRowData> = {
		getCellPointerFromElement(element: Element) {
			const cellEl = element.closest('.og-cell') as HTMLElement | null;
			if (!cellEl) return null;
			const colField = cellEl.dataset.colField;
			const rowEl = cellEl.closest('.og-row') as HTMLElement | null;
			const rowIndex = Number(rowEl?.dataset.rowIndex);
			const visualRow = Number.isFinite(rowIndex) ? store.getVisualRow(rowIndex) : null;
			const rowId = visualRow?.kind === 'data' ? visualRow.rowId : undefined;
			if (!colField || !rowId) return null;
			return { rowId, colField };
		},
		getCellAccessFromElement(element: Element) {
			const pointer = adapterHandle.getCellPointerFromElement(element);
			if (!pointer) return null;
			return store.getCellAccess(pointer.rowId, pointer.colField);
		},
		getCellAccess(rowId: string, colField: string) {
			return store.getCellAccess(rowId, colField);
		},
		getGroupVisibleDescendantRowIds(groupId: string) {
			return store.getRowModel()?.getGroupMeta?.(groupId)?.visibleDescendantRowIds ?? [];
		},
		isImperativeRendererColumn(column) {
			return hasImperativeRendererCapability(column);
		},
	};

	return {
		setViewportPins(pins) {
			internalApi.setViewportPins(pins);
			internalApi.updateVisibleRanges();
			renderEngine.scheduleViewportPaint('pins');
			renderEngine.scheduleHeaderPaint('pins');
		},
		schedulePaint() {
			renderEngine.schedulePaint();
		},
		scheduleFullPaint(reason) {
			renderEngine.scheduleFullPaint(reason);
		},
		scheduleViewportPaint(reason) {
			renderEngine.scheduleViewportPaint(reason);
		},
		scheduleHeaderPaint(reason) {
			renderEngine.scheduleHeaderPaint(reason);
		},
		scheduleOverlayPaint(reason) {
			renderEngine.scheduleOverlayPaint(reason);
		},
		scheduleGeometryPaint(reason) {
			renderEngine.scheduleGeometryPaint(reason);
		},
		getRenderStats() {
			return renderEngine.getRenderStats();
		},
		resetRenderStats() {
			renderEngine.resetRenderStats();
		},
		setTheme(theme) {
			renderEngine.viewportRenderer.setTheme(theme);
		},
		switchTheme(themeName) {
			store.switchTheme(themeName);
		},
		getTheme() {
			return renderEngine.viewportRenderer.getTheme();
		},
		getThemeName() {
			return renderEngine.viewportRenderer.getThemeName();
		},
		getAvailableThemes() {
			return renderEngine.viewportRenderer.getThemeManager()?.getAvailableThemes() ?? [];
		},
		onThemeChange(listener) {
			return renderEngine.viewportRenderer.onThemeChange(listener);
		},
		destroy() {
			observer.disconnect();
			renderEngine.unmount();
			engine.getRenderStats = undefined;
			engine.resetRenderStats = undefined;
			engine.getTheme = undefined;
			engine.getThemeName = undefined;
			engine.getAvailableThemes = undefined;
			engine.switchTheme = undefined;
			engine.mergeTheme = undefined;
			engine.onThemeChange = undefined;
		},
		adapterHandle,
	};
}

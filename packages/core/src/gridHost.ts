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
import type { GridApi, GridCellAccess, GridCellPointer } from './api/GridApi.js';
import type { ColumnDef, InternalColumnDef } from './columnDef.js';
import { asGroupMetaCapableRowModel } from './rowModel.js';
import { resolveGridHostComposition } from './internal/apiInternalBridge.js';

export function hasImperativeRendererCapability<TRowData = unknown>(column: ColumnDef<TRowData>): boolean {
	const caps = (column as InternalColumnDef<TRowData>).cellRendererCapabilities;
	return caps?.scrollPresentation === 'live' && caps.live?.update === 'imperative';
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
	autoRowHeight?: boolean;
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
	getCellPointerFromElement(element: Element): GridCellPointer | null;
	/** Get full cell access data from a DOM element inside a cell. */
	getCellAccessFromElement(element: Element): GridCellAccess<TRowData> | null;
	/** Get full cell access data by row id and column field. */
	getCellAccess(rowId: string, colField: string): GridCellAccess<TRowData> | null;
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
	const host = resolveGridHostComposition(api);
	const engine = host.engine;
	const internalApi = host.api;
	const renderEngine = new RenderEngine(engine, internalApi);

	renderEngine.onMountCellContent = options.cellContent?.mountCellContent;
	renderEngine.onUnmountCellContent = options.cellContent?.unmountCellContent;
	renderEngine.portalMountManager.onFlushCellContent = options.cellContent?.flushCellContent;
	renderEngine.onMountRowContent = options.rowContent?.mountRowContent;
	renderEngine.onUnmountRowContent = options.rowContent?.unmountRowContent;
	renderEngine.onMountHeaderMenu = options.headerMenu?.mountHeaderMenu;
	renderEngine.onUnmountHeaderMenu = options.headerMenu?.unmountHeaderMenu;
	if (options.autoRowHeight) renderEngine.setAutoRowHeight(true);

	// Bind live runtime ports — exclusive: only one host may be active at a time.
	const bindResult = internalApi.bindRuntimePorts({
		renderer: {
			requestRender: () => {},
			getStats: () => renderEngine.getRenderStats(),
			resetStats: () => renderEngine.resetRenderStats(),
			getContainer: () => container,
			scrollCellIntoView: (rowId, colField) => renderEngine.scrollCellIntoView(rowId, colField),
			scrollRowIntoView: (rowId) => renderEngine.scrollRowIntoView(rowId),
		},
		theme: {
			getTheme: () => renderEngine.viewportRenderer.getTheme(),
			getThemeName: () => renderEngine.viewportRenderer.getThemeName(),
			getAvailableThemes: () => renderEngine.viewportRenderer.getThemeManager()?.getAvailableThemes() ?? [],
			switchTheme: (themeName) => renderEngine.viewportRenderer.switchTheme(themeName),
			mergeTheme: (partial) => {
				renderEngine.viewportRenderer.mergeTheme(partial);
				if ('leafHeaderHeight' in partial) {
					renderEngine.scheduleFullPaint('theme-layout');
				}
			},
			setTheme: (theme) => {
				renderEngine.viewportRenderer.setTheme(theme);
				// A full theme swap can change any token, including layout-affecting ones
				// (e.g. leafHeaderHeight) — always re-run layout, not just on mergeTheme's narrower check.
				renderEngine.scheduleFullPaint('theme-layout');
			},
			onThemeChange: (listener) => renderEngine.viewportRenderer.onThemeChange(listener),
		},
	});
	if (!bindResult.ok) {
		// Binding rejected — renderEngine was never mounted, so no DOM cleanup is needed.
		throw new Error(`mountGridHost: port binding rejected (${bindResult.reason}). Destroy the active host before mounting a new one.`);
	}
	const binding = bindResult.binding;

	if (options.pins) {
		internalApi.setViewportPins(options.pins);
	}

	host.setContainerElement(container);
	renderEngine.mount(container);

	const observer = new ResizeObserver((entries) => {
		if (!internalApi.isBindingCurrent(binding)) return;
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
			const visualRow = Number.isFinite(rowIndex) ? internalApi.getVisualRow(rowIndex) : null;
			const rowId = visualRow?.kind === 'data' ? visualRow.rowId : undefined;
			if (!colField || !rowId) return null;
			return { rowId, colField };
		},
		getCellAccessFromElement(element: Element) {
			const pointer = adapterHandle.getCellPointerFromElement(element);
			if (!pointer) return null;
			return internalApi.getCellAccess(pointer.rowId, pointer.colField);
		},
		getCellAccess(rowId: string, colField: string) {
			return internalApi.getCellAccess(rowId, colField);
		},
		getGroupVisibleDescendantRowIds(groupId: string) {
			return asGroupMetaCapableRowModel(internalApi.getRowModel())?.getGroupMeta(groupId)?.visibleDescendantRowIds ?? [];
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
			internalApi.switchTheme(themeName);
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
			internalApi.unbindRuntimePorts(binding);
		},
		adapterHandle,
	};
}

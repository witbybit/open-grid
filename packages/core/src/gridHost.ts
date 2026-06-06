import { getEngineFromApi, getInternalApiFromApi } from './apiBridge.js';
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
	destroy(): void;
}

export function mountGridHost<TRowData>(api: GridApi<TRowData>, container: HTMLElement, options: GridHostOptions<TRowData> = {}): GridHost {
	const engine = getEngineFromApi(api);
	const internalApi = getInternalApiFromApi(api);
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

	if (options.pins) {
		internalApi.setViewportPins(options.pins);
	}

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
		destroy() {
			observer.disconnect();
			renderEngine.unmount();
			engine.getRenderStats = undefined;
			engine.resetRenderStats = undefined;
		},
	};
}

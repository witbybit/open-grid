import { getEngineFromApi, getInternalApiFromApi } from './apiBridge.js';
import { RenderEngine } from './renderer/renderEngine.js';
import type { GridCellContentMount, GridCellContentUnmount, GridRowContentMount, GridRowContentUnmount, GridHeaderMenuMount, GridHeaderMenuUnmount } from './renderer/IGridRenderer.js';
import type { GridApi } from './store.js';

export interface GridCellContentAdapter<TRowData = unknown> {
	mountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	unmountCellContent?: (unmount: GridCellContentUnmount) => void;
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
	destroy(): void;
}

export function mountGridHost<TRowData>(api: GridApi<TRowData>, container: HTMLElement, options: GridHostOptions<TRowData> = {}): GridHost {
	const engine = getEngineFromApi(api);
	const internalApi = getInternalApiFromApi(api);
	const renderEngine = new RenderEngine(engine, internalApi);

	renderEngine.onMountCellContent = options.cellContent?.mountCellContent;
	renderEngine.onUnmountCellContent = options.cellContent?.unmountCellContent;
	renderEngine.onMountRowContent = options.rowContent?.mountRowContent;
	renderEngine.onUnmountRowContent = options.rowContent?.unmountRowContent;
	renderEngine.onMountHeaderMenu = options.headerMenu?.mountHeaderMenu;
	renderEngine.onUnmountHeaderMenu = options.headerMenu?.unmountHeaderMenu;

	if (options.pins) {
		internalApi.setViewportPins(options.pins);
	}

	renderEngine.mount(container);

	const observer = new ResizeObserver((entries) => {
		if (!entries || entries.length === 0) return;
		const { width, height } = entries[0].contentRect;
		if (internalApi.setViewportSize(width, height)) {
			internalApi.updateVisibleRanges();
			renderEngine.schedulePaint();
		}
	});
	observer.observe(container);

	return {
		setViewportPins(pins) {
			internalApi.setViewportPins(pins);
			internalApi.updateVisibleRanges();
			renderEngine.schedulePaint();
		},
		schedulePaint() {
			renderEngine.schedulePaint();
		},
		destroy() {
			observer.disconnect();
			renderEngine.unmount();
		},
	};
}

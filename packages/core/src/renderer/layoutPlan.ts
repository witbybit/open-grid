import type { GridEngine } from '../engine/GridEngine.js';
import { computeRenderWindow, type RenderWindow, type StickyGroupStackItem } from './renderWindow.js';

export const LEAF_HEADER_HEIGHT = 40;
export const GROUP_PANEL_HEIGHT = 42;
export const COLUMN_GROUP_HEADER_HEIGHT = 0;

export interface GridLayoutPlan {
	viewport: {
		width: number;
		height: number;
		scrollTop: number;
		scrollLeft: number;
	};
	dimensions: {
		totalRowsHeight: number;
		totalColumnsWidth: number;
		contentWidth: number;
		contentHeight: number;
	};
	chrome: {
		groupPanelHeight: number;
		columnGroupHeaderHeight: number;
		leafHeaderHeight: number;
		totalHeaderHeight: number;
		topChromeHeight: number;
	};
	rows: {
		rowStart: number;
		rowEnd: number;
		pinnedTopCount: number;
		pinnedBottomCount: number;
		pinnedTopHeight: number;
		pinnedBottomHeight: number;
		visibleTop: number;
		visibleBottom: number;
		bufferTopPx: number;
		bufferBottomPx: number;
	};
	columns: {
		colStart: number;
		colEnd: number;
		pinLeftCount: number;
		pinRightCount: number;
		pinLeftWidth: number;
		pinRightWidth: number;
		centerWidth: number;
	};
	origins: {
		headerTop: number;
		rowLayerTop: number;
		stickyGroupLayerTop: number;
		overlayTop: number;
	};
	stickyGroups: StickyGroupStackItem[];
	renderWindow: RenderWindow;
}

export function computeGridLayoutPlan<TRowData>(engine: GridEngine<TRowData>, renderWindow = computeRenderWindow(engine)): GridLayoutPlan {
	const state = engine.stateManager.getState();
	const viewportWidth = engine.viewport.viewportWidth;
	const viewportHeight = engine.viewport.viewportHeight;
	const totalRowsHeight = engine.geometry.getTotalHeight(state.defaultRowHeight);
	const totalColumnsWidth = engine.geometry.getTotalWidth(state.defaultColWidth);
	const contentWidth = Math.max(totalColumnsWidth, viewportWidth);
	const groupPanelHeight = state.showGroupPanel ? GROUP_PANEL_HEIGHT : 0;
	const columnGroupHeaderHeight = COLUMN_GROUP_HEADER_HEIGHT;
	const leafHeaderHeight = LEAF_HEADER_HEIGHT;
	const totalHeaderHeight = columnGroupHeaderHeight + leafHeaderHeight;
	const topChromeHeight = groupPanelHeight + totalHeaderHeight;
	const pinLeftCount = Math.min(engine.viewport.pinLeftColumns, renderWindow.colCount);
	const pinRightCount = Math.min(engine.viewport.pinRightColumns, Math.max(0, renderWindow.colCount - pinLeftCount));
	const firstRightPinColIdx = Math.max(pinLeftCount, renderWindow.colCount - pinRightCount);
	const pinLeftWidth = pinLeftCount > 0 ? engine.geometry.colLefts[pinLeftCount] || 0 : 0;
	const pinRightWidth =
		pinRightCount > 0 && firstRightPinColIdx < renderWindow.colCount
			? totalColumnsWidth - (engine.geometry.colLefts[firstRightPinColIdx] || totalColumnsWidth)
			: 0;

	let pinnedTopHeight = 0;
	for (let i = 0; i < renderWindow.pinTopRows && i < renderWindow.rowCount; i++) {
		pinnedTopHeight += engine.geometry.getRowHeight(i, state.defaultRowHeight);
	}
	let pinnedBottomHeight = 0;
	for (let i = 0; i < renderWindow.pinBottomRows && i < renderWindow.rowCount; i++) {
		pinnedBottomHeight += engine.geometry.getRowHeight(renderWindow.rowCount - 1 - i, state.defaultRowHeight);
	}

	return {
		viewport: {
			width: viewportWidth,
			height: viewportHeight,
			scrollTop: engine.viewport.scrollTop,
			scrollLeft: engine.viewport.scrollLeft,
		},
		dimensions: {
			totalRowsHeight,
			totalColumnsWidth,
			contentWidth,
			contentHeight: totalRowsHeight,
		},
		chrome: {
			groupPanelHeight,
			columnGroupHeaderHeight,
			leafHeaderHeight,
			totalHeaderHeight,
			topChromeHeight,
		},
		rows: {
			rowStart: renderWindow.rowStart,
			rowEnd: renderWindow.rowEnd,
			pinnedTopCount: renderWindow.pinTopRows,
			pinnedBottomCount: renderWindow.pinBottomRows,
			pinnedTopHeight,
			pinnedBottomHeight,
			visibleTop: renderWindow.visibleTop ?? engine.viewport.scrollTop + pinnedTopHeight,
			visibleBottom: renderWindow.visibleBottom ?? engine.viewport.scrollTop + viewportHeight - pinnedBottomHeight,
			bufferTopPx: renderWindow.bufferTopPx ?? 0,
			bufferBottomPx: renderWindow.bufferBottomPx ?? totalRowsHeight,
		},
		columns: {
			colStart: renderWindow.colStart,
			colEnd: renderWindow.colEnd,
			pinLeftCount,
			pinRightCount,
			pinLeftWidth,
			pinRightWidth,
			centerWidth: Math.max(0, viewportWidth - pinLeftWidth - pinRightWidth),
		},
		origins: {
			headerTop: groupPanelHeight,
			rowLayerTop: topChromeHeight,
			stickyGroupLayerTop: topChromeHeight,
			overlayTop: topChromeHeight,
		},
		stickyGroups: renderWindow.stickyGroupStack ?? [],
		renderWindow,
	};
}

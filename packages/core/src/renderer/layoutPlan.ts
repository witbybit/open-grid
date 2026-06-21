import type { GridEngine } from '../engine/GridEngine.js';
import { computeRenderWindow, type RenderWindow, type StickyGroupStackItem } from './renderWindow.js';
import type { InternalColumnDef } from '../columnDef.js';
import { compileColumnTopology, type CompiledColumnTopology } from './columnTopology.js';

export const LEAF_HEADER_HEIGHT = 40;
export const GROUP_PANEL_HEIGHT = 42;
export const FILTER_CHIP_BAR_HEIGHT = 32;
export const GROUP_BAND_HEIGHT = 32;
export const STATUS_BAR_HEIGHT = 32;
export const PAGINATION_HEIGHT = 44;
export const FLOATING_FILTER_HEIGHT = 36;

export interface HeaderCellLayout {
	id: string;
	field: string;
	label: string;
	depth: number;
	colStart: number;
	colEnd: number;
	left: number;
	width: number;
	top: number;
	height: number;
	pinned: 'left' | 'center' | 'right';
	isLeaf: boolean;
	movable: boolean;
	resizable: boolean;
	sortable: boolean;
	checkboxSelection: boolean;
}

export interface HeaderBandLayout {
	depth: number;
	top: number;
	height: number;
	cells: HeaderCellLayout[];
}

/**
 * One horizontal pin lane. `baseLeft` is the absolute X (in content coordinates) where
 * the lane's columns begin — the single value used to convert an absolute `colLefts[c]`
 * into a lane-relative offset. Header and body both read this so they cannot drift, and
 * a pin/unpin animation has one geometry to interpolate.
 */
export interface ColumnLane {
	width: number;
	baseLeft: number;
	/** First/last displayed column index in this lane, or -1 when the lane is empty. */
	colStart: number;
	colEnd: number;
}

export interface ColumnLanes {
	left: ColumnLane;
	center: ColumnLane;
	right: ColumnLane;
}

export interface GridLayoutPlan {
	viewport: {
		width: number;
		clientWidth: number;
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
		filterChipBarHeight: number;
		columnGroupHeaderHeight: number;
		leafHeaderHeight: number;
		totalHeaderHeight: number;
		/** Height of the floating filter row in px. 0 when showFloatingFilters is false. */
		floatingFilterHeight: number;
		topChromeHeight: number;
		// Bottom chrome — fixed bars docked below the scroll viewport. Default 0 when
		// no status bar / pagination is configured (no layout change vs. top-only era).
		statusBarHeight: number;
		paginationHeight: number;
		bottomChromeHeight: number;
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
		lanes: ColumnLanes;
	};
	origins: {
		headerTop: number;
		rowLayerTop: number;
		stickyGroupLayerTop: number;
		overlayTop: number;
		// Bottom chrome origins, measured from the top of the grid container.
		// bottomChromeTop = viewport.height - bottomChromeHeight.
		bottomChromeTop: number;
		statusBarTop: number;
		paginationTop: number;
	};
	headerBands: HeaderBandLayout[];
	stickyGroups: StickyGroupStackItem[];
	renderWindow: RenderWindow;
	/** Authoritative column topology: lane membership, lane-relative offsets, group segments. */
	columnTopology: CompiledColumnTopology;
}

export function getRightPinnedLaneScreenLeft(layoutPlan: GridLayoutPlan): number {
	return layoutPlan.viewport.clientWidth - layoutPlan.columns.lanes.right.width;
}

/**
 * Builds HeaderBandLayout[] from the compiled column topology (WS10).
 * All `left` values are lane-relative offsets — the renderer uses them directly
 * without any per-lane subtraction.
 */
function buildHeaderBands<TRowData>(
	topology: CompiledColumnTopology,
	columns: readonly InternalColumnDef<TRowData>[],
	leafHeaderHeight: number,
	enableColumnReorder: boolean,
	defaultColWidth: number
): HeaderBandLayout[] {
	const maxGroupDepth = topology.groupSegments.length;
	const groupBandsHeight = maxGroupDepth * GROUP_BAND_HEIGHT;
	const leafBandTop = groupBandsHeight;

	// Leaf band — laneOffset is already lane-relative for all three lanes.
	const leafCells: HeaderCellLayout[] = topology.placements.map((placement) => {
		const col = columns[placement.absoluteIndex];
		return {
			id: placement.columnId,
			field: placement.columnId,
			label: col.header ?? col.field,
			depth: maxGroupDepth,
			colStart: placement.absoluteIndex,
			colEnd: placement.absoluteIndex,
			left: placement.laneOffset,
			width: placement.width || defaultColWidth,
			top: leafBandTop,
			height: leafHeaderHeight,
			pinned: placement.lane,
			isLeaf: true,
			movable: enableColumnReorder && col.movable !== false && !col.checkboxSelection,
			resizable: true,
			sortable: col.sortable !== false && !col.checkboxSelection,
			checkboxSelection: !!col.checkboxSelection,
		};
	});

	if (maxGroupDepth === 0) {
		return [{ depth: 0, top: 0, height: leafHeaderHeight, cells: leafCells }];
	}

	const bands: HeaderBandLayout[] = [];

	// Group bands from pre-computed topology segments (also lane-relative).
	for (let d = 0; d < maxGroupDepth; d++) {
		const bandTop = d * GROUP_BAND_HEIGHT;
		const segments = topology.groupSegments[d];
		if (!segments || segments.length === 0) continue;

		const cells: HeaderCellLayout[] = segments.map((seg) => ({
			id: seg.id,
			field: '',
			label: seg.label,
			depth: d,
			colStart: seg.colStart,
			colEnd: seg.colEnd,
			left: seg.laneOffset,
			width: seg.width,
			top: bandTop,
			height: GROUP_BAND_HEIGHT,
			pinned: seg.lane,
			isLeaf: false,
			movable: false,
			resizable: false,
			sortable: false,
			checkboxSelection: false,
		}));

		bands.push({ depth: d, top: bandTop, height: GROUP_BAND_HEIGHT, cells });
	}

	bands.push({ depth: maxGroupDepth, top: leafBandTop, height: leafHeaderHeight, cells: leafCells });

	return bands;
}

export function computeGridLayoutPlan<TRowData>(engine: GridEngine<TRowData>, renderWindow = computeRenderWindow(engine)): GridLayoutPlan {
	const state = engine.stateManager.getState();
	const columnPlan = engine.columns.getCompiledPlan();
	const viewportWidth = engine.viewport.viewportWidth;
	const viewportClientWidth = engine.viewport.scrollViewportClientWidth || viewportWidth;
	const viewportHeight = engine.viewport.viewportHeight;
	const totalRowsHeight = engine.geometry.getTotalHeight(state.defaultRowHeight);
	const totalColumnsWidth = columnPlan.totalWidth;
	const contentWidth = Math.max(totalColumnsWidth, viewportWidth);
	const groupPanelHeight = state.showGroupPanel ? GROUP_PANEL_HEIGHT : 0;
	const filterChipBarHeight =
		state.showFilterChipBar && state.filterModel && Object.keys(state.filterModel).length > 0 ? FILTER_CHIP_BAR_HEIGHT : 0;
	const leafHeaderHeight = LEAF_HEADER_HEIGHT;
	const pinLeftCount = Math.min(engine.viewport.pinLeftColumns, renderWindow.colCount);
	const pinRightCount = Math.min(engine.viewport.pinRightColumns, Math.max(0, renderWindow.colCount - pinLeftCount));
	const firstRightPinColIdx = Math.max(pinLeftCount, renderWindow.colCount - pinRightCount);
	const pinLeftWidth = pinLeftCount > 0 ? engine.geometry.colLefts[pinLeftCount] || 0 : 0;
	const pinRightWidth =
		pinRightCount > 0 && firstRightPinColIdx < renderWindow.colCount
			? totalColumnsWidth - (engine.geometry.colLefts[firstRightPinColIdx] || totalColumnsWidth)
			: 0;

	const columnTopology = compileColumnTopology(columnPlan);

	const headerBands = buildHeaderBands(
		columnTopology,
		columnPlan.displayedColumns,
		leafHeaderHeight,
		state.enableColumnReorder ?? true,
		state.defaultColWidth
	);

	// totalHeaderHeight = sum of all band heights (group bands + leaf band)
	const lastBand = headerBands[headerBands.length - 1];
	const totalHeaderHeight = lastBand ? lastBand.top + lastBand.height : leafHeaderHeight;
	const columnGroupHeaderHeight = totalHeaderHeight - leafHeaderHeight;
	const floatingFilterHeight = state.showFloatingFilters ? FLOATING_FILTER_HEIGHT : 0;
	const topChromeHeight = groupPanelHeight + filterChipBarHeight + totalHeaderHeight + floatingFilterHeight;

	// Bottom chrome — status bar + pagination bar. Config-gated: when absent both heights
	// resolve to 0. Heights come from constants, never magic literals.
	const statusBarHeight = state.showStatusBar ? STATUS_BAR_HEIGHT : 0;
	const paginationHeight = state.pagination ? PAGINATION_HEIGHT : 0;
	const bottomChromeHeight = statusBarHeight + paginationHeight;
	const bottomChromeTop = Math.max(0, viewportHeight - bottomChromeHeight);
	// Pagination sits below the status bar within the bottom chrome stack.
	const statusBarTop = bottomChromeTop;
	const paginationTop = bottomChromeTop + statusBarHeight;

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
			clientWidth: viewportClientWidth,
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
			filterChipBarHeight,
			columnGroupHeaderHeight,
			leafHeaderHeight,
			totalHeaderHeight,
			floatingFilterHeight,
			topChromeHeight,
			statusBarHeight,
			paginationHeight,
			bottomChromeHeight,
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
			centerWidth: Math.max(0, viewportClientWidth - pinLeftWidth - pinRightWidth),
			lanes: {
				left: {
					width: pinLeftWidth,
					baseLeft: 0,
					colStart: pinLeftCount > 0 ? 0 : -1,
					colEnd: pinLeftCount > 0 ? pinLeftCount - 1 : -1,
				},
				center: {
					width: Math.max(0, viewportClientWidth - pinLeftWidth - pinRightWidth),
					baseLeft: pinLeftWidth,
					colStart: firstRightPinColIdx > pinLeftCount ? pinLeftCount : -1,
					colEnd: firstRightPinColIdx > pinLeftCount ? firstRightPinColIdx - 1 : -1,
				},
				right: {
					width: pinRightWidth,
					// Absolute X where right-pinned columns begin. The sole source for the
					// `colLefts[c] - baseLeft` lane-relative conversion done by header + body.
					baseLeft: totalColumnsWidth - pinRightWidth,
					colStart: pinRightCount > 0 ? firstRightPinColIdx : -1,
					colEnd: pinRightCount > 0 ? renderWindow.colCount - 1 : -1,
				},
			},
		},
		origins: {
			headerTop: groupPanelHeight + filterChipBarHeight,
			rowLayerTop: topChromeHeight,
			stickyGroupLayerTop: topChromeHeight,
			overlayTop: topChromeHeight,
			bottomChromeTop,
			statusBarTop,
			paginationTop,
		},
		headerBands,
		stickyGroups: renderWindow.stickyGroupStack ?? [],
		renderWindow,
		columnTopology,
	};
}

import type { GridEngine } from '../engine/GridEngine.js';
import { computeRenderWindow, type RenderWindow, type StickyGroupStackItem } from './renderWindow.js';
import type { InternalColumnDef } from '../columnDef.js';

export const LEAF_HEADER_HEIGHT = 40;
export const GROUP_PANEL_HEIGHT = 42;
export const GROUP_BAND_HEIGHT = 32;
export const STATUS_BAR_HEIGHT = 32;
export const PAGINATION_HEIGHT = 44;

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
	checkboxSelection: boolean;
}

export interface HeaderBandLayout {
	depth: number;
	top: number;
	height: number;
	cells: HeaderCellLayout[];
}

/**
 * One horizontal pin lane (Plan 039 Phase 4). `baseLeft` is the absolute X (in content
 * coordinates) where the lane's columns begin — the single value used to convert an
 * absolute `colLefts[c]` into a lane-relative offset. Header and body both read this so
 * they cannot drift, and a pin/unpin animation has one geometry to interpolate.
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
}

function normalizeHeaderGroups(headerGroup: string | string[] | undefined): string[] {
	if (!headerGroup) return [];
	return Array.isArray(headerGroup) ? headerGroup : [headerGroup];
}

function buildHeaderBands<TRowData>(
	columns: InternalColumnDef<TRowData>[],
	colLefts: ArrayLike<number>,
	colWidths: ArrayLike<number>,
	totalColumnsWidth: number,
	pinLeftCount: number,
	firstRightPinColIdx: number,
	leafHeaderHeight: number,
	enableColumnReorder: boolean,
	defaultColWidth: number
): HeaderBandLayout[] {
	const colCount = columns.length;

	// Compute max group depth across all columns
	let maxGroupDepth = 0;
	for (let c = 0; c < colCount; c++) {
		const groups = normalizeHeaderGroups(columns[c].headerGroup);
		if (groups.length > maxGroupDepth) maxGroupDepth = groups.length;
	}

	const groupBandsHeight = maxGroupDepth * GROUP_BAND_HEIGHT;
	const leafBandTop = groupBandsHeight;

	// Build leaf band
	const leafCells: HeaderCellLayout[] = columns.map((column, colIndex) => {
		const pinned: 'left' | 'center' | 'right' = colIndex < pinLeftCount ? 'left' : colIndex >= firstRightPinColIdx ? 'right' : 'center';
		return {
			id: column.field,
			field: column.field,
			label: column.header ?? column.field,
			depth: maxGroupDepth,
			colStart: colIndex,
			colEnd: colIndex,
			left: colLefts[colIndex] ?? 0,
			width: colWidths[colIndex] ?? defaultColWidth,
			top: leafBandTop,
			height: leafHeaderHeight,
			pinned,
			isLeaf: true,
			movable: enableColumnReorder && column.movable !== false && !column.checkboxSelection,
			resizable: true,
			checkboxSelection: !!column.checkboxSelection,
		};
	});

	if (maxGroupDepth === 0) {
		return [{ depth: 0, top: 0, height: leafHeaderHeight, cells: leafCells }];
	}

	const bands: HeaderBandLayout[] = [];

	// Build one band per group depth level
	for (let d = 0; d < maxGroupDepth; d++) {
		const bandTop = d * GROUP_BAND_HEIGHT;
		const cells: HeaderCellLayout[] = [];
		let i = 0;

		while (i < colCount) {
			const groups = normalizeHeaderGroups(columns[i].headerGroup);
			const groupName = groups[d];

			if (!groupName) {
				// Column has no group at this depth — skip it in this band
				i++;
				continue;
			}

			const pinned: 'left' | 'center' | 'right' = i < pinLeftCount ? 'left' : i >= firstRightPinColIdx ? 'right' : 'center';

			// Extend the span as long as: same group name, same pin zone, and column has a group at this depth
			let j = i + 1;
			while (j < colCount) {
				const nextGroups = normalizeHeaderGroups(columns[j].headerGroup);
				const nextGroupName = nextGroups[d];
				const nextPinned: 'left' | 'center' | 'right' = j < pinLeftCount ? 'left' : j >= firstRightPinColIdx ? 'right' : 'center';
				if (nextGroupName !== groupName || nextPinned !== pinned) break;
				j++;
			}

			// j is one past the last column in this span
			const left = colLefts[i] ?? 0;
			const rightEdge = j < colCount ? (colLefts[j] ?? totalColumnsWidth) : totalColumnsWidth;
			const width = rightEdge - left;

			cells.push({
				id: `grp-${d}-${i}`,
				field: '',
				label: groupName,
				depth: d,
				colStart: i,
				colEnd: j - 1,
				left,
				width,
				top: bandTop,
				height: GROUP_BAND_HEIGHT,
				pinned,
				isLeaf: false,
				movable: false,
				resizable: false,
				checkboxSelection: false,
			});

			i = j;
		}

		if (cells.length > 0) {
			bands.push({ depth: d, top: bandTop, height: GROUP_BAND_HEIGHT, cells });
		}
	}

	// Leaf band goes last
	bands.push({ depth: maxGroupDepth, top: leafBandTop, height: leafHeaderHeight, cells: leafCells });

	return bands;
}

export function computeGridLayoutPlan<TRowData>(engine: GridEngine<TRowData>, renderWindow = computeRenderWindow(engine)): GridLayoutPlan {
	const state = engine.stateManager.getState();
	const columnPlan = engine.columns.getCompiledPlan();
	const viewportWidth = engine.viewport.viewportWidth;
	const viewportHeight = engine.viewport.viewportHeight;
	const totalRowsHeight = engine.geometry.getTotalHeight(state.defaultRowHeight);
	const totalColumnsWidth = columnPlan.totalWidth;
	const contentWidth = Math.max(totalColumnsWidth, viewportWidth);
	const groupPanelHeight = state.showGroupPanel ? GROUP_PANEL_HEIGHT : 0;
	const leafHeaderHeight = LEAF_HEADER_HEIGHT;
	const pinLeftCount = Math.min(engine.viewport.pinLeftColumns, renderWindow.colCount);
	const pinRightCount = Math.min(engine.viewport.pinRightColumns, Math.max(0, renderWindow.colCount - pinLeftCount));
	const firstRightPinColIdx = Math.max(pinLeftCount, renderWindow.colCount - pinRightCount);
	const pinLeftWidth = pinLeftCount > 0 ? engine.geometry.colLefts[pinLeftCount] || 0 : 0;
	const pinRightWidth =
		pinRightCount > 0 && firstRightPinColIdx < renderWindow.colCount
			? totalColumnsWidth - (engine.geometry.colLefts[firstRightPinColIdx] || totalColumnsWidth)
			: 0;

	const headerBands = buildHeaderBands(
		columnPlan.displayedColumns,
		columnPlan.colLefts,
		columnPlan.colWidths,
		totalColumnsWidth,
		pinLeftCount,
		firstRightPinColIdx,
		leafHeaderHeight,
		state.enableColumnReorder ?? true,
		state.defaultColWidth
	);

	// totalHeaderHeight = sum of all band heights (group bands + leaf band)
	const lastBand = headerBands[headerBands.length - 1];
	const totalHeaderHeight = lastBand ? lastBand.top + lastBand.height : leafHeaderHeight;
	const columnGroupHeaderHeight = totalHeaderHeight - leafHeaderHeight;
	const topChromeHeight = groupPanelHeight + totalHeaderHeight;

	// Bottom chrome — status bar + pagination bar. These are config-gated; until the
	// config lands (Plan 039 Phase 5) both heights resolve to 0 and the layout is
	// identical to the top-only era. Heights come from constants, never magic literals.
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
			centerWidth: Math.max(0, viewportWidth - pinLeftWidth - pinRightWidth),
			lanes: {
				left: {
					width: pinLeftWidth,
					baseLeft: 0,
					colStart: pinLeftCount > 0 ? 0 : -1,
					colEnd: pinLeftCount > 0 ? pinLeftCount - 1 : -1,
				},
				center: {
					width: Math.max(0, viewportWidth - pinLeftWidth - pinRightWidth),
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
			headerTop: groupPanelHeight,
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
	};
}

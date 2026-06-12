import { computeScrollTarget } from './scrollIntoView.js';
import { computeGridLayoutPlan, type GridLayoutPlan } from './layoutPlan.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { RenderRuntimeStats } from './renderTelemetry.js';
import type { RenderWindow } from './renderWindow.js';
import type { RowRenderer } from './rowRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { ScrollEngine } from './scrollEngine.js';
import type { ViewportRenderer } from './viewportRenderer.js';

export interface RenderViewportCoordinatorDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	viewportRenderer: ViewportRenderer<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	scrollEngine: ScrollEngine<TRowData>;
	renderStats: RenderRuntimeStats;
}

export class RenderViewportCoordinator<TRowData = unknown> {
	constructor(private readonly deps: RenderViewportCoordinatorDeps<TRowData>) {}

	public syncLayoutPlan(renderWindow?: RenderWindow): GridLayoutPlan {
		const layoutPlan = computeGridLayoutPlan(this.deps.engine, renderWindow);
		this.deps.viewportRenderer.syncLayoutPlan(layoutPlan);
		return layoutPlan;
	}

	public recycleViewport(isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow): void {
		this.deps.renderStats.viewportRecycles++;
		this.deps.rowRenderer.recycleViewport(isScrollFrameActive, ctx, precomputedWindow);
	}

	public scrollCellIntoView(rowId: string, colField: string): void {
		this.deps.rowRenderer.programmaticScrollCell = { rowId, colField };
		const scrollViewport = this.deps.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;

		const rowModel = this.deps.engine.getRowModel();
		if (!rowModel) return;

		const rowIndex = rowModel.getVisualIndexByRowId(rowId);
		const colIndex = this.deps.engine.columns.getColumnIndex(colField);
		if (rowIndex === null || rowIndex === -1 || colIndex === -1) return;

		const layoutPlan = this.deps.viewportRenderer.getLayoutPlan() ?? this.syncLayoutPlan();
		const target = computeScrollTarget({
			rowIndex,
			colIndex,
			rowCount: rowModel.getVisualRowCount(),
			colCount: this.deps.engine.columns.getDisplayedColumnCount(),
			pinLeftColumns: this.deps.engine.viewport.pinLeftColumns,
			pinRightColumns: this.deps.engine.viewport.pinRightColumns,
			pinTopRows: this.deps.engine.viewport.pinTopRows,
			pinBottomRows: this.deps.engine.viewport.pinBottomRows,
			scrollTop: this.deps.engine.viewport.scrollTop,
			scrollLeft: this.deps.engine.viewport.scrollLeft,
			viewportHeight: this.deps.engine.viewport.viewportHeight,
			viewportWidth: this.deps.engine.viewport.viewportWidth,
			topChromeHeight: layoutPlan.chrome.topChromeHeight,
			rowTops: this.deps.engine.geometry.rowTops,
			rowHeights: this.deps.engine.geometry.rowHeights,
			colLefts: this.deps.engine.geometry.colLefts,
			colWidths: this.deps.engine.geometry.colWidths,
			scrollViewportScrollHeight: scrollViewport.scrollHeight,
			scrollViewportScrollWidth: scrollViewport.scrollWidth,
			scrollViewportClientHeight: scrollViewport.clientHeight,
			scrollViewportClientWidth: scrollViewport.clientWidth,
		});

		if (target) {
			this.deps.scrollEngine.scrollTo(target.top, target.left);
			this.deps.engine.viewport.setScrollPosition(target.top, target.left);
		}
	}
}

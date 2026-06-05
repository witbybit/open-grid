import type { InvalidationFrame } from './invalidationManager.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { ColumnInteractionController } from './columnInteractionController.js';
import type { FillDragController, OverlayBox } from './fillDragController.js';

export class OverlayRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly viewportRenderer: ViewportRenderer<TRowData>;
	private readonly columnInteractionsGetter: () => ColumnInteractionController<TRowData>;
	private readonly fillDragGetter: () => FillDragController<TRowData>;

	private selectionBorder: HTMLDivElement | null = null;
	public selectionDragBounds: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null = null;
	public overlayDirtyDuringScroll = false;
	public renderStats: any = null;

	constructor(
		engine: GridEngine<TRowData>,
		viewportRenderer: ViewportRenderer<TRowData>,
		columnInteractionsGetter: () => ColumnInteractionController<TRowData>,
		fillDragGetter: () => FillDragController<TRowData>
	) {
		this.engine = engine;
		this.viewportRenderer = viewportRenderer;
		this.columnInteractionsGetter = columnInteractionsGetter;
		this.fillDragGetter = fillDragGetter;
	}

	public mount(): void {
		this.selectionDragBounds = null;
		if (this.selectionBorder) {
			this.selectionBorder.remove();
			this.selectionBorder = null;
		}
	}

	public unmount(): void {
		this.hideSelectionOverlay();
		if (this.selectionBorder) {
			this.selectionBorder.remove();
			this.selectionBorder = null;
		}
	}

	public sync(frame: InvalidationFrame): void {
		this.paintOverlay();
	}

	public repaintOverlay(): void {
		this.paintOverlay();
	}

	public syncScrollPosition(): void {
		if (this.hasVisibleSelectionOverlay()) {
			this.overlayDirtyDuringScroll = true;
		}
	}

	public syncPosition(): void {
		this.syncScrollPosition();
	}

	public paintOverlay(): void {
		const isScrolling = this.renderStats && this.renderStats.isScrolling;
		if (isScrolling && this.renderStats) {
			this.renderStats.overlayPaintsDuringScroll++;
		}
		if (!this.viewportRenderer.overlayLayer) return;

		this.columnInteractionsGetter().reattachOverlays();

		const state = this.engine.stateManager.getState();
		const bounds = state.selection.bounds;

		if (!bounds || !this.engine.getRowModel()) {
			this.hideSelectionOverlay();
			return;
		}

		const rowModel = this.engine.getRowModel()!;
		const rowCount = rowModel.getVisualRowCount();
		const colCount = this.engine.columns.getDisplayedColumnCount();

		const minRow = Math.max(0, bounds.minRow);
		const maxRow = Math.min(rowCount - 1, bounds.maxRow);
		const minCol = Math.max(0, bounds.minCol);
		const maxCol = Math.min(colCount - 1, bounds.maxCol);

		if (minRow > maxRow || minCol > maxCol) {
			this.hideSelectionOverlay();
			return;
		}

		const box = this.getClampedOverlayBox(minRow, maxRow, minCol, maxCol);
		if (!box) {
			this.hideSelectionOverlay();
			return;
		}

		const selectionBorder = this.ensureSelectionBorder();
		this.selectionDragBounds = { minRow, maxRow, minCol, maxCol };

		selectionBorder.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
		selectionBorder.style.width = `${box.width}px`;
		selectionBorder.style.height = `${box.height}px`;
		selectionBorder.style.display = 'block';

		if (selectionBorder.parentNode !== this.viewportRenderer.overlayLayer) {
			this.viewportRenderer.overlayLayer.appendChild(selectionBorder);
		}

		this.fillDragGetter().reattachPreview();
	}

	public hasVisibleSelectionOverlay(): boolean {
		const state = this.engine.stateManager.getState();
		return !!state.selection.bounds && !!this.engine.getRowModel();
	}

	public getClampedOverlayBox(minRow: number, maxRow: number, minCol: number, maxCol: number): OverlayBox | null {
		const state = this.engine.stateManager.getState();
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const colCount = this.engine.columns.getDisplayedColumnCount();

		if (rowCount === 0 || colCount === 0 || minRow < 0 || minCol < 0 || maxRow >= rowCount || maxCol >= colCount) {
			return null;
		}

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;
		const scrollTop = this.engine.viewport.scrollTop;
		const scrollLeft = this.engine.viewport.scrollLeft;
		const viewportHeight = this.engine.viewport.viewportHeight;
		const viewportWidth = this.engine.viewport.viewportWidth;

		let pinnedLeftWidth = 0;
		for (let i = 0; i < pinLeftColumns && i < colCount; i++) {
			pinnedLeftWidth += this.engine.geometry.colWidths[i] || 0;
		}

		let pinnedRightWidth = 0;
		for (let i = 0; i < pinRightColumns && i < colCount; i++) {
			pinnedRightWidth += this.engine.geometry.colWidths[colCount - 1 - i] || 0;
		}

		let pinnedTopHeight = 0;
		for (let i = 0; i < pinTopRows && i < rowCount; i++) {
			pinnedTopHeight += this.engine.geometry.rowHeights[i] || 0;
		}

		let pinnedBottomHeight = 0;
		for (let i = 0; i < pinBottomRows && i < rowCount; i++) {
			pinnedBottomHeight += this.engine.geometry.rowHeights[rowCount - 1 - i] || 0;
		}

		const getClampedX = (c: number): { left: number; right: number } => {
			const cellLeft = this.engine.geometry.colLefts[c] || 0;
			const cellWidth = this.engine.geometry.colWidths[c] || 0;

			if (c < pinLeftColumns) {
				return { left: cellLeft, right: cellLeft + cellWidth };
			}
			if (c >= colCount - pinRightColumns) {
				const firstRightPinColIdx = colCount - pinRightColumns;
				const firstRightPinColLeft = this.engine.geometry.colLefts[firstRightPinColIdx] || 0;
				const left = viewportWidth - pinnedRightWidth + (cellLeft - firstRightPinColLeft);
				return { left, right: left + cellWidth };
			}

			const unclippedLeft = cellLeft - scrollLeft;
			const unclippedRight = unclippedLeft + cellWidth;
			const left = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedLeft));
			const right = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedRight));
			return { left, right };
		};

		const getClampedY = (r: number): { top: number; bottom: number } => {
			const rowTop = this.engine.geometry.rowTops[r] || 0;
			const rowHeight = this.engine.geometry.rowHeights[r] || 0;

			if (r < pinTopRows) {
				return { top: rowTop, bottom: rowTop + rowHeight };
			}
			if (r >= rowCount - pinBottomRows) {
				const totalHeight = this.engine.geometry.getTotalHeight(state.defaultRowHeight);
				const bottomOffset = totalHeight - rowTop;
				const top = viewportHeight - 40 - bottomOffset;
				return { top, bottom: top + rowHeight };
			}

			const unclippedTop = rowTop - scrollTop;
			const unclippedBottom = unclippedTop + rowHeight;
			const top = Math.max(pinnedTopHeight, Math.min(viewportHeight - 40 - pinnedBottomHeight, unclippedTop));
			const bottom = Math.max(pinnedTopHeight, Math.min(viewportHeight - 40 - pinnedBottomHeight, unclippedBottom));
			return { top, bottom };
		};

		const xRangeMin = getClampedX(minCol);
		const xRangeMax = getClampedX(maxCol);
		const yRangeMin = getClampedY(minRow);
		const yRangeMax = getClampedY(maxRow);
		const width = xRangeMax.right - xRangeMin.left;
		const height = yRangeMax.bottom - yRangeMin.top;

		if (width <= 0 || height <= 0) {
			return null;
		}

		return { left: xRangeMin.left, top: yRangeMin.top, width, height };
	}

	public ensureSelectionBorder(): HTMLDivElement {
		if (!this.selectionBorder) {
			this.selectionBorder = document.createElement('div');
			this.selectionBorder.className = 'og-selection-border';

			const fillHandle = document.createElement('div');
			fillHandle.className = 'og-selection-fill-handle';
			fillHandle.addEventListener('mousedown', this.onSelectionFillHandleMouseDown);
			this.selectionBorder.appendChild(fillHandle);
		}

		return this.selectionBorder;
	}

	public hideSelectionOverlay(): void {
		this.selectionDragBounds = null;
		if (this.selectionBorder) {
			this.selectionBorder.style.display = 'none';
		}
	}

	private onSelectionFillHandleMouseDown = (e: MouseEvent): void => {
		if (!this.selectionDragBounds) return;
		e.preventDefault();
		e.stopPropagation();
		const { minRow, maxRow, minCol, maxCol } = this.selectionDragBounds;
		this.fillDragGetter().start(e, minRow, maxRow, minCol, maxCol);
	};
}

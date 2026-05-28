import type { GridEngine } from '../engine/GridEngine.js';
import type { GridCellRange } from '../store.js';

export type FillDirection = 'DOWN' | 'UP' | 'RIGHT' | 'LEFT';

export interface OverlayBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface FillDragControllerOptions<TRowData> {
	engine: GridEngine<TRowData>;
	getOverlayLayer: () => HTMLDivElement | null;
	getScrollViewport: () => HTMLDivElement | null;
	getOverlayBox: (minRow: number, maxRow: number, minCol: number, maxCol: number) => OverlayBox | null;
	scrollTo: (scrollTop: number, scrollLeft: number) => void;
	schedulePaint: () => void;
}

export class FillDragController<TRowData = unknown> {
	private engine: GridEngine<TRowData>;
	private getOverlayLayer: () => HTMLDivElement | null;
	private getScrollViewport: () => HTMLDivElement | null;
	private getOverlayBox: (minRow: number, maxRow: number, minCol: number, maxCol: number) => OverlayBox | null;
	private scrollTo: (scrollTop: number, scrollLeft: number) => void;
	private schedulePaint: () => void;
	private isFilling = false;
	private fillStartRow = -1;
	private fillEndRow = -1;
	private fillStartCol = -1;
	private fillEndCol = -1;
	private fillPreviewBorder: HTMLDivElement | null = null;
	private currentFillPreview: {
		minRow: number;
		maxRow: number;
		minCol: number;
		maxCol: number;
		direction: FillDirection | null;
	} | null = null;
	private fillDragDirectionLock: 'VERTICAL' | 'HORIZONTAL' | null = null;

	constructor(options: FillDragControllerOptions<TRowData>) {
		this.engine = options.engine;
		this.getOverlayLayer = options.getOverlayLayer;
		this.getScrollViewport = options.getScrollViewport;
		this.getOverlayBox = options.getOverlayBox;
		this.scrollTo = options.scrollTo;
		this.schedulePaint = options.schedulePaint;
	}

	public start(e: MouseEvent, minRow: number, maxRow: number, minCol: number, maxCol: number): void {
		if (this.isFilling) return;
		this.isFilling = true;

		this.fillStartRow = minRow;
		this.fillEndRow = maxRow;
		this.fillStartCol = minCol;
		this.fillEndCol = maxCol;
		this.fillDragDirectionLock = null;

		this.fillPreviewBorder = document.createElement('div');
		this.fillPreviewBorder.className = 'og-fill-preview-border';
		this.getOverlayLayer()?.appendChild(this.fillPreviewBorder);

		this.currentFillPreview = null;

		window.addEventListener('mousemove', this.onFillDragMove);
		window.addEventListener('mouseup', this.onFillDragMouseUp);
		window.addEventListener('blur', this.onFillDragMouseUp);
		document.addEventListener('mouseleave', this.onFillDragMouseUp);
	}

	public reattachPreview(): void {
		const overlayLayer = this.getOverlayLayer();
		if (this.isFilling && this.fillPreviewBorder && overlayLayer) {
			overlayLayer.appendChild(this.fillPreviewBorder);
			this.updateFillPreview();
		}
	}

	public cleanup(): void {
		window.removeEventListener('mousemove', this.onFillDragMove);
		window.removeEventListener('mouseup', this.onFillDragMouseUp);
		window.removeEventListener('blur', this.onFillDragMouseUp);
		document.removeEventListener('mouseleave', this.onFillDragMouseUp);

		this.isFilling = false;
		this.fillDragDirectionLock = null;
		this.currentFillPreview = null;
		this.fillPreviewBorder?.remove();
		this.fillPreviewBorder = null;
	}

	private onFillDragMove = (e: MouseEvent): void => {
		try {
			const scrollViewport = this.getScrollViewport();
			if (!this.isFilling || !scrollViewport || !this.fillPreviewBorder) return;

			const scrollRect = scrollViewport.getBoundingClientRect();
			const mouseX = e.clientX - scrollRect.left + scrollViewport.scrollLeft;
			const mouseY = e.clientY - scrollRect.top + scrollViewport.scrollTop - 40;

			const currRow = this.engine.geometry.getRowIndexAtOffset(mouseY);
			const currCol = this.engine.geometry.getColIndexAtOffset(mouseX);

			if (this.fillDragDirectionLock === null) {
				const rowDiff = currRow > this.fillEndRow ? currRow - this.fillEndRow : currRow < this.fillStartRow ? this.fillStartRow - currRow : 0;
				const colDiff = currCol > this.fillEndCol ? currCol - this.fillEndCol : currCol < this.fillStartCol ? this.fillStartCol - currCol : 0;

				if (rowDiff > 0 || colDiff > 0) {
					this.fillDragDirectionLock = rowDiff >= colDiff ? 'VERTICAL' : 'HORIZONTAL';
				} else {
					this.currentFillPreview = null;
					this.updateFillPreview();
					return;
				}
			}

			const edgeThreshold = 35;
			let scrollSpeedX = 0;
			let scrollSpeedY = 0;

			if (e.clientY > scrollRect.bottom - edgeThreshold) {
				scrollSpeedY = 15;
			} else if (e.clientY < scrollRect.top + edgeThreshold) {
				scrollSpeedY = -15;
			}

			if (e.clientX > scrollRect.right - edgeThreshold) {
				scrollSpeedX = 15;
			} else if (e.clientX < scrollRect.left + edgeThreshold) {
				scrollSpeedX = -15;
			}

			let scrolled = false;
			if (scrollSpeedY !== 0) {
				scrollViewport.scrollTop = Math.max(
					0,
					Math.min(scrollViewport.scrollHeight - scrollViewport.clientHeight, scrollViewport.scrollTop + scrollSpeedY)
				);
				scrolled = true;
			}

			if (scrollSpeedX !== 0) {
				scrollViewport.scrollLeft = Math.max(
					0,
					Math.min(scrollViewport.scrollWidth - scrollViewport.clientWidth, scrollViewport.scrollLeft + scrollSpeedX)
				);
				scrolled = true;
			}

			if (scrolled) {
				this.scrollTo(scrollViewport.scrollTop, scrollViewport.scrollLeft);
			}

			this.setPreviewFromPointer(currRow, currCol);
			this.updateFillPreview();
		} catch (err) {
			console.error('RenderEngine: Error in fill drag move', err);
			this.onFillDragMouseUp();
		}
	};

	private setPreviewFromPointer(currRow: number, currCol: number): void {
		const isVertical = this.fillDragDirectionLock === 'VERTICAL';

		let direction: FillDirection | null = null;
		let minRowPreview = -1;
		let maxRowPreview = -1;
		let minColPreview = -1;
		let maxColPreview = -1;

		if (isVertical) {
			if (currRow > this.fillEndRow) {
				direction = 'DOWN';
				minRowPreview = this.fillEndRow + 1;
				maxRowPreview = currRow;
				minColPreview = this.fillStartCol;
				maxColPreview = this.fillEndCol;
			} else if (currRow < this.fillStartRow) {
				direction = 'UP';
				minRowPreview = currRow;
				maxRowPreview = this.fillStartRow - 1;
				minColPreview = this.fillStartCol;
				maxColPreview = this.fillEndCol;
			}
		} else {
			if (currCol > this.fillEndCol) {
				direction = 'RIGHT';
				minRowPreview = this.fillStartRow;
				maxRowPreview = this.fillEndRow;
				minColPreview = this.fillEndCol + 1;
				maxColPreview = currCol;
			} else if (currCol < this.fillStartCol) {
				direction = 'LEFT';
				minRowPreview = this.fillStartRow;
				maxRowPreview = this.fillEndRow;
				minColPreview = currCol;
				maxColPreview = this.fillStartCol - 1;
			}
		}

		if (direction && minRowPreview <= maxRowPreview && minColPreview <= maxColPreview) {
			this.currentFillPreview = {
				minRow: minRowPreview,
				maxRow: maxRowPreview,
				minCol: minColPreview,
				maxCol: maxColPreview,
				direction,
			};
		} else {
			this.currentFillPreview = null;
		}
	}

	private updateFillPreview(): void {
		if (!this.fillPreviewBorder) return;

		if (!this.isFilling || !this.currentFillPreview) {
			this.fillPreviewBorder.style.display = 'none';
			return;
		}

		const { minRow, maxRow, minCol, maxCol } = this.currentFillPreview;
		const box = this.getOverlayBox(minRow, maxRow, minCol, maxCol);
		if (box) {
			this.fillPreviewBorder.style.display = 'block';
			this.fillPreviewBorder.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
			this.fillPreviewBorder.style.width = `${box.width}px`;
			this.fillPreviewBorder.style.height = `${box.height}px`;
		} else {
			this.fillPreviewBorder.style.display = 'none';
		}
	}

	private onFillDragMouseUp = (): void => {
		window.removeEventListener('mousemove', this.onFillDragMove);
		window.removeEventListener('mouseup', this.onFillDragMouseUp);
		window.removeEventListener('blur', this.onFillDragMouseUp);
		document.removeEventListener('mouseleave', this.onFillDragMouseUp);

		if (!this.isFilling) return;
		this.isFilling = false;
		this.fillDragDirectionLock = null;

		this.fillPreviewBorder?.remove();
		this.fillPreviewBorder = null;

		if (this.currentFillPreview) {
			try {
				const { minRow, maxRow, minCol, maxCol, direction } = this.currentFillPreview;
				this.extrapolateAndFillRange(minRow, maxRow, minCol, maxCol, direction!);
			} catch (err) {
				console.error('RenderEngine: Error during fill drag commit', err);
			}
		}

		this.currentFillPreview = null;
	};

	private extrapolateAndFillRange(
		minRowTarget: number,
		maxRowTarget: number,
		minColTarget: number,
		maxColTarget: number,
		direction: FillDirection
	): void {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return;

		const state = this.engine.stateManager.getState();
		const columns = state.columns;

		const startRowNode = rowModel.getRowNode(this.fillStartRow);
		const endRowNode = rowModel.getRowNode(this.fillEndRow);
		const startCol = columns[this.fillStartCol];
		const endCol = columns[this.fillEndCol];

		const targetStartRowNode = rowModel.getRowNode(minRowTarget);
		const targetEndRowNode = rowModel.getRowNode(maxRowTarget);
		const targetStartCol = columns[minColTarget];
		const targetEndCol = columns[maxColTarget];

		if (!startRowNode || !endRowNode || !startCol || !endCol || !targetStartRowNode || !targetEndRowNode || !targetStartCol || !targetEndCol) {
			return;
		}

		const source: GridCellRange = {
			start: { rowId: startRowNode.id, colField: startCol.field },
			end: { rowId: endRowNode.id, colField: endCol.field },
		};

		const target: GridCellRange = {
			start: { rowId: targetStartRowNode.id, colField: targetStartCol.field },
			end: { rowId: targetEndRowNode.id, colField: targetEndCol.field },
		};

		this.engine.fillRange(source, target);
		this.schedulePaint();
	}
}

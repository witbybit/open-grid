import type { InvalidationFrame } from './invalidationManager.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { ColumnInteractionController } from './columnInteractionController.js';

export class HeaderRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly columnInteractionsGetter: () => ColumnInteractionController<TRowData>;
	private readonly showHeaderMenu: (cell: HTMLElement, colField: string) => void;

	private headerCells = new Map<number, HTMLDivElement>();
	private headerLayer: HTMLDivElement | null = null;
	private headerLeftLayer: HTMLDivElement | null = null;
	private headerRightLayer: HTMLDivElement | null = null;

	public lastHeaderVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1, colCount: -1 };
	private lastHeaderScrollLeft = 0;
	private lastHeaderLeftTransform = '';
	private lastHeaderRightLeft = -1;
	private lastHeaderRightTransform = '';

	constructor(
		engine: GridEngine<TRowData>,
		columnInteractionsGetter: () => ColumnInteractionController<TRowData>,
		showHeaderMenu: (cell: HTMLElement, colField: string) => void
	) {
		this.engine = engine;
		this.columnInteractionsGetter = columnInteractionsGetter;
		this.showHeaderMenu = showHeaderMenu;
	}

	public mount(headerLayer: HTMLDivElement, headerLeftLayer: HTMLDivElement, headerRightLayer: HTMLDivElement): void {
		this.headerLayer = headerLayer;
		this.headerLeftLayer = headerLeftLayer;
		this.headerRightLayer = headerRightLayer;
		this.clearHeaderCells();
	}

	public unmount(): void {
		this.clearHeaderCells();
		this.headerLayer = null;
		this.headerLeftLayer = null;
		this.headerRightLayer = null;
	}

	public clearHeaderCells(): void {
		for (const cell of this.headerCells.values()) {
			cell.remove();
		}
		this.headerCells.clear();
		this.lastHeaderVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1, colCount: -1 };
		this.lastHeaderLeftTransform = '';
		this.lastHeaderRightLeft = -1;
		this.lastHeaderRightTransform = '';
	}

	public sync(frame: InvalidationFrame): void {
		this.repaintHeaders();
	}

	public repaintHeaders(): void {
		this.syncVisibleHeaders(true);
	}

	public syncScrollLeft(scrollLeft: number): void {
		this.lastHeaderScrollLeft = scrollLeft;
		this.syncPinnedLayerPositions();
	}

	private syncPinnedLayerPositions(): void {
		const colCount = this.engine.columns.getDisplayedColumnCount();
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const scrollLeft = this.engine.viewport.scrollLeft;
		const viewportWidth = this.engine.viewport.viewportWidth;
		const state = this.engine.stateManager.getState();
		const totalWidth = this.engine.geometry.getTotalWidth(state.defaultColWidth);
		const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
		const pinLeftWidth = pinLeftColumns > 0 ? (this.engine.geometry.colLefts[Math.min(pinLeftColumns, colCount)] ?? 0) : 0;
		const pinRightBaseLeft = pinRightStart < colCount ? (this.engine.geometry.colLefts[pinRightStart] ?? totalWidth) : totalWidth;
		const pinRightWidth = Math.max(0, totalWidth - pinRightBaseLeft);

		if (this.headerLeftLayer) {
			const transform = pinLeftColumns > 0 ? `translate3d(${scrollLeft}px, 0, 0)` : '';
			if (this.lastHeaderLeftTransform !== transform) {
				this.lastHeaderLeftTransform = transform;
				this.headerLeftLayer.style.transform = transform;
			}
		}

		if (this.headerRightLayer && pinRightColumns > 0 && pinRightStart < colCount) {
			if (this.lastHeaderRightLeft !== pinRightBaseLeft) {
				this.lastHeaderRightLeft = pinRightBaseLeft;
				this.headerRightLayer.style.left = `${pinRightBaseLeft}px`;
			}
			const transform = `translate3d(${scrollLeft + Math.max(pinLeftWidth, viewportWidth - pinRightWidth) - pinRightBaseLeft}px, 0, 0)`;
			if (this.lastHeaderRightTransform !== transform) {
				this.lastHeaderRightTransform = transform;
				this.headerRightLayer.style.transform = transform;
			}
		}
	}

	public syncVisibleColumnRange(): boolean {
		const colCount = this.engine.columns.getDisplayedColumnCount();
		const pinLeft = this.engine.viewport.pinLeftColumns;
		const pinRight = this.engine.viewport.pinRightColumns;
		const range = this.engine.viewport.getVisibleColumnRange(colCount);

		if (
			range.startIdx === this.lastHeaderVisibleRange.startIdx &&
			range.endIdx === this.lastHeaderVisibleRange.endIdx &&
			pinLeft === this.lastHeaderVisibleRange.pinLeft &&
			pinRight === this.lastHeaderVisibleRange.pinRight &&
			colCount === this.lastHeaderVisibleRange.colCount
		) {
			// Cheap bail out! Range did not change!
			return false;
		}

		this.syncVisibleHeaders(false);
		return true;
	}

	private syncVisibleHeaders(forceRepaint = false): void {
		if (!this.headerLayer || !this.headerLeftLayer || !this.headerRightLayer) return;

		const state = this.engine.stateManager.getState();
		const columns = this.engine.columns.getDisplayedColumns();
		const colCount = columns.length;
		if (colCount === 0) {
			this.clearHeaderCells();
			this.lastHeaderScrollLeft = this.engine.viewport.scrollLeft;
			return;
		}

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const newColRange = this.engine.viewport.getVisibleColumnRange(colCount);
		this.syncPinnedLayerPositions();

		if (
			!forceRepaint &&
			newColRange.startIdx === this.lastHeaderVisibleRange.startIdx &&
			newColRange.endIdx === this.lastHeaderVisibleRange.endIdx &&
			pinLeftColumns === this.lastHeaderVisibleRange.pinLeft &&
			pinRightColumns === this.lastHeaderVisibleRange.pinRight &&
			colCount === this.lastHeaderVisibleRange.colCount
		) {
			// Range did not change, skip full sync!
			return;
		}

		const rendered = new Set<number>();

		const renderHeaderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;

			let headerCell = this.headerCells.get(c);
			if (!headerCell) {
				headerCell = this.createHeaderCellElement();
				this.headerCells.set(c, headerCell);
			}
			rendered.add(c);

			let className = 'og-header-cell';
			let cellLeft = this.engine.geometry.colLefts[c];
			const cellWidth = this.engine.geometry.colWidths[c];

			let targetLayer = this.headerLayer;

			if (c < pinLeftColumns) {
				className += ' og-header-cell-pinned-left';
				targetLayer = this.headerLeftLayer;
			} else if (c >= Math.max(pinLeftColumns, colCount - pinRightColumns)) {
				className += ' og-header-cell-pinned-right';
				const firstRightPinColLeft = this.engine.geometry.colLefts[Math.max(pinLeftColumns, colCount - pinRightColumns)];
				cellLeft = cellLeft - firstRightPinColLeft;
				targetLayer = this.headerRightLayer;
			}

			if (state.styleSlots?.headerCellClass) {
				try {
					const customHeaderClass = state.styleSlots.headerCellClass(col);
					if (customHeaderClass) {
						className += ' ' + customHeaderClass;
					}
				} catch (e) {
					console.error('HeaderRenderer: Error in headerCellClass styleSlot', e);
				}
			}
			if (state.enableColumnReorder && col.movable !== false) {
				className += ' og-header-cell-movable';
			}
			const columnInteractions = this.columnInteractionsGetter();
			if (columnInteractions.isDraggingColumn(col.field)) {
				className += ' og-header-cell-dragging';
			}

			if (headerCell.className !== className) headerCell.className = className;
			const nextTransform = `translate3d(${cellLeft}px, 0, 0)`;
			if (headerCell.style.transform !== nextTransform) headerCell.style.transform = nextTransform;
			const nextWidth = `${cellWidth}px`;
			if (headerCell.style.width !== nextWidth) headerCell.style.width = nextWidth;

			const textSpan = headerCell.firstElementChild as HTMLSpanElement | null;
			if (textSpan && textSpan.textContent !== (col.header || col.field)) {
				textSpan.textContent = col.header || col.field;
			}

			const currentSort = state.sortModel?.find((s) => s.colId === col.field);
			const sortIndicator = headerCell.querySelector('.og-header-sort-indicator') as HTMLDivElement | null;
			if (sortIndicator) {
				if (currentSort) {
					sortIndicator.style.display = 'flex';
					const isAsc = currentSort.sort === 'asc';
					const svgAsc = sortIndicator.querySelector('.og-sort-svg-asc') as SVGElement | null;
					const svgDesc = sortIndicator.querySelector('.og-sort-svg-desc') as SVGElement | null;
					if (svgAsc) svgAsc.style.display = isAsc ? 'block' : 'none';
					if (svgDesc) svgDesc.style.display = isAsc ? 'none' : 'block';
				} else {
					sortIndicator.style.display = 'none';
				}
			}

			if (headerCell.dataset.colField !== col.field) headerCell.dataset.colField = col.field;
			const colIndexText = String(c);
			if (headerCell.dataset.colIndex !== colIndexText) headerCell.dataset.colIndex = colIndexText;
			if (headerCell.parentNode !== targetLayer) {
				targetLayer!.appendChild(headerCell);
			}
		};

		for (let c = 0; c < pinLeftColumns; c++) {
			renderHeaderCell(c);
		}
		for (let c = newColRange.startIdx; c <= newColRange.endIdx; c++) {
			if (c >= pinLeftColumns && c < Math.max(pinLeftColumns, colCount - pinRightColumns)) {
				renderHeaderCell(c);
			}
		}
		for (let c = Math.max(pinLeftColumns, colCount - pinRightColumns); c < colCount; c++) {
			if (c >= 0) {
				renderHeaderCell(c);
			}
		}

		for (const [colIdx, cell] of this.headerCells.entries()) {
			if (!rendered.has(colIdx) || colIdx >= colCount) {
				cell.remove();
				this.headerCells.delete(colIdx);
			}
		}
		this.lastHeaderScrollLeft = this.engine.viewport.scrollLeft;
		this.lastHeaderVisibleRange = {
			startIdx: newColRange.startIdx,
			endIdx: newColRange.endIdx,
			pinLeft: pinLeftColumns,
			pinRight: pinRightColumns,
			colCount,
		};
	}

	private createHeaderCellElement(): HTMLDivElement {
		const headerCell = document.createElement('div');
		headerCell.addEventListener('mousedown', (e) => this.columnInteractionsGetter().onHeaderCellMouseDown(e));

		const textSpan = document.createElement('span');
		textSpan.style.overflow = 'hidden';
		textSpan.style.textOverflow = 'ellipsis';
		textSpan.style.whiteSpace = 'nowrap';
		textSpan.style.flex = '1';
		headerCell.appendChild(textSpan);

		const sortIndicator = document.createElement('div');
		sortIndicator.className = 'og-header-sort-indicator';

		// Pre-create sort indicator SVG nodes to avoid innerHTML churn!
		const svgAsc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svgAsc.setAttribute('width', '10');
		svgAsc.setAttribute('height', '10');
		svgAsc.setAttribute('viewBox', '0 0 24 24');
		svgAsc.setAttribute('fill', 'none');
		svgAsc.setAttribute('stroke', 'currentColor');
		svgAsc.setAttribute('stroke-width', '3');
		svgAsc.setAttribute('stroke-linecap', 'round');
		svgAsc.setAttribute('stroke-linejoin', 'round');
		svgAsc.setAttribute('class', 'og-sort-svg-asc');
		svgAsc.style.display = 'none';
		svgAsc.innerHTML = '<path d="M12 19V5M5 12l7-7 7 7"/>';

		const svgDesc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svgDesc.setAttribute('width', '10');
		svgDesc.setAttribute('height', '10');
		svgDesc.setAttribute('viewBox', '0 0 24 24');
		svgDesc.setAttribute('fill', 'none');
		svgDesc.setAttribute('stroke', 'currentColor');
		svgDesc.setAttribute('stroke-width', '3');
		svgDesc.setAttribute('stroke-linecap', 'round');
		svgDesc.setAttribute('stroke-linejoin', 'round');
		svgDesc.setAttribute('class', 'og-sort-svg-desc');
		svgDesc.style.display = 'none';
		svgDesc.innerHTML = '<path d="M12 5v14M5 12l7 7 7-7"/>';

		sortIndicator.appendChild(svgAsc);
		sortIndicator.appendChild(svgDesc);
		headerCell.appendChild(sortIndicator);

		const menuButton = document.createElement('div');
		menuButton.className = 'og-header-menu-button';
		menuButton.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2.5"></circle><circle cx="12" cy="5" r="2.5"></circle><circle cx="12" cy="19" r="2.5"></circle></svg>`;
		menuButton.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});
		menuButton.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			const colField = headerCell.dataset.colField;
			if (colField) {
				this.showHeaderMenu(headerCell, colField);
			}
		});
		headerCell.appendChild(menuButton);

		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'og-header-resize-handle';
		resizeHandle.addEventListener('mousedown', (e) => this.columnInteractionsGetter().onHeaderResizeMouseDown(e));
		headerCell.appendChild(resizeHandle);

		return headerCell;
	}
}

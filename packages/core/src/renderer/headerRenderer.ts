import type { InvalidationFrame } from './invalidationManager.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { ColumnInteractionController } from './columnInteractionController.js';
import { computeGridLayoutPlan, type GridLayoutPlan, type HeaderCellLayout } from './layoutPlan.js';

export class HeaderRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly columnInteractionsGetter: () => ColumnInteractionController<TRowData>;
	private readonly showHeaderMenu: (cell: HTMLElement, colField: string) => void;

	// Keyed by "${depth}:${colStart}" to support multi-band group headers
	private headerCells = new Map<string, HTMLDivElement>();
	private headerLayer: HTMLDivElement | null = null;
	private headerLeftLayer: HTMLDivElement | null = null;
	private headerRightLayer: HTMLDivElement | null = null;

	public lastHeaderVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1, colCount: -1 };
	private lastHeaderScrollLeft = 0;
	private lastSyncedViewportWidth = -1;
	private lastHeaderLeftTransform = '';
	private lastHeaderRightLeft = -1;
	private lastHeaderRightTransform = '';
	private readonly renderedHeaderScratch = new Set<string>();

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
		this.lastSyncedViewportWidth = -1;
		this.lastHeaderScrollLeft = 0;
		this.lastHeaderLeftTransform = '';
		this.lastHeaderRightLeft = -1;
		this.lastHeaderRightTransform = '';
	}

	public sync(_frame: InvalidationFrame): void {
		this.repaintHeaders();
	}

	public repaintHeaders(layoutPlan?: GridLayoutPlan): void {
		this.syncVisibleHeaders(true, layoutPlan ?? computeGridLayoutPlan(this.engine));
	}

	public syncScrollLeft(layoutPlan: GridLayoutPlan): void {
		const scrollLeft = layoutPlan.viewport.scrollLeft;
		const viewportWidth = layoutPlan.viewport.width;
		if (scrollLeft === this.lastHeaderScrollLeft && viewportWidth === this.lastSyncedViewportWidth) {
			return;
		}
		this.lastHeaderScrollLeft = scrollLeft;
		this.lastSyncedViewportWidth = viewportWidth;
		this.syncPinnedLayerPositions(layoutPlan);
	}

	private syncPinnedLayerPositions(layoutPlan: GridLayoutPlan): void {
		const { pinLeftCount, pinRightCount, pinLeftWidth, pinRightWidth } = layoutPlan.columns;
		const scrollLeft = layoutPlan.viewport.scrollLeft;
		const viewportWidth = layoutPlan.viewport.width;
		// pinRightBaseLeft = totalColumnsWidth - pinRightWidth
		const pinRightBaseLeft = layoutPlan.dimensions.totalColumnsWidth - pinRightWidth;

		if (this.headerLeftLayer) {
			const transform = pinLeftCount > 0 ? `translate3d(${scrollLeft}px, 0, 0)` : '';
			if (this.lastHeaderLeftTransform !== transform) {
				this.lastHeaderLeftTransform = transform;
				this.headerLeftLayer.style.transform = transform;
			}
		}

		if (this.headerRightLayer && pinRightCount > 0) {
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

	public syncVisibleColumnRange(layoutPlan: GridLayoutPlan, range?: { startIdx: number; endIdx: number }): boolean {
		const band = layoutPlan.headerBands[0];
		const colCount = band?.cells.length ?? 0;
		const { pinLeftCount: pinLeft, pinRightCount: pinRight } = layoutPlan.columns;
		const colStart = range?.startIdx ?? layoutPlan.columns.colStart;
		const colEnd = range?.endIdx ?? layoutPlan.columns.colEnd;

		if (
			colStart === this.lastHeaderVisibleRange.startIdx &&
			colEnd === this.lastHeaderVisibleRange.endIdx &&
			pinLeft === this.lastHeaderVisibleRange.pinLeft &&
			pinRight === this.lastHeaderVisibleRange.pinRight &&
			colCount === this.lastHeaderVisibleRange.colCount
		) {
			return false;
		}

		this.syncVisibleHeaders(false, layoutPlan, range);
		return true;
	}

	private syncVisibleHeaders(forceRepaint = false, layoutPlan: GridLayoutPlan, range?: { startIdx: number; endIdx: number }): void {
		if (!this.headerLayer || !this.headerLeftLayer || !this.headerRightLayer) return;

		const { headerBands } = layoutPlan;
		if (headerBands.length === 0) {
			this.clearHeaderCells();
			return;
		}

		// Leaf band is always the last band
		const leafBand = headerBands[headerBands.length - 1];
		if (leafBand.cells.length === 0) {
			this.clearHeaderCells();
			return;
		}

		const state = this.engine.stateManager.getState();
		const { pinLeftCount, pinRightCount } = layoutPlan.columns;
		const colCount = leafBand.cells.length;
		const colStart = range?.startIdx ?? layoutPlan.columns.colStart;
		const colEnd = range?.endIdx ?? layoutPlan.columns.colEnd;
		const pinRightBaseLeft = layoutPlan.dimensions.totalColumnsWidth - layoutPlan.columns.pinRightWidth;

		this.syncPinnedLayerPositions(layoutPlan);

		if (
			!forceRepaint &&
			colStart === this.lastHeaderVisibleRange.startIdx &&
			colEnd === this.lastHeaderVisibleRange.endIdx &&
			pinLeftCount === this.lastHeaderVisibleRange.pinLeft &&
			pinRightCount === this.lastHeaderVisibleRange.pinRight &&
			colCount === this.lastHeaderVisibleRange.colCount
		) {
			return;
		}

		const rendered = this.renderedHeaderScratch;
		rendered.clear();

		const renderCell = (cell: HeaderCellLayout) => {
			const cellKey = `${cell.depth}:${cell.colStart}`;

			let headerCell = this.headerCells.get(cellKey);
			if (!headerCell) {
				headerCell = this.createHeaderCellElement(cell.isLeaf);
				this.headerCells.set(cellKey, headerCell);
			}
			rendered.add(cellKey);

			let className = cell.isLeaf ? 'og-header-cell' : 'og-header-cell og-header-group-cell';
			let cellLeft = cell.left;
			let targetLayer = this.headerLayer;

			if (cell.pinned === 'left') {
				className += ' og-header-cell-pinned-left';
				targetLayer = this.headerLeftLayer;
			} else if (cell.pinned === 'right') {
				className += ' og-header-cell-pinned-right';
				cellLeft = cell.left - pinRightBaseLeft;
				targetLayer = this.headerRightLayer;
			}

			if (cell.isLeaf) {
				if (state.styleSlots?.headerCellClass) {
					try {
						const col = this.engine.columns.getCompiledPlan().displayedColumns[cell.colStart];
						if (!col) return;
						const customHeaderClass = state.styleSlots.headerCellClass(col);
						if (customHeaderClass) className += ' ' + customHeaderClass;
					} catch (e) {
						console.error('HeaderRenderer: Error in headerCellClass styleSlot', e);
					}
				}
				if (cell.movable) className += ' og-header-cell-movable';
				if (cell.checkboxSelection) className += ' og-header-cell-row-selector';

				const columnInteractions = this.columnInteractionsGetter();
				const isDraggingThis = columnInteractions.isDraggingColumn(cell.field);
				if (isDraggingThis) className += ' og-header-cell-dragging';

				if (headerCell.className !== className) headerCell.className = className;
				const nextTransform = isDraggingThis ? `translate3d(${cellLeft}px, -2px, 0) scale(1.035)` : `translate3d(${cellLeft}px, 0, 0)`;
				if (headerCell.style.transform !== nextTransform) headerCell.style.transform = nextTransform;
				const nextWidth = `${cell.width}px`;
				if (headerCell.style.width !== nextWidth) headerCell.style.width = nextWidth;
				const nextTop = `${cell.top}px`;
				if (headerCell.style.top !== nextTop) headerCell.style.top = nextTop;
				const nextHeight = `${cell.height}px`;
				if (headerCell.style.height !== nextHeight) headerCell.style.height = nextHeight;

				const textSpan = headerCell.firstElementChild as HTMLSpanElement | null;
				if (cell.checkboxSelection) {
					const menuBtnEl = headerCell.querySelector<HTMLDivElement>('.og-header-menu-button');
					if (menuBtnEl) menuBtnEl.style.display = 'none';
					const resizeEl = headerCell.querySelector<HTMLDivElement>('.og-header-resize-handle');
					if (resizeEl) resizeEl.style.display = 'none';
					const sortEl = headerCell.querySelector<HTMLDivElement>('.og-header-sort-indicator');
					if (sortEl) sortEl.style.display = 'none';
				}

				if (cell.checkboxSelection) {
					let checkbox = headerCell.querySelector<HTMLInputElement>('input[type="checkbox"].og-header-checkbox');
					if (!checkbox) {
						checkbox = document.createElement('input');
						checkbox.type = 'checkbox';
						checkbox.className = 'og-header-checkbox';
						checkbox.addEventListener('change', (e) => {
							e.stopPropagation();
							if ((e.target as HTMLInputElement).checked) {
								this.engine.selectAllDataRows('headerCheckbox');
							} else {
								this.engine.clearRowSelection('headerCheckbox');
							}
						});
						if (textSpan) textSpan.textContent = '';
						headerCell.insertBefore(checkbox, textSpan);
					}
					const rowModel = this.engine.getRowModel();
					const totalDataRows =
						rowModel?.getDataRowCount?.() ??
						(() => {
							if (!rowModel) return 0;
							let count = 0;
							const vCount = rowModel.getVisualRowCount();
							for (let i = 0; i < vCount; i++) {
								if (rowModel.getVisualRow(i)?.kind === 'data') count++;
							}
							return count;
						})();
					const selectedCount = rowModel
						? state.selectedRowIds.filter((rowId) => rowModel.getVisualIndexByRowId(rowId) >= 0).length
						: state.selectedRowIds.length;
					const newChecked = selectedCount > 0 && selectedCount >= totalDataRows;
					const newIndeterminate = selectedCount > 0 && selectedCount < totalDataRows;
					checkbox.title = selectedCount > 0 ? `${selectedCount} of ${totalDataRows} rows selected` : `Select all ${totalDataRows} rows`;
					checkbox.setAttribute('aria-label', newChecked ? 'Clear row selection' : 'Select all rows');
					if (checkbox.checked !== newChecked) checkbox.checked = newChecked;
					if (checkbox.indeterminate !== newIndeterminate) checkbox.indeterminate = newIndeterminate;
				} else if (textSpan && textSpan.textContent !== cell.label) {
					textSpan.textContent = cell.label;
				}

				const currentSort = state.sortModel?.find((s) => s.colId === cell.field);
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

				if (headerCell.dataset.colField !== cell.field) headerCell.dataset.colField = cell.field;
				const colIndexText = String(cell.colStart);
				if (headerCell.dataset.colIndex !== colIndexText) headerCell.dataset.colIndex = colIndexText;
			} else {
				// Group header cell — simpler rendering: label only, no interactive chrome
				if (headerCell.className !== className) headerCell.className = className;
				const nextTransform = `translate3d(${cellLeft}px, 0, 0)`;
				if (headerCell.style.transform !== nextTransform) headerCell.style.transform = nextTransform;
				const nextWidth = `${cell.width}px`;
				if (headerCell.style.width !== nextWidth) headerCell.style.width = nextWidth;
				const nextTop = `${cell.top}px`;
				if (headerCell.style.top !== nextTop) headerCell.style.top = nextTop;
				const nextHeight = `${cell.height}px`;
				if (headerCell.style.height !== nextHeight) headerCell.style.height = nextHeight;

				const textSpan = headerCell.firstElementChild as HTMLSpanElement | null;
				if (textSpan && textSpan.textContent !== cell.label) textSpan.textContent = cell.label;
			}

			if (headerCell.parentNode !== targetLayer) {
				targetLayer!.appendChild(headerCell);
			}
		};

		// Render group bands (all cells fully visible — group bands aren't virtualized)
		for (let b = 0; b < headerBands.length - 1; b++) {
			for (const cell of headerBands[b].cells) {
				if (cell.pinned === 'left') renderCell(cell);
			}
			for (const cell of headerBands[b].cells) {
				if (cell.pinned === 'center') renderCell(cell);
			}
			for (const cell of headerBands[b].cells) {
				if (cell.pinned === 'right') renderCell(cell);
			}
		}

		// Render leaf band with visible-range virtualization
		for (const cell of leafBand.cells) {
			if (cell.pinned === 'left') renderCell(cell);
		}
		for (const cell of leafBand.cells) {
			if (cell.pinned === 'center' && cell.colStart >= colStart && cell.colStart <= colEnd) {
				renderCell(cell);
			}
		}
		for (const cell of leafBand.cells) {
			if (cell.pinned === 'right') renderCell(cell);
		}

		// Remove cells that are no longer in any rendered band
		for (const [cellKey, cell] of this.headerCells.entries()) {
			if (!rendered.has(cellKey)) {
				cell.remove();
				this.headerCells.delete(cellKey);
			}
		}

		this.lastHeaderScrollLeft = layoutPlan.viewport.scrollLeft;
		this.lastSyncedViewportWidth = layoutPlan.viewport.width;
		this.lastHeaderVisibleRange = {
			startIdx: colStart,
			endIdx: colEnd,
			pinLeft: pinLeftCount,
			pinRight: pinRightCount,
			colCount,
		};
	}

	private createHeaderCellElement(isLeaf = true): HTMLDivElement {
		const headerCell = document.createElement('div');

		const textSpan = document.createElement('span');
		textSpan.style.overflow = 'hidden';
		textSpan.style.textOverflow = 'ellipsis';
		textSpan.style.whiteSpace = 'nowrap';
		textSpan.style.flex = '1';
		headerCell.appendChild(textSpan);

		if (!isLeaf) {
			// Group header cells have no interactive chrome
			return headerCell;
		}

		headerCell.addEventListener('mousedown', (e) => this.columnInteractionsGetter().onHeaderCellMouseDown(e));

		const sortIndicator = document.createElement('div');
		sortIndicator.className = 'og-header-sort-indicator';

		// Pre-create sort indicator SVG nodes to avoid innerHTML churn
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

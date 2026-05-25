import { DOMPool, PooledRow } from './domPool.js';
import { ScrollEngine } from './scrollEngine.js';
import { createCellKey } from '../ids.js';
import type { IGridRenderer } from './IGridRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { RowNode, type ColumnDef, type GridCellRange } from '../store.js';
import { CORE_STYLES } from './styles.js';
import type { ViewportRange } from '../viewportController.js';

/**
 * RenderEngine — The framework-agnostic core DOM owner.
 * Coordinates z-index viewport layering, absolute hardware GPU-promoted transforms,
 * and high-performance row/cell recycling.
 */
export class RenderEngine<TRowData = any> implements IGridRenderer {
	private engine: GridEngine<TRowData>;
	private rowPool!: DOMPool<HTMLDivElement>;
	private cellPool!: DOMPool<HTMLDivElement>;
	private scrollEngine: ScrollEngine<TRowData>;

	// Viewport DOM elements
	private container: HTMLElement | null = null;
	private scrollViewport: HTMLDivElement | null = null;
	private scrollSpacer: HTMLDivElement | null = null;

	// Layer DOM elements
	private centerLayer: HTMLDivElement | null = null;
	private leftLayer: HTMLDivElement | null = null;
	private rightLayer: HTMLDivElement | null = null;
	private headerLayer: HTMLDivElement | null = null;
	private headerLeftLayer: HTMLDivElement | null = null;
	private headerRightLayer: HTMLDivElement | null = null;
	private overlayLayer: HTMLDivElement | null = null;
	private styleTag: HTMLStyleElement | null = null;

	// Active tracking maps
	private activeRows = new Map<number, PooledRow>(); // rowIndex -> PooledRow
	private headerCells = new Map<number, HTMLDivElement>();
	private unsubscribeStore: (() => void) | null = null;
	private unsubscribeCellValueChanged: (() => void) | null = null;
	private pendingPaint = false;

	// Track current ranges to prevent redundant renders
	private currentRowRange: ViewportRange = { startIdx: -1, endIdx: -1 };
	private currentColRange: ViewportRange = { startIdx: -1, endIdx: -1 };

	// Drag-to-fill tracking variables
	private isFilling = false;
	private fillStartRow = -1;
	private fillEndRow = -1;
	private fillStartCol = -1;
	private fillEndCol = -1;
	private fillDragStartX = 0;
	private fillDragStartY = 0;
	private fillPreviewBorder: HTMLDivElement | null = null;
	private currentFillPreview: { minRow: number; maxRow: number; minCol: number; maxCol: number; direction: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT' | null } | null = null;
	private fillDragDirectionLock: 'VERTICAL' | 'HORIZONTAL' | null = null;

	// Column reorder tracking variables
	private isColumnReordering = false;
	private columnDragStartX = 0;
	private columnDragStartY = 0;
	private columnDragFromIndex = -1;
	private columnDragField: string | null = null;
	private columnDropInsertionIndex = -1;
	private columnDropIndicator: HTMLDivElement | null = null;

	// Micro-bridge for React custom renderers/editors
	public onMountReactPortal?: (
		cellKey: string,
		container: HTMLElement,
		value: unknown,
		node: RowNode,
		col: ColumnDef,
		isEditing: boolean,
		isLoading: boolean
	) => void;
	public onUnmountReactPortal?: (cellKey: string) => void;

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
		this.scrollEngine = new ScrollEngine<TRowData>(engine);
	}

	/**
	 * Mount the rendering engine inside a host DOM container.
	 */
	public mount(container: HTMLElement): void {
		this.container = container;

		// Inject stylesheet for structural containment and z-index layering
		this.injectStyles();

		// Create the viewport wrapper
		this.container.classList.add('og-grid-container');

		// Create scrollable container viewport
		this.scrollViewport = document.createElement('div');
		this.scrollViewport.className = 'og-scroll-viewport';

		// Create spacer representing virtual height/width
		this.scrollSpacer = document.createElement('div');
		this.scrollSpacer.className = 'og-scroll-spacer';

		// Create GPU composite layers
		this.centerLayer = document.createElement('div');
		this.centerLayer.className = 'og-layer-center';

		this.leftLayer = document.createElement('div');
		this.leftLayer.className = 'og-layer-left';

		this.rightLayer = document.createElement('div');
		this.rightLayer.className = 'og-layer-right';

		// Create horizontal-scrolling header layers
		this.headerLayer = document.createElement('div');
		this.headerLayer.className = 'og-layer-header';

		this.headerLeftLayer = document.createElement('div');
		this.headerLeftLayer.className = 'og-layer-header-left';

		this.headerRightLayer = document.createElement('div');
		this.headerRightLayer.className = 'og-layer-header-right';

		// Create visual overlay layer (selection & focus ring)
		this.overlayLayer = document.createElement('div');
		this.overlayLayer.className = 'og-layer-overlay';

		// Assemble DOM tree using CSS Grid overlap
		this.scrollViewport.appendChild(this.scrollSpacer);
		this.scrollViewport.appendChild(this.centerLayer);
		this.scrollViewport.appendChild(this.leftLayer);
		this.scrollViewport.appendChild(this.rightLayer);
		this.scrollViewport.appendChild(this.headerLayer);
		this.scrollViewport.appendChild(this.headerLeftLayer);
		this.scrollViewport.appendChild(this.headerRightLayer);
		this.container.appendChild(this.scrollViewport);
		this.container.appendChild(this.overlayLayer);

		// Bind scroll events to scroll engine
		this.scrollEngine.bind(this.scrollViewport, this.onScroll);

		// Pre-warm DOM recycling pools
		const rect = container.getBoundingClientRect();
		const estRows = Math.ceil((rect.height || 500) / 40) + 15;
		const estCols = Math.ceil((rect.width || 800) / 100) + 10;

		this.rowPool = new DOMPool(() => this.createRowElement(), estRows);
		this.cellPool = new DOMPool(() => this.createCellElement(), estRows * estCols);

		// Set viewport dimensions in model
		this.engine.viewport.setViewportSize(rect.width || 800, rect.height || 500);

		// Subscribe to StateManager to trigger repaints when geometry or selections change
		this.unsubscribeStore = this.engine.stateManager.subscribe(() => {
			this.schedulePaint();
		});

		// Subscribe to cell value change events to trigger repaints immediately
		this.unsubscribeCellValueChanged = this.engine.eventBus.addEventListener('cellValueChanged', () => {
			this.schedulePaint();
		});

		// Run first layout calculation and repaint
		this.fullPaint();
	}

	/**
	 * Unmount and clean up all DOM resources and subscriptions.
	 */
	public unmount(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}

		if (this.unsubscribeCellValueChanged) {
			this.unsubscribeCellValueChanged();
			this.unsubscribeCellValueChanged = null;
		}

		this.scrollEngine.unbind();
		this.cleanupColumnReorderDrag();

		// Release all active rows and cells
		this.clearActiveRows();
		this.clearHeaderCells();

		if (this.rowPool) this.rowPool.clear();
		if (this.cellPool) this.cellPool.clear();

		if (this.styleTag) {
			this.styleTag.remove();
			this.styleTag = null;
		}

		if (this.container) {
			this.container.classList.remove('og-grid-container');
			this.container.textContent = '';
			this.container = null;
		}
	}

	/**
	 * Performs scroll-driven viewport shifts and schedules updates.
	 */
	private onScroll = (scrollTop: number, scrollLeft: number): void => {
		this.engine.eventBus.dispatchEvent('beforeRender', null);
		// 1. Update the coordinate values in ViewportModel (O(1))
		this.engine.viewport.setScrollPosition(scrollTop, scrollLeft);

		// 2. Recycle viewport elements
		this.recycleViewport();

		// 3. Draw and recycle headers
		this.paintHeaders();

		// 4. Update overlay selections
		this.paintOverlay();

		this.engine.eventBus.dispatchEvent('afterRender', null);
	};

	/**
	 * Schedules a paint task in the next animation frame, preventing synchronous re-entrancy.
	 */
	public schedulePaint(): void {
		if (this.pendingPaint) return;
		this.pendingPaint = true;

		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(() => {
				this.pendingPaint = false;
				this.fullPaint();
			});
		} else {
			queueMicrotask(() => {
				this.pendingPaint = false;
				this.fullPaint();
			});
		}
	}

	/**
	 * Completely rebuilds grid structures, spacers, and forces recycling refresh.
	 */
	public fullPaint(): void {
		this.engine.eventBus.dispatchEvent('beforeRender', null);
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getRowCount() : 0;
		const state = this.engine.stateManager.getState();
		const colCount = state.columns.length;

		// 1. Sync spacer height/width matching total virtual content boundaries
		const totalHeight = this.engine.geometry.getTotalHeight(state.defaultRowHeight);
		const totalWidth = this.engine.geometry.getTotalWidth(state.defaultColWidth);

		if (this.scrollSpacer) {
			this.scrollSpacer.style.height = `${totalHeight}px`;
			this.scrollSpacer.style.width = `${totalWidth}px`;
		}

		if (this.centerLayer) {
			const viewportWidth = this.engine.viewport.viewportWidth;
			const targetWidth = `${Math.max(totalWidth, viewportWidth)}px`;

			this.centerLayer.style.width = targetWidth;
			this.centerLayer.style.height = `${totalHeight}px`;

			if (this.headerLayer) this.headerLayer.style.width = targetWidth;

			const pinLeftWidth =
				this.engine.viewport.pinLeftColumns > 0 ? this.engine.geometry.colLefts[this.engine.viewport.pinLeftColumns] || 0 : 0;
			if (this.leftLayer) this.leftLayer.style.width = `${pinLeftWidth}px`;
			if (this.headerLeftLayer) this.headerLeftLayer.style.width = `${pinLeftWidth}px`;

			const firstRightPinColIdx = colCount - this.engine.viewport.pinRightColumns;
			const pinRightWidth =
				this.engine.viewport.pinRightColumns > 0 ? totalWidth - (this.engine.geometry.colLefts[firstRightPinColIdx] || totalWidth) : 0;
			if (this.rightLayer) this.rightLayer.style.width = `${pinRightWidth}px`;
			if (this.headerRightLayer) this.headerRightLayer.style.width = `${pinRightWidth}px`;
		}

		// 2. Recycle viewport
		this.recycleViewport();

		// 3. Draw headers
		this.paintHeaders();

		// 4. Draw selection overlay and focus indicators
		this.paintOverlay();

		this.engine.eventBus.dispatchEvent('afterRender', null);
	}

	/**
	 * Perform row & cell level recycling, reusing DOM elements out of screen.
	 */
	private recycleViewport(): void {
		const rowModel = this.engine.getRowModel();
		let rowCount = rowModel ? rowModel.getRowCount() : 0;
		const state = this.engine.stateManager.getState();
		if (state.loading && rowCount === 0) {
			rowCount = state.loadingSkeletonCount ?? 15;
		}
		const colCount = state.columns.length;

		if (rowCount === 0 || colCount === 0) {
			this.clearActiveRows();
			return;
		}

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;
		const scrollTop = this.engine.viewport.scrollTop;
		const scrollLeft = this.engine.viewport.scrollLeft;
		const viewportHeight = this.engine.viewport.viewportHeight;
		const viewportWidth = this.engine.viewport.viewportWidth;

		// Calculate current visible row and column indexes using viewport models
		const newRowRange = this.engine.viewport.getVisibleRowRange(rowCount);
		const newColRange = this.engine.viewport.getVisibleColumnRange(colCount);

		// If server row model is registered, trigger loading visible blocks
		if (rowModel && typeof rowModel.loadVisibleBlocks === 'function') {
			const visibleRowIndices = [];
			for (let i = newRowRange.startIdx; i <= newRowRange.endIdx; i++) {
				visibleRowIndices.push(i);
			}
			rowModel.loadVisibleBlocks(visibleRowIndices);
		}

		const startRow = newRowRange.startIdx;
		const endRow = newRowRange.endIdx;

		// Phase 1: Releasing scrolled-out rows back to the recycling pool
		for (const [rowIndex, pooledRow] of this.activeRows.entries()) {
			const isPinnedTop = rowIndex < pinTopRows;
			const isPinnedBottom = rowIndex >= rowCount - pinBottomRows;
			const isScrollable = rowIndex >= startRow && rowIndex <= endRow;

			if (!isPinnedTop && !isPinnedBottom && !isScrollable) {
				this.releaseRow(rowIndex, pooledRow);
			}
		}

		// Phase 2: Render/Reposition rows in current range
		const columns = state.columns;

		const renderRow = (r: number) => {
			let node = rowModel ? rowModel.getRowNode(r) : null;
			if (!node && state.loading) {
				node = new RowNode(`__loading_${r}`, null as any);
			}
			if (!node) return;

			let pooledRow = this.activeRows.get(r);

			if (!pooledRow) {
				// Acquire unused row divs from the pool
				const rowEl = this.rowPool.acquire();
				const leftEl = this.rowPool.acquire();
				const rightEl = this.rowPool.acquire();

				pooledRow = {
					element: rowEl,
					leftElement: leftEl,
					rightElement: rightEl,
					cells: new Map(),
					boundRowIndex: r,
					boundRowId: node.id,
					isDirty: false,
				};
				this.activeRows.set(r, pooledRow);

				// Append row divs to center layer
				if (this.centerLayer) this.centerLayer.appendChild(rowEl);
				if (this.leftLayer) this.leftLayer.appendChild(leftEl);
				if (this.rightLayer) this.rightLayer.appendChild(rightEl);
			} else if (pooledRow.boundRowId !== node.id) {
				for (const c of Array.from(pooledRow.cells.keys())) {
					this.releaseCell(pooledRow, c);
				}
				pooledRow.boundRowId = node.id;
			}

			// Reposition row via fast translate3d transform promote
			let rowTop = this.engine.geometry.rowTops[r];
			const rowHeight = this.engine.geometry.rowHeights[r];

			if (r < pinTopRows) {
				rowTop = rowTop + scrollTop;
			} else if (r >= rowCount - pinBottomRows) {
				const totalHeight = this.engine.geometry.getTotalHeight(state.defaultRowHeight);
				const bottomOffset = totalHeight - this.engine.geometry.rowTops[r];
				rowTop = scrollTop + viewportHeight - bottomOffset;
			}

			pooledRow.element.style.transform = `translate3d(0, ${rowTop}px, 0)`;
			pooledRow.element.style.height = `${rowHeight}px`;
			pooledRow.element.dataset.rowIndex = String(r);
			pooledRow.element.dataset.rowId = node.id;

			if (pooledRow.leftElement) {
				pooledRow.leftElement.style.transform = `translate3d(0, ${rowTop}px, 0)`;
				pooledRow.leftElement.style.height = `${rowHeight}px`;
				pooledRow.leftElement.dataset.rowIndex = String(r);
				pooledRow.leftElement.dataset.rowId = node.id;
			}
			if (pooledRow.rightElement) {
				pooledRow.rightElement.style.transform = `translate3d(0, ${rowTop}px, 0)`;
				pooledRow.rightElement.style.height = `${rowHeight}px`;
				pooledRow.rightElement.dataset.rowIndex = String(r);
				pooledRow.rightElement.dataset.rowId = node.id;
			}

			// Handle row class names including pinning and selection states
			let rowClassName = 'og-row';
			if (r < pinTopRows) {
				rowClassName += ' og-row-pinned-top';
			} else if (r >= rowCount - pinBottomRows) {
				rowClassName += ' og-row-pinned-bottom';
			}
			if (node.selected) {
				rowClassName += ' og-row-selected';
			}
			if (this.engine.data.isRowLoading(node.id)) {
				rowClassName += ' og-row-loading';
			}
			if (state.styleSlots?.rowClass && node.data) {
				try {
					const customRowClass = state.styleSlots.rowClass(node.data);
					if (customRowClass) {
						rowClassName += ' ' + customRowClass;
					}
				} catch (e) {
					console.error('RenderEngine: Error in rowClass styleSlot', e);
				}
			}
			pooledRow.element.className = rowClassName;
			if (pooledRow.leftElement) pooledRow.leftElement.className = rowClassName;
			if (pooledRow.rightElement) pooledRow.rightElement.className = rowClassName;

			// Recycle individual cells inside this row
			this.recycleRowCells(pooledRow, node, r, newColRange.startIdx, newColRange.endIdx, columns);
		};

		// 1. Render pinned top rows
		for (let r = 0; r < pinTopRows; r++) {
			renderRow(r);
		}

		// 2. Render scrollable rows
		for (let r = startRow; r <= endRow; r++) {
			if (r >= pinTopRows && r < rowCount - pinBottomRows) {
				renderRow(r);
			}
		}

		// 3. Render pinned bottom rows
		for (let r = rowCount - pinBottomRows; r < rowCount; r++) {
			if (r >= 0) {
				renderRow(r);
			}
		}

		this.currentRowRange = newRowRange;
		this.currentColRange = newColRange;
	}

	/**
	 * Recycles cells horizontally inside an active row.
	 */
	private recycleRowCells(
		pooledRow: PooledRow,
		node: RowNode,
		rowIndex: number,
		startCol: number,
		endCol: number,
		columns: ColumnDef<any>[]
	): void {
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const colCount = columns.length;
		const scrollLeft = this.engine.viewport.scrollLeft;
		const viewportWidth = this.engine.viewport.viewportWidth;

		// 1. Release cells out-of-column bounds
		for (const [c, cell] of pooledRow.cells.entries()) {
			if (cell) {
				const isPinnedLeft = c < pinLeftColumns;
				const isPinnedRight = c >= colCount - pinRightColumns;
				const isScrollable = c >= startCol && c <= endCol;

				if (!isPinnedLeft && !isPinnedRight && !isScrollable) {
					this.releaseCell(pooledRow, c);
				}
			}
		}

		// 2. Bind cells in visible range
		const renderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;

			let cell = pooledRow.cells.get(c);

			if (!cell) {
				cell = this.cellPool.acquire();
				pooledRow.cells.set(c, cell);
			}

			let cellLeft = this.engine.geometry.colLefts[c];
			const cellWidth = this.engine.geometry.colWidths[c];

			let targetRowEl = pooledRow.element;

			if (c < pinLeftColumns) {
				targetRowEl = pooledRow.leftElement!;
			} else if (c >= colCount - pinRightColumns) {
				const firstRightPinColLeft = this.engine.geometry.colLefts[colCount - pinRightColumns];
				cellLeft = cellLeft - firstRightPinColLeft;
				targetRowEl = pooledRow.rightElement!;
			} else {
				// Normal cells do not need scrollLeft subtracted anymore due to CSS grid
			}

			if (cell.parentNode !== targetRowEl) {
				targetRowEl.appendChild(cell);
			}

			cell.style.transform = `translate3d(${cellLeft}px, 0, 0)`;
			cell.style.width = `${cellWidth}px`;
			cell.dataset.colField = col.field;
			cell.dataset.rowIndex = String(rowIndex);

			// Focus / Selection styles
			const state = this.engine.stateManager.getState();
			const isFocused = state.focusedCell?.rowId === node.id && state.focusedCell?.colField === col.field;

			const isLoading = this.engine.data.isRowLoading(node.id) || !!col.loading;

			// Handle classes including pinning, focus, and loading
			let cellClassName = 'og-cell';
			if (c < pinLeftColumns) {
				cellClassName += ' og-cell-pinned-left';
			} else if (c >= colCount - pinRightColumns) {
				cellClassName += ' og-cell-pinned-right';
			}
			if (isFocused) {
				cellClassName += ' og-cell-focused';
				cell.tabIndex = -1;
				const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
				if (
					activeEl &&
					(activeEl === document.body ||
						(this.container &&
							this.container.contains(activeEl) &&
							activeEl !== cell &&
							activeEl.tagName !== 'INPUT' &&
							activeEl.tagName !== 'TEXTAREA'))
				) {
					cell.focus();
				}
			} else {
				cell.removeAttribute('tabindex');
			}
			if (isLoading) {
				cellClassName += ' og-cell-loading';
			}
			if (state.styleSlots?.cellClass && node.data) {
				try {
					const customCellClass = state.styleSlots.cellClass(col, node.data);
					if (customCellClass) {
						cellClassName += ' ' + customCellClass;
					}
				} catch (e) {
					console.error('RenderEngine: Error in cellClass styleSlot', e);
				}
			}
			cell.className = cellClassName;

			// Bind value
			const cellValue = this.engine.data.getCellValue(node.id, col.field);
			const cellKey = createCellKey(node.id, col.field);

			const isEditing = state.activeEdit?.rowId === node.id && state.activeEdit?.colField === col.field;

			// Custom renderer hook trigger or fast direct text bind (bypassed if loading to paint native skeletons synchronously)
			if ((col.cellRenderer || isEditing) && !isLoading) {
				if (cell.dataset.cellKey !== cellKey) {
					if (cell.dataset.cellKey && this.onUnmountReactPortal) {
						this.onUnmountReactPortal(cell.dataset.cellKey);
					}
					// Set content empty so custom React portal doesn't clash with stale text
					cell.textContent = '';
					cell.dataset.cellKey = cellKey;
				}
				if (this.onMountReactPortal) {
					this.onMountReactPortal(cellKey, cell, cellValue, node, col, isEditing, isLoading);
				}
			} else {
				if (cell.dataset.cellKey) {
					if (this.onUnmountReactPortal) {
						this.onUnmountReactPortal(cell.dataset.cellKey);
					}
					delete cell.dataset.cellKey;
				}
				if (isLoading) {
					if (!cell.querySelector('.og-cell-loading-skeleton')) {
						cell.textContent = '';
						const skeleton = document.createElement('div');
						skeleton.className = 'og-cell-loading-skeleton';
						cell.appendChild(skeleton);
					}
				} else {
					// Clean up skeleton if transitioning from loading to loaded state
					const skeletonEl = cell.querySelector('.og-cell-loading-skeleton');
					if (skeletonEl) {
						skeletonEl.remove();
					}
					// Fast path text mutation
					const nextValText = cellValue != null ? String(cellValue) : '';
					if (cell.textContent !== nextValText) {
						cell.textContent = nextValText;
					}
				}
			}
		};

		// 3. Render left pinned cells
		for (let c = 0; c < pinLeftColumns; c++) {
			renderCell(c);
		}

		// 4. Render scrollable cells
		for (let c = startCol; c <= endCol; c++) {
			if (c >= pinLeftColumns && c < colCount - pinRightColumns) {
				renderCell(c);
			}
		}

		// 5. Render right pinned cells
		for (let c = colCount - pinRightColumns; c < colCount; c++) {
			if (c >= 0) {
				renderCell(c);
			}
		}
	}

	/**
	 * Release and return a cell element to the DOMPool.
	 */
	private releaseCell(pooledRow: PooledRow, colIdx: number): void {
		const cell = pooledRow.cells.get(colIdx);
		if (cell) {
			if (cell.dataset.cellKey) {
				if (this.onUnmountReactPortal) {
					this.onUnmountReactPortal(cell.dataset.cellKey);
				}
				delete cell.dataset.cellKey;
			} else {
				// Trigger unmount React portal bridge if applicable
				const col = this.engine.stateManager.getState().columns[colIdx];
				if (col && this.onUnmountReactPortal) {
					const cellKey = createCellKey(pooledRow.boundRowId, col.field);
					this.onUnmountReactPortal(cellKey);
				}
			}

			// Detach from ANY parent (center, left pinned, or right pinned row element)
			if (cell.parentNode) {
				try {
					cell.remove();
				} catch (e) {
					// Safe unmount boundary catch
				}
			}
			this.cellPool.release(cell);
			pooledRow.cells.delete(colIdx);
		}
	}

	/**
	 * Release and return an entire row and all its cells to the pools.
	 */
	private releaseRow(rowIndex: number, pooledRow: PooledRow): void {
		// Release all cell DOMs inside row
		for (const c of pooledRow.cells.keys()) {
			this.releaseCell(pooledRow, c);
		}
		pooledRow.cells.clear();

		// Detach row elements and recycle
		if (pooledRow.element.parentNode) pooledRow.element.remove();
		if (pooledRow.leftElement && pooledRow.leftElement.parentNode) pooledRow.leftElement.remove();
		if (pooledRow.rightElement && pooledRow.rightElement.parentNode) pooledRow.rightElement.remove();

		this.rowPool.release(pooledRow.element);
		if (pooledRow.leftElement) this.rowPool.release(pooledRow.leftElement);
		if (pooledRow.rightElement) this.rowPool.release(pooledRow.rightElement);
		this.activeRows.delete(rowIndex);
	}

	/**
	 * Empties all active visible rows back into recycling.
	 */
	private clearActiveRows(): void {
		for (const [rowIndex, pooledRow] of this.activeRows.entries()) {
			this.releaseRow(rowIndex, pooledRow);
		}
		this.activeRows.clear();
	}

	/**
	 * Renders the grid column headers.
	 */
	private paintHeaders(): void {
		if (!this.headerLayer || !this.headerLeftLayer || !this.headerRightLayer) return;

		const columns = this.engine.stateManager.getState().columns;
		const colCount = columns.length;
		if (colCount === 0) {
			this.clearHeaderCells();
			return;
		}

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;

		const newColRange = this.engine.viewport.getVisibleColumnRange(colCount);
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
			} else if (c >= colCount - pinRightColumns) {
				className += ' og-header-cell-pinned-right';
				const firstRightPinColLeft = this.engine.geometry.colLefts[colCount - pinRightColumns];
				cellLeft = cellLeft - firstRightPinColLeft;
				targetLayer = this.headerRightLayer;
			} else {
				// No manual scrollLeft subtraction needed due to native CSS Grid scrolling!
			}

			const state = this.engine.stateManager.getState();
			if (state.styleSlots?.headerCellClass) {
				try {
					const customHeaderClass = state.styleSlots.headerCellClass(col);
					if (customHeaderClass) {
						className += ' ' + customHeaderClass;
					}
				} catch (e) {
					console.error('RenderEngine: Error in headerCellClass styleSlot', e);
				}
			}
			if (state.enableColumnReorder && col.movable !== false) {
				className += ' og-header-cell-movable';
			}
			if (this.isColumnReordering && this.columnDragField === col.field) {
				className += ' og-header-cell-dragging';
			}

			headerCell.className = className;
			headerCell.style.transform = `translate3d(${cellLeft}px, 0, 0)`;
			headerCell.style.width = `${cellWidth}px`;

			const textSpan = headerCell.firstElementChild as HTMLSpanElement | null;
			if (textSpan && textSpan.textContent !== (col.header || col.field)) {
				textSpan.textContent = col.header || col.field;
			}

			headerCell.dataset.colField = col.field;
			headerCell.dataset.colIndex = String(c);
			if (headerCell.parentNode !== targetLayer) {
				targetLayer!.appendChild(headerCell);
			}
		};

		// 1. Render pinned left headers
		for (let c = 0; c < pinLeftColumns; c++) {
			renderHeaderCell(c);
		}

		// 2. Render scrollable headers
		for (let c = newColRange.startIdx; c <= newColRange.endIdx; c++) {
			if (c >= pinLeftColumns && c < colCount - pinRightColumns) {
				renderHeaderCell(c);
			}
		}

		// 3. Render pinned right headers
		for (let c = colCount - pinRightColumns; c < colCount; c++) {
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
	}

	private createHeaderCellElement(): HTMLDivElement {
		const headerCell = document.createElement('div');
		headerCell.addEventListener('mousedown', this.onHeaderCellMouseDown);

		const textSpan = document.createElement('span');
		textSpan.style.overflow = 'hidden';
		textSpan.style.textOverflow = 'ellipsis';
		textSpan.style.whiteSpace = 'nowrap';
		textSpan.style.flex = '1';
		headerCell.appendChild(textSpan);

		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'og-header-resize-handle';
		resizeHandle.addEventListener('mousedown', this.onHeaderResizeMouseDown);
		headerCell.appendChild(resizeHandle);

		return headerCell;
	}

	private clearHeaderCells(): void {
		for (const cell of this.headerCells.values()) {
			cell.remove();
		}
		this.headerCells.clear();
	}

	private onHeaderResizeMouseDown = (e: MouseEvent): void => {
		e.preventDefault();
		e.stopPropagation();

		const headerCell = (e.currentTarget as HTMLElement).closest('.og-header-cell') as HTMLElement | null;
		const colField = headerCell?.dataset.colField;
		const colIndex = Number(headerCell?.dataset.colIndex);
		if (!colField || !Number.isFinite(colIndex)) return;

		const startX = e.clientX;
		const startWidth = this.engine.geometry.getColWidth(colIndex, this.engine.stateManager.getState().defaultColWidth);
		let currentWidth = startWidth;

		const onMouseMove = (moveEvent: MouseEvent) => {
			const deltaX = moveEvent.clientX - startX;
			currentWidth = Math.max(30, startWidth + deltaX);
			this.engine.setColumnWidth(colField, currentWidth);
		};

		const onMouseUp = () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);

			this.engine.commandBus.dispatch({
				type: 'SET_COLUMN_WIDTH',
				payload: {
					colField,
					width: currentWidth,
				},
			});
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	};

	private onHeaderCellMouseDown = (e: MouseEvent): void => {
		if (e.button !== 0 || (e.target as HTMLElement).closest('.og-header-resize-handle')) return;

		const state = this.engine.stateManager.getState();
		if (!state.enableColumnReorder) return;

		const headerCell = e.currentTarget as HTMLElement;
		const colField = headerCell.dataset.colField;
		const colIndex = Number(headerCell.dataset.colIndex);
		const column = colField ? state.columns[colIndex] : null;
		if (!colField || !Number.isFinite(colIndex) || column?.movable === false) return;

		this.columnDragStartX = e.clientX;
		this.columnDragStartY = e.clientY;
		this.columnDragFromIndex = colIndex;
		this.columnDragField = colField;
		this.columnDropInsertionIndex = colIndex;

		window.addEventListener('mousemove', this.onHeaderColumnDragMove);
		window.addEventListener('mouseup', this.onHeaderColumnDragMouseUp);
		window.addEventListener('blur', this.onHeaderColumnDragMouseUp);
	};

	private onHeaderColumnDragMove = (e: MouseEvent): void => {
		const dragDistance = Math.max(Math.abs(e.clientX - this.columnDragStartX), Math.abs(e.clientY - this.columnDragStartY));
		if (!this.isColumnReordering) {
			if (dragDistance < 4) return;
			this.isColumnReordering = true;
			this.ensureColumnDropIndicator();
			this.schedulePaint();
		}

		e.preventDefault();
		this.updateColumnDropTarget(e);
	};

	private onHeaderColumnDragMouseUp = (): void => {
		const wasReordering = this.isColumnReordering;
		const fromIndex = this.columnDragFromIndex;
		const insertionIndex = this.columnDropInsertionIndex;
		const colField = this.columnDragField;

		this.cleanupColumnReorderDrag();

		if (!wasReordering || !colField || fromIndex < 0 || insertionIndex < 0) {
			this.schedulePaint();
			return;
		}

		const state = this.engine.stateManager.getState();
		const toIndex = Math.max(0, Math.min(state.columns.length - 1, insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex));
		if (toIndex !== fromIndex) {
			this.engine.commandBus.dispatch({
				type: 'MOVE_COLUMN',
				payload: { colField, toIndex },
			});
		} else {
			this.schedulePaint();
		}
	};

	private cleanupColumnReorderDrag(): void {
		window.removeEventListener('mousemove', this.onHeaderColumnDragMove);
		window.removeEventListener('mouseup', this.onHeaderColumnDragMouseUp);
		window.removeEventListener('blur', this.onHeaderColumnDragMouseUp);

		this.isColumnReordering = false;
		this.columnDragFromIndex = -1;
		this.columnDragField = null;
		this.columnDropInsertionIndex = -1;
		this.removeColumnDropIndicator();
	}

	private ensureColumnDropIndicator(): void {
		if (this.columnDropIndicator || !this.overlayLayer) return;

		this.columnDropIndicator = document.createElement('div');
		this.columnDropIndicator.className = 'og-column-drop-indicator';
		this.overlayLayer.appendChild(this.columnDropIndicator);
	}

	private removeColumnDropIndicator(): void {
		this.columnDropIndicator?.remove();
		this.columnDropIndicator = null;
	}

	private updateColumnDropTarget(e: MouseEvent): void {
		if (!this.scrollViewport || !this.columnDropIndicator) return;

		const state = this.engine.stateManager.getState();
		if (state.columns.length === 0) return;

		const scrollRect = this.scrollViewport.getBoundingClientRect();
		const contentX = e.clientX - scrollRect.left + this.scrollViewport.scrollLeft;
		const targetCol = Math.max(0, Math.min(state.columns.length - 1, this.engine.geometry.getColIndexAtOffset(contentX)));
		const targetLeft = this.engine.geometry.colLefts[targetCol] || 0;
		const targetWidth = this.engine.geometry.colWidths[targetCol] || state.defaultColWidth;
		const insertAfterTarget = contentX > targetLeft + targetWidth / 2;
		const insertionIndex = Math.max(0, Math.min(state.columns.length, targetCol + (insertAfterTarget ? 1 : 0)));

		this.columnDropInsertionIndex = insertionIndex;

		const indicatorContentLeft = insertionIndex >= state.columns.length
			? this.engine.geometry.getTotalWidth(state.defaultColWidth)
			: this.engine.geometry.colLefts[insertionIndex] || 0;
		const indicatorViewportLeft = indicatorContentLeft - this.scrollViewport.scrollLeft;

		this.columnDropIndicator.style.display = 'block';
		this.columnDropIndicator.style.transform = `translate3d(${indicatorViewportLeft}px, 0, 0)`;
		this.columnDropIndicator.style.height = `${Math.max(0, this.engine.viewport.viewportHeight - 40)}px`;
	}

	/**
	 * Computes selection overlays & active focus coordinates off-screen.
	 */
	private paintOverlay(): void {
		if (!this.overlayLayer) return;

		// Clear overlay layer
		this.overlayLayer.textContent = '';

		const state = this.engine.stateManager.getState();
		const bounds = state.selectedRangeBounds;

		if (!bounds || !this.engine.getRowModel()) return;

		const rowModel = this.engine.getRowModel()!;
		const rowCount = rowModel.getRowCount();
		const columns = state.columns;
		const colCount = columns.length;

		// Check if selection limits lie inside current loaded row scope
		const minRow = Math.max(0, bounds.minRow);
		const maxRow = Math.min(rowCount - 1, bounds.maxRow);
		const minCol = Math.max(0, bounds.minCol);
		const maxCol = Math.min(colCount - 1, bounds.maxCol);

		if (minRow > maxRow || minCol > maxCol) return;

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;
		const scrollTop = this.engine.viewport.scrollTop;
		const scrollLeft = this.engine.viewport.scrollLeft;
		const viewportHeight = this.engine.viewport.viewportHeight;
		const viewportWidth = this.engine.viewport.viewportWidth;

		// 1. Calculate pinned column widths for clamping
		let pinnedLeftWidth = 0;
		for (let i = 0; i < pinLeftColumns && i < colCount; i++) {
			pinnedLeftWidth += this.engine.geometry.colWidths[i] || 0;
		}

		let pinnedRightWidth = 0;
		for (let i = 0; i < pinRightColumns && i < colCount; i++) {
			pinnedRightWidth += this.engine.geometry.colWidths[colCount - 1 - i] || 0;
		}

		// 2. Calculate pinned row heights for clamping
		let pinnedTopHeight = 0;
		for (let i = 0; i < pinTopRows && i < rowCount; i++) {
			pinnedTopHeight += this.engine.geometry.rowHeights[i] || 0;
		}

		let pinnedBottomHeight = 0;
		for (let i = 0; i < pinBottomRows && i < rowCount; i++) {
			pinnedBottomHeight += this.engine.geometry.rowHeights[rowCount - 1 - i] || 0;
		}

		// Helper to get clamped X coordinate range for a column
		const getClampedX = (c: number): { left: number; right: number } => {
			const cellLeft = this.engine.geometry.colLefts[c] || 0;
			const cellWidth = this.engine.geometry.colWidths[c] || 0;

			if (c < pinLeftColumns) {
				return { left: cellLeft, right: cellLeft + cellWidth };
			} else if (c >= colCount - pinRightColumns) {
				const firstRightPinColIdx = colCount - pinRightColumns;
				const firstRightPinColLeft = this.engine.geometry.colLefts[firstRightPinColIdx] || 0;
				const left = viewportWidth - pinnedRightWidth + (cellLeft - firstRightPinColLeft);
				return { left, right: left + cellWidth };
			} else {
				const unclippedLeft = cellLeft - scrollLeft;
				const unclippedRight = unclippedLeft + cellWidth;
				const left = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedLeft));
				const right = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedRight));
				return { left, right };
			}
		};

		// Helper to get clamped Y coordinate range for a row
		const getClampedY = (r: number): { top: number; bottom: number } => {
			const rowTop = this.engine.geometry.rowTops[r] || 0;
			const rowHeight = this.engine.geometry.rowHeights[r] || 0;

			if (r < pinTopRows) {
				return { top: rowTop, bottom: rowTop + rowHeight };
			} else if (r >= rowCount - pinBottomRows) {
				const totalHeight = this.engine.geometry.getTotalHeight(state.defaultRowHeight);
				const bottomOffset = totalHeight - rowTop;
				const top = viewportHeight - 40 - bottomOffset;
				return { top, bottom: top + rowHeight };
			} else {
				const unclippedTop = rowTop - scrollTop;
				const unclippedBottom = unclippedTop + rowHeight;
				const top = Math.max(pinnedTopHeight, Math.min(viewportHeight - 40 - pinnedBottomHeight, unclippedTop));
				const bottom = Math.max(pinnedTopHeight, Math.min(viewportHeight - 40 - pinnedBottomHeight, unclippedBottom));
				return { top, bottom };
			}
		};

		const xRangeMin = getClampedX(minCol);
		const xRangeMax = getClampedX(maxCol);
		const yRangeMin = getClampedY(minRow);
		const yRangeMax = getClampedY(maxRow);

		const selectionLeft = xRangeMin.left;
		const selectionRight = xRangeMax.right;
		const selectionTop = yRangeMin.top;
		const selectionBottom = yRangeMax.bottom;

		const width = selectionRight - selectionLeft;
		const height = selectionBottom - selectionTop;

		if (width <= 0 || height <= 0) return;

		// Selection border element
		const selectionBorder = document.createElement('div');
		selectionBorder.className = 'og-selection-border';

		// Position selection border overlay absolute
		selectionBorder.style.transform = `translate3d(${selectionLeft}px, ${selectionTop}px, 0)`;
		selectionBorder.style.width = `${width}px`;
		selectionBorder.style.height = `${height}px`;

		// Draw Selection Fill Handle
		const fillHandle = document.createElement('div');
		fillHandle.className = 'og-selection-fill-handle';
		fillHandle.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			this.startFillDrag(e, minRow, maxRow, minCol, maxCol);
		});
		selectionBorder.appendChild(fillHandle);

		this.overlayLayer.appendChild(selectionBorder);

		// Re-append the fill preview border if actively dragging so it doesn't get cleared by textContent = ''
		if (this.isFilling && this.fillPreviewBorder && this.overlayLayer) {
			this.overlayLayer.appendChild(this.fillPreviewBorder);
			this.updateFillPreview();
		}
	}

	/**
	 * Factory function for building a row element wrapper.
	 */
	private createRowElement(): HTMLDivElement {
		const el = document.createElement('div');
		el.className = 'og-row';
		return el;
	}

	/**
	 * Factory function for building a cell element wrapper.
	 */
	private createCellElement(): HTMLDivElement {
		const el = document.createElement('div');
		el.className = 'og-cell';

		// Patch removeChild to handle React Portal unmounting gracefully when recycled
		const originalRemoveChild = el.removeChild;
		el.removeChild = function <T extends Node>(child: T): T {
			if (child.parentNode === this) {
				return originalRemoveChild.call(this, child) as T;
			}
			return child;
		};

		return el;
	}

	private startFillDrag(e: MouseEvent, minRow: number, maxRow: number, minCol: number, maxCol: number): void {
		if (this.isFilling) return;
		this.isFilling = true;

		this.fillStartRow = minRow;
		this.fillEndRow = maxRow;
		this.fillStartCol = minCol;
		this.fillEndCol = maxCol;

		this.fillDragStartX = e.clientX;
		this.fillDragStartY = e.clientY;
		this.fillDragDirectionLock = null; // Reset direction lock

		// Create fill preview element
		this.fillPreviewBorder = document.createElement('div');
		this.fillPreviewBorder.className = 'og-fill-preview-border';
		if (this.overlayLayer) {
			this.overlayLayer.appendChild(this.fillPreviewBorder);
		}

		this.currentFillPreview = null;

		window.addEventListener('mousemove', this.onFillDragMove);
		window.addEventListener('mouseup', this.onFillDragMouseUp);
		window.addEventListener('blur', this.onFillDragMouseUp);
		document.addEventListener('mouseleave', this.onFillDragMouseUp);
	}

	private onFillDragMove = (e: MouseEvent): void => {
		try {
			if (!this.isFilling || !this.scrollViewport || !this.fillPreviewBorder) return;

			// Calculate mouse coordinates relative to scroll viewport
			const scrollRect = this.scrollViewport.getBoundingClientRect();
			const mouseX = e.clientX - scrollRect.left + this.scrollViewport.scrollLeft;
			const mouseY = e.clientY - scrollRect.top + this.scrollViewport.scrollTop - 40; // 40px margin header

			// Get current coordinate indices under pointer
			const currRow = this.engine.geometry.getRowIndexAtOffset(mouseY);
			const currCol = this.engine.geometry.getColIndexAtOffset(mouseX);

			if (this.fillDragDirectionLock === null) {
				const rowDiff = currRow > this.fillEndRow ? currRow - this.fillEndRow : currRow < this.fillStartRow ? this.fillStartRow - currRow : 0;
				const colDiff = currCol > this.fillEndCol ? currCol - this.fillEndCol : currCol < this.fillStartCol ? this.fillStartCol - currCol : 0;

				if (rowDiff > 0 || colDiff > 0) {
					this.fillDragDirectionLock = rowDiff >= colDiff ? 'VERTICAL' : 'HORIZONTAL';
				} else {
					// Still inside original selection bounds, clear preview and return
					this.currentFillPreview = null;
					this.updateFillPreview();
					return;
				}
			}

		// Auto-scroll when dragging near viewport edges
		const edgeThreshold = 35; // 35px from edge
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
			this.scrollViewport.scrollTop = Math.max(0, Math.min(this.scrollViewport.scrollHeight - this.scrollViewport.clientHeight, this.scrollViewport.scrollTop + scrollSpeedY));
			scrolled = true;
		}

		if (scrollSpeedX !== 0) {
			this.scrollViewport.scrollLeft = Math.max(0, Math.min(this.scrollViewport.scrollWidth - this.scrollViewport.clientWidth, this.scrollViewport.scrollLeft + scrollSpeedX));
			scrolled = true;
		}

		if (scrolled) {
			this.scrollEngine.scrollTo(this.scrollViewport.scrollTop, this.scrollViewport.scrollLeft);
		}

		const isVertical = this.fillDragDirectionLock === 'VERTICAL';

		let direction: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT' | null = null;
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

		this.updateFillPreview();
		} catch (err) {
			console.error('RenderEngine: Error in onFillDragMove', err);
			this.onFillDragMouseUp();
		}
	};

	private updateFillPreview(): void {
		if (!this.fillPreviewBorder || !this.overlayLayer) return;

		if (!this.isFilling || !this.currentFillPreview) {
			this.fillPreviewBorder.style.display = 'none';
			return;
		}

		const { minRow, maxRow, minCol, maxCol } = this.currentFillPreview;

		const state = this.engine.stateManager.getState();
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getRowCount() : 0;
		const columns = state.columns;
		const colCount = columns.length;

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
			} else if (c >= colCount - pinRightColumns) {
				const firstRightPinColIdx = colCount - pinRightColumns;
				const firstRightPinColLeft = this.engine.geometry.colLefts[firstRightPinColIdx] || 0;
				const left = viewportWidth - pinnedRightWidth + (cellLeft - firstRightPinColLeft);
				return { left, right: left + cellWidth };
			} else {
				const unclippedLeft = cellLeft - scrollLeft;
				const unclippedRight = unclippedLeft + cellWidth;
				const left = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedLeft));
				const right = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedRight));
				return { left, right };
			}
		};

		const getClampedY = (r: number): { top: number; bottom: number } => {
			const rowTop = this.engine.geometry.rowTops[r] || 0;
			const rowHeight = this.engine.geometry.rowHeights[r] || 0;

			if (r < pinTopRows) {
				return { top: rowTop, bottom: rowTop + rowHeight };
			} else if (r >= rowCount - pinBottomRows) {
				const totalHeight = this.engine.geometry.getTotalHeight(state.defaultRowHeight);
				const bottomOffset = totalHeight - rowTop;
				const top = viewportHeight - 40 - bottomOffset;
				return { top, bottom: top + rowHeight };
			} else {
				const unclippedTop = rowTop - scrollTop;
				const unclippedBottom = unclippedTop + rowHeight;
				const top = Math.max(pinnedTopHeight, Math.min(viewportHeight - 40 - pinnedBottomHeight, unclippedTop));
				const bottom = Math.max(pinnedTopHeight, Math.min(viewportHeight - 40 - pinnedBottomHeight, unclippedBottom));
				return { top, bottom };
			}
		};

		const xRangeMin = getClampedX(minCol);
		const xRangeMax = getClampedX(maxCol);
		const yRangeMin = getClampedY(minRow);
		const yRangeMax = getClampedY(maxRow);

		const pLeft = xRangeMin.left;
		const pRight = xRangeMax.right;
		const pTop = yRangeMin.top;
		const pBottom = yRangeMax.bottom;

		const pWidth = pRight - pLeft;
		const pHeight = pBottom - pTop;

		if (pWidth > 0 && pHeight > 0) {
			this.fillPreviewBorder.style.display = 'block';
			this.fillPreviewBorder.style.transform = `translate3d(${pLeft}px, ${pTop}px, 0)`;
			this.fillPreviewBorder.style.width = `${pWidth}px`;
			this.fillPreviewBorder.style.height = `${pHeight}px`;
		} else {
			this.fillPreviewBorder.style.display = 'none';
		}
	};

	private onFillDragMouseUp = (e?: Event): void => {
		window.removeEventListener('mousemove', this.onFillDragMove);
		window.removeEventListener('mouseup', this.onFillDragMouseUp);
		window.removeEventListener('blur', this.onFillDragMouseUp);
		document.removeEventListener('mouseleave', this.onFillDragMouseUp);

		if (!this.isFilling) return;
		this.isFilling = false;
		this.fillDragDirectionLock = null; // Reset lock on mouse release

		if (this.fillPreviewBorder) {
			this.fillPreviewBorder.remove();
			this.fillPreviewBorder = null;
		}

		if (this.currentFillPreview) {
			try {
				const { minRow, maxRow, minCol, maxCol, direction } = this.currentFillPreview;
				this.extrapolateAndFillRange(minRow, maxRow, minCol, maxCol, direction!);
			} catch (err) {
				console.error('RenderEngine: Error during extrapolateAndFillRange', err);
			}
		}

		this.currentFillPreview = null;
	};

	private extrapolateAndFillRange(
		minRowTarget: number,
		maxRowTarget: number,
		minColTarget: number,
		maxColTarget: number,
		direction: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT'
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

		if (!startRowNode || !endRowNode || !startCol || !endCol ||
			!targetStartRowNode || !targetEndRowNode || !targetStartCol || !targetEndCol) {
			return;
		}

		const source: GridCellRange = {
			start: { rowId: startRowNode.id, colField: startCol.field },
			end: { rowId: endRowNode.id, colField: endCol.field }
		};

		const target: GridCellRange = {
			start: { rowId: targetStartRowNode.id, colField: targetStartCol.field },
			end: { rowId: targetEndRowNode.id, colField: targetEndCol.field }
		};

		this.engine.fillRange(source, target);
		this.schedulePaint();
	}

	/**
	 * Dynamic CSS injector supporting grid structure and aesthetics.
	 */
	private injectStyles(): void {
		if (typeof document === 'undefined') return;

		this.styleTag = document.createElement('style');
		this.styleTag.textContent = CORE_STYLES;
		document.head.appendChild(this.styleTag);
	}
}

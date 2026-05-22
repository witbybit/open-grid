import { DOMPool, PooledRow } from './domPool.js';
import { ScrollEngine } from './scrollEngine.js';
import { createCellKey } from '../ids.js';
import type { IGridRenderer } from './IGridRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { RowNode, ColumnDef } from '../store.js';
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
	private unsubscribeStore: (() => void) | null = null;
	private pendingPaint = false;

	// Track current ranges to prevent redundant renders
	private currentRowRange: ViewportRange = { startIdx: -1, endIdx: -1 };
	private currentColRange: ViewportRange = { startIdx: -1, endIdx: -1 };

	// Micro-bridge for React custom renderers/editors
	public onMountReactPortal?: (cellKey: string, container: HTMLElement, value: unknown, node: RowNode, col: ColumnDef, isEditing: boolean, isLoading: boolean) => void;
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

		this.scrollEngine.unbind();

		// Release all active rows and cells
		this.clearActiveRows();

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
			
			const pinLeftWidth = this.engine.viewport.pinLeftColumns > 0 ? this.engine.geometry.colLefts[this.engine.viewport.pinLeftColumns] || 0 : 0;
			if (this.leftLayer) this.leftLayer.style.width = `${pinLeftWidth}px`;
			if (this.headerLeftLayer) this.headerLeftLayer.style.width = `${pinLeftWidth}px`;
			
			const firstRightPinColIdx = colCount - this.engine.viewport.pinRightColumns;
			const pinRightWidth = this.engine.viewport.pinRightColumns > 0 ? totalWidth - (this.engine.geometry.colLefts[firstRightPinColIdx] || totalWidth) : 0;
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
		const rowCount = rowModel ? rowModel.getRowCount() : 0;
		const colCount = this.engine.stateManager.getState().columns.length;

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
		const columns = this.engine.stateManager.getState().columns;

		const renderRow = (r: number) => {
			const node = rowModel!.getRowNode(r);
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
					cells: [],
					boundRowIndex: r,
					boundRowId: node.id,
					isDirty: false,
				};
				this.activeRows.set(r, pooledRow);

				// Append row divs to center layer
				if (this.centerLayer) this.centerLayer.appendChild(rowEl);
				if (this.leftLayer) this.leftLayer.appendChild(leftEl);
				if (this.rightLayer) this.rightLayer.appendChild(rightEl);
			}

			// Reposition row via fast translate3d transform promote
			let rowTop = this.engine.geometry.rowTops[r];
			const rowHeight = this.engine.geometry.rowHeights[r];

			if (r < pinTopRows) {
				rowTop = rowTop + scrollTop;
			} else if (r >= rowCount - pinBottomRows) {
				let heightToBottom = 0;
				for (let i = r + 1; i < rowCount; i++) {
					heightToBottom += this.engine.geometry.rowHeights[i];
				}
				rowTop = scrollTop + viewportHeight - heightToBottom - rowHeight;
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
		for (let c = 0; c < pooledRow.cells.length; c++) {
			const cell = pooledRow.cells[c];
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

			let cell = pooledRow.cells[c];

			if (!cell) {
				cell = this.cellPool.acquire();
				pooledRow.cells[c] = cell;
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

			// Handle classes including pinning and focus
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
			cell.className = cellClassName;

			// Bind value
			const cellValue = this.engine.data.getCellValue(node.id, col.field);
			const cellKey = createCellKey(node.id, col.field);

			const isEditing =
				state.activeEdit?.rowId === node.id &&
				state.activeEdit?.colField === col.field;

			// Custom renderer hook trigger or fast direct text bind
			if (col.cellRenderer || isEditing) {
				if (cell.dataset.cellKey !== cellKey) {
					if (cell.dataset.cellKey && this.onUnmountReactPortal) {
						this.onUnmountReactPortal(cell.dataset.cellKey);
					}
					// Set content empty so custom React portal doesn't clash with stale text
					cell.textContent = '';
					cell.dataset.cellKey = cellKey;
				}
				if (this.onMountReactPortal) {
					const isLoading = this.engine.data.isRowLoading(node.id);
					this.onMountReactPortal(cellKey, cell, cellValue, node, col, isEditing, isLoading);
				}
			} else {
				if (cell.dataset.cellKey) {
					if (this.onUnmountReactPortal) {
						this.onUnmountReactPortal(cell.dataset.cellKey);
					}
					delete cell.dataset.cellKey;
				}
				// Fast path text mutation
				const nextValText = cellValue != null ? String(cellValue) : '';
				if (cell.textContent !== nextValText) {
					cell.textContent = nextValText;
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
		const cell = pooledRow.cells[colIdx];
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
			pooledRow.cells[colIdx] = null;
		}
	}

	/**
	 * Release and return an entire row and all its cells to the pools.
	 */
	private releaseRow(rowIndex: number, pooledRow: PooledRow): void {
		// Release all cell DOMs inside row
		for (let c = 0; c < pooledRow.cells.length; c++) {
			this.releaseCell(pooledRow, c);
		}
		pooledRow.cells = [];

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

		// Clear header DOM nodes
		this.headerLayer.textContent = '';
		this.headerLeftLayer.textContent = '';
		this.headerRightLayer.textContent = '';

		const columns = this.engine.stateManager.getState().columns;
		const colCount = columns.length;
		if (colCount === 0) return;

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const scrollLeft = this.engine.viewport.scrollLeft;
		const viewportWidth = this.engine.viewport.viewportWidth;

		const newColRange = this.engine.viewport.getVisibleColumnRange(colCount);

		const renderHeaderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;

			const headerCell = document.createElement('div');
			
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

			headerCell.className = className;
			headerCell.style.transform = `translate3d(${cellLeft}px, 0, 0)`;
			headerCell.style.width = `${cellWidth}px`;
			
			// Use span or inner container so text does not overlap the resize handle
			const textSpan = document.createElement('span');
			textSpan.textContent = col.header || col.field;
			textSpan.style.overflow = 'hidden';
			textSpan.style.textOverflow = 'ellipsis';
			textSpan.style.whiteSpace = 'nowrap';
			textSpan.style.flex = '1';
			headerCell.appendChild(textSpan);

			headerCell.dataset.colField = col.field;

			// Premium resize handle
			const resizeHandle = document.createElement('div');
			resizeHandle.className = 'og-header-resize-handle';
			
			resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();

				const startX = e.clientX;
				const startWidth = this.engine.geometry.getColWidth(c, this.engine.stateManager.getState().defaultColWidth);
				let currentWidth = startWidth;

				const onMouseMove = (moveEvent: MouseEvent) => {
					const deltaX = moveEvent.clientX - startX;
					currentWidth = Math.max(30, startWidth + deltaX);
					
					// Drag real-time update inside geometry
					this.engine.setColumnWidth(col.field, currentWidth);
				};

				const onMouseUp = () => {
					window.removeEventListener('mousemove', onMouseMove);
					window.removeEventListener('mouseup', onMouseUp);

					// Dispatch columnResized action to record in history
					this.engine.commandBus.dispatch({
						type: 'SET_COLUMN_WIDTH',
						payload: {
							colField: col.field,
							width: currentWidth,
						},
					});
				};

				window.addEventListener('mousemove', onMouseMove);
				window.addEventListener('mouseup', onMouseUp);
			});

			headerCell.appendChild(resizeHandle);
			targetLayer!.appendChild(headerCell);
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
				const left = (viewportWidth - pinnedRightWidth) + (cellLeft - firstRightPinColLeft);
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
				let heightToBottom = 0;
				for (let i = r + 1; i < rowCount; i++) {
					heightToBottom += this.engine.geometry.rowHeights[i] || 0;
				}
				const top = viewportHeight - 40 - heightToBottom - rowHeight;
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

		this.overlayLayer.appendChild(selectionBorder);
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

	/**
	 * Dynamic CSS injector supporting grid structure and aesthetics.
	 */
	private injectStyles(): void {
		if (typeof document === 'undefined') return;

		const css = `
      :root, .og-grid-container {
        --og-font-family: 'Outfit', 'Inter', -apple-system, sans-serif;
        --og-bg-color: #0d0f12;
        --og-text-color: #e2e8f0;
        --og-border-color: #1e293b;
        --og-header-bg: #090a0f;
        --og-header-text: #94a3b8;
        --og-row-hover-bg: #161b22;
        --og-cell-border: rgba(30, 41, 59, 0.5);
        --og-selection-border: rgba(59, 130, 246, 0.6);
        --og-selection-bg: rgba(59, 130, 246, 0.04);
        --og-focus-ring: #3b82f6;
      }

      .og-grid-container {
        position: relative;
        overflow: hidden;
        contain: strict;
        font-family: var(--og-font-family);
        background-color: var(--og-bg-color);
        color: var(--og-text-color);
        border: 1px solid var(--og-border-color);
        border-radius: 8px;
        box-sizing: border-box;
      }

      .og-scroll-viewport {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        overflow: auto;
        contain: strict;
        will-change: transform;
        z-index: 10;
        display: grid;
        grid-template-columns: 1fr;
        grid-template-rows: 1fr;
      }

      .og-scroll-spacer {
        grid-area: 1 / 1 / 2 / 2;
        pointer-events: none;
      }

      .og-layer-center {
        grid-area: 1 / 1 / 2 / 2;
        pointer-events: auto;
        z-index: 10;
        margin-top: 40px;
      }

      .og-layer-left {
        grid-area: 1 / 1 / 2 / 2;
        position: sticky;
        left: 0;
        z-index: 15;
        pointer-events: auto;
        margin-top: 40px;
      }

      .og-layer-right {
        grid-area: 1 / 1 / 2 / 2;
        position: sticky;
        right: 0;
        justify-self: end;
        z-index: 15;
        pointer-events: auto;
        margin-top: 40px;
      }

      .og-layer-header {
        grid-area: 1 / 1 / 2 / 2;
        position: sticky;
        top: 0;
        height: 40px;
        z-index: 30;
        pointer-events: auto;
        border-bottom: 2px solid var(--og-border-color);
        background-color: var(--og-header-bg);
      }

      .og-layer-header-left {
        grid-area: 1 / 1 / 2 / 2;
        position: sticky;
        top: 0;
        left: 0;
        height: 40px;
        z-index: 35;
        pointer-events: auto;
        border-bottom: 2px solid var(--og-border-color);
        background-color: var(--og-header-bg);
      }

      .og-layer-header-right {
        grid-area: 1 / 1 / 2 / 2;
        position: sticky;
        top: 0;
        right: 0;
        justify-self: end;
        height: 40px;
        z-index: 35;
        pointer-events: auto;
        border-bottom: 2px solid var(--og-border-color);
        background-color: var(--og-header-bg);
      }

      .og-layer-overlay {
        position: absolute;
        top: 40px;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 40;
        pointer-events: none;
        overflow: hidden;
      }

      .og-row {
        position: absolute;
        left: 0;
        width: 100%;
        contain: layout style;
        border-bottom: 1px solid var(--og-border-color);
        background-color: var(--og-bg-color);
        box-sizing: border-box;
        transition: background-color 0.15s ease;
      }

      .og-row:hover {
        background-color: var(--og-row-hover-bg);
      }

      .og-row-selected {
        background-color: var(--og-selection-bg) !important;
      }

      .og-row-pinned-top {
        background-color: var(--og-header-bg);
        z-index: 25;
        border-bottom: 2px solid var(--og-border-color) !important;
      }

      .og-row-pinned-bottom {
        background-color: var(--og-header-bg);
        z-index: 25;
        border-top: 2px solid var(--og-border-color) !important;
      }

      .og-cell {
        position: absolute;
        top: 0;
        height: 100%;
        contain: layout style;
        box-sizing: border-box;
        padding: 0 12px;
        display: flex;
        align-items: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-right: 1px solid var(--og-cell-border);
      }

      .og-cell-focused {
        outline: 2px solid var(--og-focus-ring);
        outline-offset: -2px;
        z-index: 20;
      }

      .og-header-cell {
        position: absolute;
        top: 0;
        height: 100%;
        display: flex;
        align-items: center;
        padding: 0 12px;
        font-weight: 600;
        font-size: 13px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--og-header-text);
        border-right: 1px solid var(--og-border-color);
        box-sizing: border-box;
      }

      .og-selection-border {
        position: absolute;
        border: 2px dashed var(--og-selection-border);
        background-color: var(--og-selection-bg);
        box-sizing: border-box;
        pointer-events: none;
      }

      .og-header-resize-handle {
        position: absolute;
        top: 0;
        right: 0;
        width: 6px;
        height: 100%;
        cursor: col-resize;
        z-index: 10;
        transition: background-color 0.15s ease;
      }

      .og-header-resize-handle:hover {
        background-color: var(--og-focus-ring);
      }
    `;

		this.styleTag = document.createElement('style');
		this.styleTag.textContent = css;
		document.head.appendChild(this.styleTag);
	}
}

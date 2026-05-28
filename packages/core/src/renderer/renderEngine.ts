import { DOMPool, PooledRow } from './domPool.js';
import { ScrollEngine } from './scrollEngine.js';
import { ColumnInteractionController } from './columnInteractionController.js';
import { FillDragController, type OverlayBox } from './fillDragController.js';
import { createCellKey } from '../ids.js';
import type { GridCellContentMount, GridCellContentUnmount, GridRowContentMount, GridRowContentUnmount, IGridRenderer } from './IGridRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { RowNode, type ColumnDef, type VisualRow } from '../store.js';
import { CORE_STYLES } from './styles.js';

/**
 * Owns the grid DOM, row/cell recycling, and rAF paint batching.
 */
export class RenderEngine<TRowData = unknown> implements IGridRenderer<TRowData> {
	private engine: GridEngine<TRowData>;
	private rowPool!: DOMPool<HTMLDivElement>;
	private cellPool!: DOMPool<HTMLDivElement>;
	private scrollEngine: ScrollEngine<TRowData>;
	private columnInteractions: ColumnInteractionController<TRowData>;
	private fillDrag: FillDragController<TRowData>;

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
	private selectionBorder: HTMLDivElement | null = null;
	private styleTag: HTMLStyleElement | null = null;

	// Active tracking maps
	private activeRows = new Map<number, PooledRow>(); // rowIndex -> PooledRow
	private headerCells = new Map<number, HTMLDivElement>();
	private unsubscribers: Array<() => void> = [];
	private pendingPaint = false;
	private pendingFullPaint = false;
	private pendingHeaderPaint = false;
	private pendingOverlayPaint = false;
	private dirtyCells = new Map<string, { rowId: string; colField: string }>();
	private dirtyRows = new Set<string>();
	private hoveredRowIndex: number | null = null;

	private selectionDragBounds: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null = null;

	public onMountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	public onUnmountCellContent?: (unmount: GridCellContentUnmount) => void;

	public onMountRowContent?: (mount: GridRowContentMount<TRowData>) => void;
	public onUnmountRowContent?: (unmount: GridRowContentUnmount) => void;

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
		this.scrollEngine = new ScrollEngine<TRowData>(engine);
		this.columnInteractions = new ColumnInteractionController<TRowData>({
			engine,
			getOverlayLayer: () => this.overlayLayer,
			getScrollViewport: () => this.scrollViewport,
			schedulePaint: () => this.schedulePaint(),
		});
		this.fillDrag = new FillDragController<TRowData>({
			engine,
			getOverlayLayer: () => this.overlayLayer,
			getScrollViewport: () => this.scrollViewport,
			getOverlayBox: (minRow, maxRow, minCol, maxCol) => this.getClampedOverlayBox(minRow, maxRow, minCol, maxCol),
			scrollTo: (scrollTop, scrollLeft) => this.scrollEngine.scrollTo(scrollTop, scrollLeft),
			schedulePaint: () => this.schedulePaint(),
		});
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

		// Create scrollable layers for center, pinned columns, and headers.
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
		this.scrollViewport.addEventListener('mouseover', this.onRowMouseOver);
		this.scrollViewport.addEventListener('mouseleave', this.onRowMouseLeave);

		// Pre-warm DOM recycling pools
		const rect = container.getBoundingClientRect();
		const estRows = Math.ceil((rect.height || 500) / 40) + 15;
		const estCols = Math.ceil((rect.width || 800) / 100) + 10;

		this.rowPool = new DOMPool(() => this.createRowElement(), estRows);
		this.cellPool = new DOMPool(() => this.createCellElement(), estRows * estCols);

		// Set viewport dimensions in model
		this.engine.viewport.setViewportSize(rect.width || 800, rect.height || 500);

		this.bindInvalidationSources();

		// Run first layout calculation and repaint
		this.fullPaint();
	}

	/**
	 * Unmount and clean up all DOM resources and subscriptions.
	 */
	public unmount(): void {
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];

		this.scrollEngine.unbind();
		if (this.scrollViewport) {
			this.scrollViewport.removeEventListener('mouseover', this.onRowMouseOver);
			this.scrollViewport.removeEventListener('mouseleave', this.onRowMouseLeave);
		}
		this.columnInteractions.cleanup();
		this.fillDrag.cleanup();

		// Release all active rows and cells
		this.clearActiveRows();
		this.clearHeaderCells();

		if (this.rowPool) this.rowPool.clear();
		if (this.cellPool) this.cellPool.clear();

		if (this.styleTag) {
			this.styleTag.remove();
			this.styleTag = null;
		}

		this.selectionBorder = null;
		this.selectionDragBounds = null;

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
		// 1. Update the coordinate values in ViewportModel (O(1))
		this.engine.viewport.setScrollPosition(scrollTop, scrollLeft);

		// 2. Recycle viewport elements
		this.recycleViewport();

		// 3. Draw and recycle headers
		this.paintHeaders();

		// 4. Update overlay selections
		this.paintOverlay();
	};

	private bindInvalidationSources(): void {
		const scheduleFull = () => this.scheduleFullPaint();
		const scheduleHeaders = () => this.scheduleHeaderPaint();
		const scheduleOverlay = () => this.scheduleOverlayPaint();

		for (const key of [
			'columns',
			'columnWidths',
			'rowHeights',
			'defaultRowHeight',
			'defaultColWidth',
			'dataVersion',
			'loading',
			'visibleRowRange',
			'visibleColRange',
		]) {
			this.unsubscribers.push(this.engine.stateManager.subscribeToKey(key, scheduleFull));
		}

		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('enableColumnReorder', scheduleHeaders));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('selection', scheduleOverlay));
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('activeEdit', scheduleOverlay));
		this.unsubscribers.push(
			this.engine.eventBus.addEventListener<{ rowId: string; colField: string }>('cellInvalidated', (event) => {
				this.queueCellPaint(event.payload.rowId, event.payload.colField);
			})
		);
	}

	/**
	 * Schedules a paint task in the next animation frame, preventing synchronous re-entrancy.
	 */
	public schedulePaint(): void {
		this.scheduleFullPaint();
	}

	private scheduleFullPaint(): void {
		this.pendingFullPaint = true;
		this.scheduleRenderFlush();
	}

	private scheduleHeaderPaint(): void {
		this.pendingHeaderPaint = true;
		this.scheduleRenderFlush();
	}

	private scheduleOverlayPaint(): void {
		this.pendingOverlayPaint = true;
		this.scheduleRenderFlush();
	}

	private queueCellPaint(rowId: string, colField: string): void {
		const key = createCellKey(rowId, colField);
		this.dirtyCells.set(key, { rowId, colField });
		this.dirtyRows.add(rowId);
		this.scheduleRenderFlush();
	}

	private scheduleRenderFlush(): void {
		if (this.pendingPaint) return;
		this.pendingPaint = true;

		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(() => {
				this.pendingPaint = false;
				this.flushPaint();
			});
		} else {
			queueMicrotask(() => {
				this.pendingPaint = false;
				this.flushPaint();
			});
		}
	}

	private flushPaint(): void {
		if (this.pendingFullPaint) {
			this.pendingFullPaint = false;
			this.pendingHeaderPaint = false;
			this.pendingOverlayPaint = false;
			this.dirtyCells.clear();
			this.dirtyRows.clear();
			this.fullPaint();
			return;
		}

		this.syncViewportScrollFromDom();

		if (this.dirtyRows.size > 0 || this.dirtyCells.size > 0) {
			this.repaintDirtyRowsAndCells();
		}

		if (this.pendingHeaderPaint) {
			this.paintHeaders();
		}

		if (this.pendingOverlayPaint || this.dirtyCells.size > 0 || this.dirtyRows.size > 0) {
			this.paintOverlay();
		}

		this.pendingHeaderPaint = false;
		this.pendingOverlayPaint = false;
		this.dirtyCells.clear();
		this.dirtyRows.clear();
	}

	/**
	 * Completely rebuilds grid structures, spacers, and forces recycling refresh.
	 */
	public fullPaint(): void {
		this.syncViewportScrollFromDom();

		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
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
	}

	private syncViewportScrollFromDom(): void {
		if (!this.scrollViewport) return;

		this.engine.viewport.setScrollPosition(this.scrollViewport.scrollTop, this.scrollViewport.scrollLeft);
	}

	/**
	 * Perform row & cell level recycling, reusing DOM elements out of screen.
	 */
	private recycleViewport(): void {
		const rowModel = this.engine.getRowModel();
		let rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
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
		const viewportHeight = this.engine.viewport.viewportHeight;

		// Calculate current visible row and column indexes using viewport models
		const newRowRange = this.engine.viewport.getVisibleRowRange(rowCount);
		const newColRange = this.engine.viewport.getVisibleColumnRange(colCount);

		// If server row model is registered, trigger loading visible blocks
		if (rowModel && typeof rowModel.loadVisibleBlocks === 'function') {
			rowModel.loadVisibleBlocks(newRowRange.startIdx, newRowRange.endIdx);
		}

		const startRow = newRowRange.startIdx;
		const endRow = newRowRange.endIdx;

		// Phase 1: Releasing scrolled-out rows back to the recycling pool
		for (const [rowIndex, pooledRow] of this.activeRows.entries()) {
			const isPinnedTop = rowIndex < pinTopRows && rowIndex < rowCount;
			const isPinnedBottom = rowIndex >= rowCount - pinBottomRows && rowIndex < rowCount;
			const isScrollable = rowIndex >= startRow && rowIndex <= endRow;

			if (!isPinnedTop && !isPinnedBottom && !isScrollable) {
				this.releaseRow(rowIndex, pooledRow);
			}
		}

		// Phase 2: Render/Reposition rows in current range
		const columns = state.columns;

		const renderRow = (r: number) => {
			let visualRow = rowModel ? rowModel.getVisualRow(r) : null;
			if (!visualRow && state.loading) {
				const node = new RowNode<TRowData>(`__loading_${r}`, null as TRowData);
				visualRow = {
					kind: 'data',
					id: node.id,
					node,
					depth: 0,
				};
			}
			if (!visualRow) return;

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
					boundRowId: visualRow.id,
				};
				this.activeRows.set(r, pooledRow);

				// Append row divs to center layer
				if (this.centerLayer) this.centerLayer.appendChild(rowEl);
				if (this.leftLayer) this.leftLayer.appendChild(leftEl);
				if (this.rightLayer) this.rightLayer.appendChild(rightEl);
			} else if (pooledRow.boundRowId !== visualRow.id) {
				if (pooledRow.element.dataset.rowKey && this.onUnmountRowContent) {
					this.onUnmountRowContent({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
					delete pooledRow.element.dataset.rowKey;
				}
				for (const c of pooledRow.cells.keys()) {
					this.releaseCell(pooledRow, c);
				}
				pooledRow.boundRowId = visualRow.id;
			}

			// Reposition row using transforms to avoid layout-bound top/left updates.
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
			pooledRow.element.dataset.rowId = visualRow.id;

			if (pooledRow.leftElement) {
				pooledRow.leftElement.style.transform = `translate3d(0, ${rowTop}px, 0)`;
				pooledRow.leftElement.style.height = `${rowHeight}px`;
				pooledRow.leftElement.dataset.rowIndex = String(r);
				pooledRow.leftElement.dataset.rowId = visualRow.id;
			}
			if (pooledRow.rightElement) {
				pooledRow.rightElement.style.transform = `translate3d(0, ${rowTop}px, 0)`;
				pooledRow.rightElement.style.height = `${rowHeight}px`;
				pooledRow.rightElement.dataset.rowIndex = String(r);
				pooledRow.rightElement.dataset.rowId = visualRow.id;
			}

			if (visualRow.kind !== 'data') {
				this.updateVisualRowClassName(pooledRow, visualRow, r, state);
				for (const c of pooledRow.cells.keys()) {
					this.releaseCell(pooledRow, c);
				}
				const rowKey = visualRow.id;
				if (pooledRow.element.dataset.rowKey !== rowKey) {
					if (pooledRow.element.dataset.rowKey && this.onUnmountRowContent) {
						this.onUnmountRowContent({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
					}
					pooledRow.element.textContent = '';
					pooledRow.element.dataset.rowKey = rowKey;
				}
				if (this.onMountRowContent) {
					this.onMountRowContent({
						rowKey,
						container: pooledRow.element,
						visualRow,
					});
				}
				return;
			}

			const node = visualRow.node;
			if (pooledRow.element.dataset.rowKey) {
				if (this.onUnmountRowContent) {
					this.onUnmountRowContent({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
				}
				delete pooledRow.element.dataset.rowKey;
				pooledRow.element.textContent = '';
			}
			this.updateRowClassName(pooledRow, node, r, state);

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
	}

	private repaintDirtyRowsAndCells(): void {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return;

		const state = this.engine.stateManager.getState();
		const columns = state.columns;

		for (const rowId of this.dirtyRows) {
			const rowIndex = rowModel.getVisualRowIndexById(rowId);
			const pooledRow = rowIndex >= 0 ? this.activeRows.get(rowIndex) : undefined;
			const row = rowIndex >= 0 ? rowModel.getVisualRow(rowIndex) : null;
			if (pooledRow && row?.kind === 'data') {
				this.updateRowClassName(pooledRow, row.node, rowIndex, state);
			}
		}

		for (const { rowId, colField } of this.dirtyCells.values()) {
			const rowIndex = rowModel.getVisualRowIndexById(rowId);
			const colIndex = this.engine.columns.getColumnIndex(colField);
			if (rowIndex < 0 || colIndex < 0) continue;

			const pooledRow = this.activeRows.get(rowIndex);
			const row = rowModel.getVisualRow(rowIndex);
			if (!pooledRow || row?.kind !== 'data' || !pooledRow.cells.has(colIndex)) continue;

			this.recycleRowCells(pooledRow, row.node, rowIndex, colIndex, colIndex, columns, false);
		}
	}

	private updateRowClassName(pooledRow: PooledRow, node: RowNode<TRowData>, rowIndex: number, state = this.engine.stateManager.getState()): void {
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;

		const isFocusedRow = state.selection.focus?.rowId === node.id;
		const isSelectedRow = !!state.selection.bounds && rowIndex >= state.selection.bounds.minRow && rowIndex <= state.selection.bounds.maxRow;
		const isLoadingRow = this.engine.data.isRowLoading(node.id);
		let rowClassName = 'og-row';
		if (rowIndex < pinTopRows) {
			rowClassName += ' og-row-pinned-top';
		} else if (rowIndex >= rowCount - pinBottomRows) {
			rowClassName += ' og-row-pinned-bottom';
		}
		if (this.hoveredRowIndex === rowIndex) {
			rowClassName += ' og-row-hovered';
		}
		if (isSelectedRow || isFocusedRow || node.selected) {
			rowClassName += ' og-row-selected';
		}
		if (isFocusedRow) {
			rowClassName += ' og-row-focused';
		}
		if (isLoadingRow) {
			rowClassName += ' og-row-loading';
		}
		if (state.styleSlots?.rowClass && node.data) {
			try {
				const customRowClass = state.styleSlots.rowClass(node.data, {
					row: node.data,
					rowId: node.id,
					rowIndex,
					isFocused: isFocusedRow,
					isSelected: isSelectedRow || isFocusedRow || node.selected,
					isLoading: isLoadingRow,
					selection: state.selection,
				});
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
	}

	private updateVisualRowClassName(
		pooledRow: PooledRow,
		visualRow: Exclude<VisualRow<TRowData>, { kind: 'data' }>,
		rowIndex: number,
		state = this.engine.stateManager.getState()
	): void {
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;

		let rowClassName = `og-row og-row-${visualRow.kind}`;
		if (rowIndex < pinTopRows) {
			rowClassName += ' og-row-pinned-top';
		} else if (rowIndex >= rowCount - pinBottomRows) {
			rowClassName += ' og-row-pinned-bottom';
		}
		if (this.hoveredRowIndex === rowIndex) {
			rowClassName += ' og-row-hovered';
		}
		if (state.selection.focus?.rowId === visualRow.id) {
			rowClassName += ' og-row-focused';
		}

		if (visualRow.kind === 'group' && state.styleSlots?.groupRowClass) {
			try {
				const customClass = state.styleSlots.groupRowClass(visualRow);
				if (customClass) {
					rowClassName += ' ' + customClass;
				}
			} catch (e) {
				console.error('RenderEngine: Error in groupRowClass styleSlot', e);
			}
		} else if (visualRow.kind === 'detail' && state.styleSlots?.detailRowClass) {
			try {
				const customClass = state.styleSlots.detailRowClass(visualRow);
				if (customClass) {
					rowClassName += ' ' + customClass;
				}
			} catch (e) {
				console.error('RenderEngine: Error in detailRowClass styleSlot', e);
			}
		}

		pooledRow.element.className = rowClassName;
		if (pooledRow.leftElement) pooledRow.leftElement.className = rowClassName;
		if (pooledRow.rightElement) pooledRow.rightElement.className = rowClassName;
	}

	/**
	 * Recycles cells horizontally inside an active row.
	 */
	private recycleRowCells(
		pooledRow: PooledRow,
		node: RowNode<TRowData>,
		rowIndex: number,
		startCol: number,
		endCol: number,
		columns: ColumnDef<TRowData>[],
		releaseOutOfRange = true
	): void {
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const colCount = columns.length;

		// 1. Release cells out-of-column bounds
		if (releaseOutOfRange) {
			for (const [c, cell] of pooledRow.cells.entries()) {
				if (cell) {
					if (c >= colCount) {
						this.releaseCell(pooledRow, c);
						continue;
					}

					const isPinnedLeft = c < pinLeftColumns;
					const isPinnedRight = c >= colCount - pinRightColumns;
					const isScrollable = c >= startCol && c <= endCol;

					if (!isPinnedLeft && !isPinnedRight && !isScrollable) {
						this.releaseCell(pooledRow, c);
					}
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

			const state = this.engine.stateManager.getState();
			const access = this.engine.cellAccess.get(node.id, rowIndex, node, node.data, c, col);

			// Handle classes including pinning, focus, and loading
			let cellClassName = 'og-cell';
			if (c < pinLeftColumns) {
				cellClassName += ' og-cell-pinned-left';
			} else if (c >= colCount - pinRightColumns) {
				cellClassName += ' og-cell-pinned-right';
			}
			if (access.isFocused) {
				cellClassName += ' og-cell-focused';
				cell.tabIndex = -1;
				const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
				if (
					activeEl &&
					(activeEl === document.body ||
						(this.container &&
							this.container.contains(activeEl) &&
							activeEl !== cell &&
							!cell.contains(activeEl) &&
							!this.isEditorInteractiveElement(activeEl)))
				) {
					cell.focus();
				}
			} else {
				cell.removeAttribute('tabindex');
			}
			if (access.isSelected) {
				cellClassName += ' og-cell-selected';
			}
			if (access.isLoading) {
				cellClassName += ' og-cell-loading';
			}
			if (state.styleSlots?.cellClass && node.data) {
				try {
					const customCellClass = state.styleSlots.cellClass(col, node.data, {
						row: node.data,
						rowId: node.id,
						rowIndex,
						col,
						colField: col.field,
						colIndex: c,
						isFocused: access.isFocused,
						isRowFocused: access.isRowFocused,
						isRowSelected: access.isRowSelected || access.isRowFocused || node.selected,
						isSelected: access.isSelected,
						isEditing: access.isEditing,
						value: access.value,
						rawValue: access.rawValue,
						isLoading: access.isLoading,
						selection: state.selection,
					});
					if (customCellClass) {
						cellClassName += ' ' + customCellClass;
					}
				} catch (e) {
					console.error('RenderEngine: Error in cellClass styleSlot', e);
				}
			}
			cell.className = cellClassName;
			if (state.styleSlots?.beforeCellRender) {
				try {
					state.styleSlots.beforeCellRender(access, cell);
				} catch (e) {
					console.error('RenderEngine: Error in beforeCellRender styleSlot', e);
				}
			}

			// Bind value
			const cellValue = access.value;
			const cellKey = createCellKey(node.id, col.field);

			// Custom renderer hook trigger or fast direct text bind (bypassed if loading to paint native skeletons synchronously)
			if ((col.cellRenderer || access.isEditing) && !access.isLoading) {
				const previousPortalHost = this.getCellPortalHost(cell);
				if (cell.dataset.cellKey !== cellKey) {
					if (cell.dataset.cellKey && this.onUnmountCellContent) {
						this.onUnmountCellContent({ cellKey: cell.dataset.cellKey, container: previousPortalHost ?? cell, flushSync: true });
					}
					// Set content empty so custom React portal doesn't clash with stale text
					cell.textContent = '';
					cell.dataset.cellKey = cellKey;
				}
				const portalHost = this.ensureCellPortalHost(cell);
				if (this.onMountCellContent) {
					this.onMountCellContent({
						cellKey,
						container: portalHost,
						value: cellValue,
						node,
						col,
						isEditing: access.isEditing,
						isLoading: access.isLoading,
					});
				}
			} else {
				if (cell.dataset.cellKey) {
					if (this.onUnmountCellContent) {
						this.onUnmountCellContent({
							cellKey: cell.dataset.cellKey,
							container: this.getCellPortalHost(cell) ?? cell,
							flushSync: true,
						});
					}
					delete cell.dataset.cellKey;
				}
				if (access.isLoading) {
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
			if (state.styleSlots?.afterCellRender) {
				try {
					state.styleSlots.afterCellRender(access, cell);
				} catch (e) {
					console.error('RenderEngine: Error in afterCellRender styleSlot', e);
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

	private getCellPortalHost(cell: HTMLDivElement): HTMLDivElement | null {
		for (let i = 0; i < cell.children.length; i++) {
			const child = cell.children[i];
			if (child instanceof HTMLDivElement && child.classList.contains('og-cell-portal-host')) {
				return child;
			}
		}
		return null;
	}

	private ensureCellPortalHost(cell: HTMLDivElement): HTMLDivElement {
		let portalHost = this.getCellPortalHost(cell);
		if (!portalHost) {
			cell.textContent = '';
			portalHost = document.createElement('div');
			portalHost.className = 'og-cell-portal-host';
			cell.appendChild(portalHost);
			return portalHost;
		}

		let child = cell.firstChild;
		while (child) {
			const next = child.nextSibling;
			if (child !== portalHost) {
				child.remove();
			}
			child = next;
		}
		return portalHost;
	}

	private isEditorInteractiveElement(element: Element): boolean {
		return element.matches('input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"]');
	}

	/**
	 * Release and return a cell element to the DOMPool.
	 */
	private releaseCell(pooledRow: PooledRow, colIdx: number): void {
		const cell = pooledRow.cells.get(colIdx);
		if (cell) {
			if (cell.dataset.cellKey) {
				if (this.onUnmountCellContent) {
					this.onUnmountCellContent({ cellKey: cell.dataset.cellKey, container: this.getCellPortalHost(cell) ?? cell, flushSync: true });
				}
				delete cell.dataset.cellKey;
			} else {
				// Trigger unmount hook if a framework adapter owns this cell's content.
				const col = this.engine.stateManager.getState().columns[colIdx];
				if (col && this.onUnmountCellContent) {
					const cellKey = createCellKey(pooledRow.boundRowId, col.field);
					this.onUnmountCellContent({ cellKey });
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
		if (pooledRow.element.dataset.rowKey && this.onUnmountRowContent) {
			this.onUnmountRowContent({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
			delete pooledRow.element.dataset.rowKey;
		}

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
			if (this.columnInteractions.isDraggingColumn(col.field)) {
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
		headerCell.addEventListener('mousedown', this.columnInteractions.onHeaderCellMouseDown);

		const textSpan = document.createElement('span');
		textSpan.style.overflow = 'hidden';
		textSpan.style.textOverflow = 'ellipsis';
		textSpan.style.whiteSpace = 'nowrap';
		textSpan.style.flex = '1';
		headerCell.appendChild(textSpan);

		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'og-header-resize-handle';
		resizeHandle.addEventListener('mousedown', this.columnInteractions.onHeaderResizeMouseDown);
		headerCell.appendChild(resizeHandle);

		return headerCell;
	}

	private clearHeaderCells(): void {
		for (const cell of this.headerCells.values()) {
			cell.remove();
		}
		this.headerCells.clear();
	}

	/**
	 * Computes selection overlays & active focus coordinates off-screen.
	 */
	private paintOverlay(): void {
		if (!this.overlayLayer) return;

		this.columnInteractions.reattachOverlays();

		const state = this.engine.stateManager.getState();
		const bounds = state.selection.bounds;

		if (!bounds || !this.engine.getRowModel()) {
			this.hideSelectionOverlay();
			return;
		}

		const rowModel = this.engine.getRowModel()!;
		const rowCount = rowModel.getVisualRowCount();
		const columns = state.columns;
		const colCount = columns.length;

		// Check if selection limits lie inside current loaded row scope
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

		// Position selection border overlay absolute
		selectionBorder.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
		selectionBorder.style.width = `${box.width}px`;
		selectionBorder.style.height = `${box.height}px`;
		selectionBorder.style.display = 'block';

		if (selectionBorder.parentNode !== this.overlayLayer) {
			this.overlayLayer.appendChild(selectionBorder);
		}

		// Re-append the fill preview border if actively dragging so it doesn't get cleared by textContent = ''
		this.fillDrag.reattachPreview();
	}

	private getClampedOverlayBox(minRow: number, maxRow: number, minCol: number, maxCol: number): OverlayBox | null {
		const state = this.engine.stateManager.getState();
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const colCount = state.columns.length;

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

	private onRowMouseOver = (event: MouseEvent): void => {
		const rowEl = (event.target as HTMLElement).closest('.og-row') as HTMLElement | null;
		const rowIndexText = rowEl?.dataset.rowIndex;
		if (rowIndexText === undefined) {
			this.setHoveredRowIndex(null);
			return;
		}

		const rowIndex = Number(rowIndexText);
		this.setHoveredRowIndex(Number.isFinite(rowIndex) ? rowIndex : null);
	};

	private onRowMouseLeave = (): void => {
		this.setHoveredRowIndex(null);
	};

	private setHoveredRowIndex(rowIndex: number | null): void {
		if (this.hoveredRowIndex === rowIndex) return;

		if (this.hoveredRowIndex !== null) {
			this.setPooledRowHoverClass(this.hoveredRowIndex, false);
		}

		this.hoveredRowIndex = rowIndex;

		if (rowIndex !== null) {
			this.setPooledRowHoverClass(rowIndex, true);
		}
	}

	private setPooledRowHoverClass(rowIndex: number, hovered: boolean): void {
		const pooledRow = this.activeRows.get(rowIndex);
		if (!pooledRow) return;

		pooledRow.element.classList.toggle('og-row-hovered', hovered);
		pooledRow.leftElement?.classList.toggle('og-row-hovered', hovered);
		pooledRow.rightElement?.classList.toggle('og-row-hovered', hovered);
	}

	private ensureSelectionBorder(): HTMLDivElement {
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

	private hideSelectionOverlay(): void {
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
		this.fillDrag.start(e, minRow, maxRow, minCol, maxCol);
	};

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
	 * Injects the structural styles required by the DOM renderer.
	 */
	private injectStyles(): void {
		if (typeof document === 'undefined') return;

		this.styleTag = document.createElement('style');
		this.styleTag.textContent = CORE_STYLES;
		document.head.appendChild(this.styleTag);
	}
}

import { DOMPool } from './domPool.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { CellRenderer } from './cellRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import {
	type CellRendererPhase,
	type ColumnDef,
	type InternalColumnDef,
	type VisualRow,
	type GridState,
	type RowNode,
	type GridCellPointer,
} from '../store.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { GridCellContentUnmount } from './IGridRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import { RowSlot } from './rowSlot.js';
import { CellSlot, type CellContentMode } from './cellSlot.js';
import { applyRenderWindowRuntimeLimits, computeRenderWindow, diffRenderWindow, getRowIndices, type RenderWindow } from './renderWindow.js';

type ResolvedCellRendererScrollMode = 'skeleton' | 'fallback' | 'preserve' | 'live';

export class RowRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly geometryController: GeometryController<TRowData>;
	private readonly portalMountManager: PortalMountManager<TRowData>;
	private readonly cellRenderer: CellRenderer;
	private readonly viewportRenderer: ViewportRenderer<TRowData>;

	public rowPool!: DOMPool<HTMLDivElement>;
	public cellPool!: DOMPool<HTMLDivElement>;
	public activeRows = new Map<number, RowSlot<TRowData>>(); // rowIndex -> RowSlot
	public currentWindow: RenderWindow | null = null;

	public dirtyCellsAfterScroll = new Set<HTMLDivElement>();
	public dirtyRowsAfterScroll = new Set<number>();
	public pendingPortalReleasesAfterScroll = new Map<string, GridCellContentUnmount>();

	public styleVersion = 0;
	public selectionVersion = 0;
	public loadingVersion = 0;
	public hoveredRowIndex: number | null = null;
	public deferredFocusCell: HTMLDivElement | null = null;
	public programmaticScrollCell: GridCellPointer | null = null;
	public renderStats: any = null;

	public currentScrollCellsPatched = 0;
	public currentScrollRowsRecycled = 0;
	public currentScrollRowsVisited = 0;
	public currentScrollRowsRebound = 0;
	public currentScrollCellsVisited = 0;
	public currentScrollCellsWritten = 0;
	public currentScrollPortalOps = 0;
	private nextPooledRowId = 0;
	public isScrollFrameActive = false;
	public isScrolling = false;
	public dirtyCellsMarkedDuringScroll = 0;

	// Reusable Sets to avoid per-scroll-frame allocations in recycleViewport
	private readonly _rowsEnteredSet = new Set<number>();
	private readonly _rowsStayedSet = new Set<number>();
	private readonly _colsExitedSet = new Set<number>();
	private readonly _rowsToRenderSet = new Set<number>();
	private readonly _rowsToRenderScratch: number[] = [];
	public postScrollDirtyCellsDecorated = 0;

	private rowPortalHosts = new WeakMap<HTMLElement, HTMLElement>();
	// Maps pooled row DOM elements → their RowSlot; avoids expando properties that
	// deoptimize hidden classes in V8.
	private readonly rowSlotCache = new WeakMap<HTMLDivElement, RowSlot<TRowData>>();

	constructor(
		engine: GridEngine<TRowData>,
		geometryController: GeometryController<TRowData>,
		portalMountManager: PortalMountManager<TRowData>,
		cellRenderer: CellRenderer,
		viewportRenderer: ViewportRenderer<TRowData>
	) {
		this.engine = engine;
		this.geometryController = geometryController;
		this.portalMountManager = portalMountManager;
		this.cellRenderer = cellRenderer;
		this.viewportRenderer = viewportRenderer;
	}

	public mount(estRows: number): void {
		// One element per row (no separate left/right elements)
		this.rowPool = new DOMPool(() => document.createElement('div'), estRows);
		this.cellPool = new DOMPool(
			() => {
				const div = document.createElement('div');
				this.cellRenderer.initializeCell(div);
				return div;
			},
			estRows * 10,
			(node) => {
				node.className = '';
				node.removeAttribute('style');
				if (node.dataset) {
					for (const key in node.dataset) {
						delete node.dataset[key];
					}
				}
				const content = node.querySelector('.og-cell-content');
				if (content) {
					content.textContent = '';
					content.className = 'og-cell-content';
				}
				const portalHost = node.querySelector('.og-cell-portal-host');
				if (portalHost) {
					portalHost.className = 'og-cell-portal-host';
					// Only remove og-custom-renderer-container children, not React roots
					for (let i = portalHost.children.length - 1; i >= 0; i--) {
						portalHost.children[i].remove();
					}
				}
			}
		);
	}

	public unmount(): void {
		this.clearActiveRows();
		if (this.rowPool) this.rowPool.clear();
		if (this.cellPool) this.cellPool.clear();
		this.dirtyCellsAfterScroll.clear();
		this.dirtyRowsAfterScroll.clear();
		this.pendingPortalReleasesAfterScroll.clear();
		this.deferredFocusCell = null;
		this.programmaticScrollCell = null;
		this.currentWindow = null;
	}

	public sync(frame: InvalidationFrame): void {
		// Just a hook for Orchestrator
	}

	public clearActiveRows(): void {
		for (const [rowIndex, slot] of this.activeRows.entries()) {
			this.releaseRowSlot(rowIndex, slot, false);
		}
		this.activeRows.clear();
	}

	private ensurePinnedContainer(slot: RowSlot<TRowData>, side: 'left' | 'right', width: number): HTMLDivElement | null {
		if (width <= 0) {
			const existing = side === 'left' ? slot.pinLeftContainer : slot.pinRightContainer;
			if (existing) {
				existing.remove();
				if (side === 'left') {
					slot.pinLeftContainer = null;
					slot.pinLeftContainerWidth = -1;
					slot.pinLeftContainerTransform = '';
				} else {
					slot.pinRightContainer = null;
					slot.pinRightContainerWidth = -1;
					slot.pinRightContainerLeft = -1;
					slot.pinRightContainerTransform = '';
				}
			}
			return null;
		}

		let container = side === 'left' ? slot.pinLeftContainer : slot.pinRightContainer;
		if (!container || !slot.element.contains(container)) {
			container = document.createElement('div');
			container.className = side === 'left' ? 'og-row-pin-left' : 'og-row-pin-right';
			slot.element.appendChild(container);
			if (side === 'left') {
				slot.pinLeftContainer = container;
				slot.pinLeftContainerWidth = -1;
				slot.pinLeftContainerTransform = '';
			} else {
				slot.pinRightContainer = container;
				slot.pinRightContainerWidth = -1;
				slot.pinRightContainerLeft = -1;
				slot.pinRightContainerTransform = '';
			}
		}
		const previousWidth = side === 'left' ? slot.pinLeftContainerWidth : slot.pinRightContainerWidth;
		if (previousWidth !== width) {
			if (side === 'left') {
				slot.pinLeftContainerWidth = width;
			} else {
				slot.pinRightContainerWidth = width;
			}
			container.style.width = `${width}px`;
		}
		return container;
	}

	public syncPinnedLanePositions(window: RenderWindow, totalWidth: number): void {
		const pinLeftColumns = window.pinLeftCols;
		const pinRightColumns = window.pinRightCols;
		if (pinLeftColumns <= 0 && pinRightColumns <= 0) return;

		const colCount = window.colCount;
		const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
		const scrollLeft = this.engine.viewport.scrollLeft;
		const viewportWidth = this.engine.viewport.viewportWidth;
		const pinRightBaseLeft = pinRightStart < colCount ? (this.engine.geometry.colLefts[pinRightStart] ?? totalWidth) : totalWidth;
		const pinRightWidth = Math.max(0, totalWidth - pinRightBaseLeft);
		const pinLeftWidth = pinLeftColumns > 0 ? (this.engine.geometry.colLefts[Math.min(pinLeftColumns, colCount)] ?? 0) : 0;
		const leftTransform = pinLeftColumns > 0 ? `translate3d(${scrollLeft}px, 0, 0)` : '';
		const rightTransform =
			pinRightColumns > 0 && pinRightStart < colCount
				? `translate3d(${scrollLeft + Math.max(pinLeftWidth, viewportWidth - pinRightWidth) - pinRightBaseLeft}px, 0, 0)`
				: '';

		for (const slot of this.activeRows.values()) {
			if (slot.pinLeftContainer && slot.pinLeftContainerTransform !== leftTransform) {
				slot.pinLeftContainerTransform = leftTransform;
				slot.pinLeftContainer.style.transform = leftTransform;
			}
			if (slot.pinRightContainer) {
				if (slot.pinRightContainerLeft !== pinRightBaseLeft) {
					slot.pinRightContainerLeft = pinRightBaseLeft;
					slot.pinRightContainer.style.left = `${pinRightBaseLeft}px`;
				}
				if (slot.pinRightContainerTransform !== rightTransform) {
					slot.pinRightContainerTransform = rightTransform;
					slot.pinRightContainer.style.transform = rightTransform;
				}
			}
		}
	}

	public recycleViewport(isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow): void {
		this.isScrollFrameActive = isScrollFrameActive;
		this.isScrolling = isScrollFrameActive || this.engine.isScrolling;

		const state = ctx?.state ?? this.engine.stateManager.getState();
		// Use the pre-computed window from flushScrollFrame when available to avoid
		// a duplicate computeRenderWindow call (binary searches + state read) per frame.
		const nextWindow =
			precomputedWindow ??
			applyRenderWindowRuntimeLimits(computeRenderWindow(this.engine), state.runtimeLimits, () => {
				if (this.renderStats) {
					this.renderStats.runtimeLimitsClamped = (this.renderStats.runtimeLimitsClamped || 0) + 1;
				}
			});

		const delta = diffRenderWindow(this.currentWindow, nextWindow);

		// Range-bailout: return early if the calculated RenderWindow is identical during scroll
		if (!delta.hasChanges && isScrollFrameActive) {
			return;
		}

		if (isScrollFrameActive && this.renderStats) {
			this.renderStats.rowsEnteredDuringScroll += delta.rowsEntered.length;
			this.renderStats.rowsExitedDuringScroll += delta.rowsExited.length;
			this.renderStats.rowsStayedDuringScroll += delta.rowsStayed.length;
			this.renderStats.colsEnteredDuringScroll += delta.colsEntered.length;
			this.renderStats.colsExitedDuringScroll += delta.colsExited.length;
			this.renderStats.colsStayedDuringScroll += delta.colsStayed.length;
			this.renderStats.cellsSkippedDuringScroll += delta.rowsStayed.length * delta.colsStayed.length;
		}

		// Trigger loading visible blocks if server row model is registered
		const rowModel = this.engine.getRowModel();
		if (rowModel && typeof rowModel.loadVisibleBlocks === 'function') {
			rowModel.loadVisibleBlocks(nextWindow.rowStart, nextWindow.rowEnd);
		}

		const plan = ctx?.plan ?? this.engine.columns.getCompiledPlan();
		const columns = plan.displayedColumns;
		const strategy = state.rowRecyclingStrategy ?? 'index-pool';
		const loading = ctx ? ctx.loadingVersion > 0 : state.loading;

		// 1. Release scrolled-out rows (for index-pool)
		if (strategy === 'index-pool') {
			for (const r of delta.rowsExited) {
				const slot = this.activeRows.get(r);
				if (slot) {
					// Check row keepAlive status
					const isFocused = state.selection.focus?.rowId === slot.visualRowId;
					const isEditing = state.activeEdit?.rowId === slot.visualRowId;
					const isKeepAlive = slot.keepAlive || isFocused || isEditing;

					if (isKeepAlive) {
						continue;
					}

					this.releaseRowSlot(r, slot, isScrollFrameActive);
				}
			}
		}

		// 2. Release cell slots in exited columns for stayed rows
		if (delta.colsExited.length > 0) {
			const colsExited = this._colsExitedSet;
			colsExited.clear();
			for (const c of delta.colsExited) colsExited.add(c);
			for (const r of delta.rowsStayed) {
				const slot = this.activeRows.get(r);
				if (slot && (slot.rowKind === 'data' || slot.rowKind === 'loading')) {
					const colsToRelease: number[] = [];
					for (const c of slot.cells.keys()) {
						if (colsExited.has(c)) {
							colsToRelease.push(c);
						}
					}
					for (const c of colsToRelease) {
						const cellSlot = slot.cells.get(c);
						if (cellSlot) {
							if (cellSlot.lastPortalKey) {
								this.releaseCellPortal(cellSlot.element);
							}
							if (isScrollFrameActive) {
								cellSlot.unbindHot();
								slot.cells.delete(c);
								if (cellSlot.element.parentNode) {
									cellSlot.element.remove();
								}
								this.cellPool.releaseHot(cellSlot.element);
							} else {
								cellSlot.unbindCold();
								slot.cells.delete(c);
								if (cellSlot.element.parentNode) {
									cellSlot.element.remove();
								}
								this.cellPool.releaseCold(cellSlot.element);
							}
						}
					}
				}
			}
		}

		// Reuse class-level Sets for O(1) lookup — avoids two allocations per scroll frame
		const rowsEnteredSet = this._rowsEnteredSet;
		const rowsStayedSet = this._rowsStayedSet;
		rowsEnteredSet.clear();
		rowsStayedSet.clear();
		for (const r of delta.rowsEntered) rowsEnteredSet.add(r);
		for (const r of delta.rowsStayed) rowsStayedSet.add(r);
		const rowSlotCache = this.rowSlotCache;

		// 3. Render/Reposition rows in current range
		const getOrCreateRowSlot = (r: number): { slot: RowSlot<TRowData>; visualRow: import('../store.js').VisualRow<TRowData> } | null => {
			let slot = this.activeRows.get(r);
			let visualRow = rowModel ? rowModel.getVisualRow(r) : null;
			if (!visualRow && loading) {
				visualRow = { kind: 'loading', id: `loading:${r}`, rowIndex: r };
			}
			if (!visualRow) return null;

			if (slot) return { slot, visualRow };

			// slot-pool: recycle a scrolled-out slot without releasing its DOM element
			if (strategy === 'slot-pool') {
				let recycleIndex = -1;
				for (const oldIdx of this.activeRows.keys()) {
					if (!rowsStayedSet.has(oldIdx) && !rowsEnteredSet.has(oldIdx)) {
						const oldSlot = this.activeRows.get(oldIdx)!;
						const isFocused = state.selection.focus?.rowId === oldSlot.visualRowId;
						const isEditing = state.activeEdit?.rowId === oldSlot.visualRowId;
						if (!oldSlot.keepAlive && !isFocused && !isEditing) {
							recycleIndex = oldIdx;
							break;
						}
					}
				}

				if (recycleIndex !== -1) {
					slot = this.activeRows.get(recycleIndex)!;
					this.activeRows.delete(recycleIndex);

					if (isScrollFrameActive) {
						this.releaseSlotCellsHot(slot);
						slot.unbindHot();
					} else {
						for (const cell of slot.cells.values()) {
							if (cell.lastPortalKey) this.releaseCellPortal(cell.element);
							if (cell.element.parentNode) cell.element.remove();
							this.cellPool.releaseCold(cell.element);
						}
						slot.destroyCold();
					}
					this.activeRows.set(r, slot);
					if (isScrollFrameActive) this.currentScrollRowsRecycled++;
				}
			}

			if (!slot) {
				const rowEl = this.rowPool.acquire();
				// Re-use the RowSlot object cached on the element to avoid re-allocating
				let slotInstance = rowSlotCache.get(rowEl);
				if (slotInstance) {
					slot = slotInstance;
				} else {
					let pooledRowId = (rowEl as any).__pooledRowId as string | undefined;
					if (!pooledRowId) {
						pooledRowId = `row-pool-${this.nextPooledRowId++}`;
						(rowEl as any).__pooledRowId = pooledRowId;
					}
					slot = new RowSlot<TRowData>(pooledRowId, rowEl);
					rowSlotCache.set(rowEl, slot);
				}
				this.activeRows.set(r, slot);
				if (isScrollFrameActive) this.currentScrollRowsRecycled++;
			}
			if (isScrollFrameActive) this.currentScrollRowsRebound++;

			// Single parent: all rows go into the rows container
			if (slot.element.parentNode !== this.viewportRenderer.rowsContainer) {
				this.viewportRenderer.rowsContainer?.appendChild(slot.element);
			}

			return { slot, visualRow };
		};

		// Hoist geometry constants that are constant across all rows in this viewport cycle
		const hoistedTotalWidth = plan.totalWidth;
		const hoistedTotalHeight = nextWindow.pinBottomRows > 0 ? this.engine.geometry.getTotalHeight(state.defaultRowHeight) : 0;

		const renderRow = (r: number) => {
			if (isScrollFrameActive) this.currentScrollRowsVisited++;
			const result = getOrCreateRowSlot(r);
			if (!result) return;
			const { slot, visualRow } = result;

			// Position calculation
			let rowTop = this.engine.geometry.rowTops[r];
			const rowHeight = this.engine.geometry.rowHeights[r];

			const pinTopRows = this.engine.viewport.pinTopRows;
			const pinBottomRows = this.engine.viewport.pinBottomRows;
			const scrollTop = this.engine.viewport.scrollTop;
			const viewportHeight = this.engine.viewport.viewportHeight;

			if (r < pinTopRows) {
				rowTop = rowTop + scrollTop;
			} else if (r >= nextWindow.rowCount - pinBottomRows) {
				const bottomOffset = hoistedTotalHeight - this.engine.geometry.rowTops[r];
				rowTop = scrollTop + viewportHeight - bottomOffset;
			}

			// Calculate row class name
			let rowClassName = 'og-row';
			if (visualRow.kind === 'loading') {
				rowClassName += ' og-row-loading';
			} else if (visualRow.kind === 'group') {
				rowClassName += ' og-row-group';
				if (state.styleSlots?.groupRowClass) {
					try {
						const customClass = state.styleSlots.groupRowClass(visualRow);
						if (customClass) rowClassName += ' ' + customClass;
					} catch (e) {
						console.error('RenderEngine: Error in groupRowClass styleSlot', e);
					}
				}
			} else if (visualRow.kind === 'detail') {
				rowClassName += ' og-row-detail';
				if (state.styleSlots?.detailRowClass) {
					try {
						const customClass = state.styleSlots.detailRowClass(visualRow);
						if (customClass) rowClassName += ' ' + customClass;
					} catch (e) {
						console.error('RenderEngine: Error in detailRowClass styleSlot', e);
					}
				}
			} else if (visualRow.kind === 'data') {
				const node = visualRow.node;
				const isFocusedRow = state.selection.focus?.rowId === node.id;
				const isSelectedRow = !!state.selection.bounds && r >= state.selection.bounds.minRow && r <= state.selection.bounds.maxRow;
				const isLoadingRow = this.engine.data.isRowLoading(node.id);

				if (r < pinTopRows) rowClassName += ' og-row-pinned-top';
				else if (r >= nextWindow.rowCount - pinBottomRows) rowClassName += ' og-row-pinned-bottom';

				if (this.hoveredRowIndex === r) rowClassName += ' og-row-hovered';
				if (isSelectedRow || isFocusedRow) rowClassName += ' og-row-selected';
				if (isFocusedRow) rowClassName += ' og-row-focused';
				if (isLoadingRow) rowClassName += ' og-row-loading';

				if (isScrollFrameActive && state.styleSlots?.rowClass && node.data) {
					this.dirtyRowsAfterScroll.add(r);
				} else if (state.styleSlots?.rowClass && node.data) {
					try {
						const customRowClass = state.styleSlots.rowClass(node.data, {
							row: node.data,
							rowId: node.id,
							rowIndex: r,
							isFocused: isFocusedRow,
							isSelected: isSelectedRow || isFocusedRow,
							isLoading: isLoadingRow,
							selection: state.selection,
						});
						if (customRowClass) rowClassName += ' ' + customRowClass;
					} catch (e) {
						console.error('RenderEngine: Error in rowClass styleSlot', e);
					}
				}
			}

			const rowUpdated = slot.update(r, visualRow.id, visualRow.kind as any, rowTop, rowHeight, rowClassName);
			if (isScrollFrameActive && rowUpdated) this.currentScrollRowsRebound++;

			if (visualRow.kind === 'loading') {
				this.recycleLoadingRowCellsSlot(
					slot,
					visualRow as any,
					r,
					delta.colsEntered,
					delta.colsStayed,
					columns,
					isScrollFrameActive,
					ctx,
					rowsEnteredSet.has(r),
					state,
					hoistedTotalWidth
				);
			} else if (visualRow.kind === 'data') {
				this.releaseRowPortal(slot); // Clean up row portal host if shifting to data
				this.recycleRowCellsSlot(
					slot,
					visualRow.node,
					r,
					delta.colsEntered,
					delta.colsStayed,
					columns,
					isScrollFrameActive,
					ctx,
					'initial',
					rowsEnteredSet.has(r),
					state,
					hoistedTotalWidth
				);
			} else {
				// Non-data portal group/detail rows
				this.unbindAllCellsInSlot(slot);
				const rowKey = visualRow.id;
				if (slot.element.dataset.rowKey !== rowKey) {
					this.releaseRowPortal(slot);
					slot.element.dataset.rowKey = rowKey;
				}
				const rowPortalHost = this.ensureRowPortalHost(slot.element);
				rowPortalHost.hidden = false;
				rowPortalHost.dataset.rowKey = rowKey;
				this.portalMountManager.mountRow({
					rowKey,
					container: rowPortalHost,
					visualRow,
				});
			}
		};

		const nextRows = getRowIndices(nextWindow);
		const pinnedScrollOffsetChanged =
			!!this.currentWindow &&
			(nextWindow.pinTopRows > 0 || nextWindow.pinBottomRows > 0) &&
			this.currentWindow.scrollTop !== nextWindow.scrollTop;
		const columnsChangedDuringScroll = delta.colsEntered.length > 0 || delta.colsExited.length > 0;

		// Fast path: most scroll frames only have entered rows — skip all allocations
		let rowsToRender: readonly number[];
		if (!isScrollFrameActive) {
			rowsToRender = nextRows;
		} else if (!columnsChangedDuringScroll && !pinnedScrollOffsetChanged) {
			rowsToRender = delta.rowsEntered; // zero allocation — most common case
		} else {
			const toRenderSet = this._rowsToRenderSet;
			const rowsScratch = this._rowsToRenderScratch;
			toRenderSet.clear();
			rowsScratch.length = 0;
			for (const r of delta.rowsEntered) {
				toRenderSet.add(r);
				rowsScratch.push(r);
			}
			if (columnsChangedDuringScroll) {
				for (const r of delta.rowsStayed) {
					if (!toRenderSet.has(r)) {
						toRenderSet.add(r);
						rowsScratch.push(r);
					}
				}
			}
			if (pinnedScrollOffsetChanged) {
				for (const r of nextRows) {
					if ((r < nextWindow.pinTopRows || r >= nextWindow.rowCount - nextWindow.pinBottomRows) && !toRenderSet.has(r)) {
						toRenderSet.add(r);
						rowsScratch.push(r);
					}
				}
			}
			rowsToRender = rowsScratch;
		}

		for (const r of rowsToRender) {
			renderRow(r);
		}

		// 4. Cleanup remaining scrolled-out rows (for slot-pool)
		if (strategy === 'slot-pool') {
			for (const oldIdx of this.activeRows.keys()) {
				if (!rowsStayedSet.has(oldIdx) && !rowsEnteredSet.has(oldIdx)) {
					const slot = this.activeRows.get(oldIdx)!;
					const isFocused = state.selection.focus?.rowId === slot.visualRowId;
					const isEditing = state.activeEdit?.rowId === slot.visualRowId;
					if (!slot.keepAlive && !isFocused && !isEditing) {
						this.releaseRowSlot(oldIdx, slot, isScrollFrameActive);
					}
				}
			}
		}

		this.currentWindow = nextWindow;
	}

	public repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return;

		const state = this.engine.stateManager.getState();
		const columns = this.engine.columns.getDisplayedColumns();

		// Repaint rows
		for (const rowId of frame.rows) {
			const rowIndex = rowModel.getVisualIndexByRowId(rowId);
			const slot = rowIndex >= 0 ? this.activeRows.get(rowIndex) : undefined;
			const row = rowIndex >= 0 ? rowModel.getVisualRow(rowIndex) : null;
			if (slot && row?.kind === 'data') {
				this.updateRowClassNameSlot(slot, row.node, rowIndex, state);
			}
		}

		// Repaint specific cell changes
		for (const [rowId, colFields] of frame.cellsByRowId) {
			const rowIndex = rowModel.getVisualIndexByRowId(rowId);
			if (rowIndex < 0) continue;
			for (const colField of colFields) {
				const colIndex = this.engine.columns.getColumnIndex(colField);
				if (colIndex < 0) continue;

				const slot = this.activeRows.get(rowIndex);
				const row = rowModel.getVisualRow(rowIndex);
				if (!slot || row?.kind !== 'data' || !slot.cells.has(colIndex)) continue;

				this.recycleRowCellsSlot(slot, row.node, rowIndex, [colIndex], [], columns, false);
			}
		}

		// Repaint column changes
		for (const colField of frame.columns) {
			const colIndex = this.engine.columns.getColumnIndex(colField);
			if (colIndex < 0) continue;
			for (const [rowIndex, slot] of this.activeRows) {
				const row = rowModel.getVisualRow(rowIndex);
				if (row?.kind === 'data' && slot.cells.has(colIndex)) {
					this.recycleRowCellsSlot(slot, row.node, rowIndex, [colIndex], [], columns, false);
				}
			}
		}
	}

	private updateRowClassNameSlot(
		slot: RowSlot<TRowData>,
		node: RowNode<TRowData>,
		rowIndex: number,
		state = this.engine.stateManager.getState()
	): void {
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
		if (isSelectedRow || isFocusedRow) {
			rowClassName += ' og-row-selected';
		}
		if (isFocusedRow) {
			rowClassName += ' og-row-focused';
		}
		if (isLoadingRow) {
			rowClassName += ' og-row-loading';
		}
		if (this.isScrollFrameActive && state.styleSlots?.rowClass && node.data) {
			this.dirtyRowsAfterScroll.add(rowIndex);
		} else if (state.styleSlots?.rowClass && node.data) {
			try {
				const customRowClass = state.styleSlots.rowClass(node.data, {
					row: node.data,
					rowId: node.id,
					rowIndex,
					isFocused: isFocusedRow,
					isSelected: isSelectedRow || isFocusedRow,
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

		slot.update(rowIndex, slot.visualRowId, 'data', slot.rowTop, slot.rowHeight, rowClassName);
	}

	public recycleRowCellsSlot(
		slot: RowSlot<TRowData>,
		node: RowNode<TRowData>,
		rowIndex: number,
		colsEntered: number[],
		colsStayed: number[],
		columns: ColumnDef<TRowData>[],
		isScrollFrameActive: boolean,
		ctx?: ScrollRenderContext<TRowData>,
		phase: CellRendererPhase = 'initial',
		rowEntered = false,
		_hoistedState?: GridState<TRowData>,
		_hoistedTotalWidth?: number
	): void {
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const plan = ctx?.plan ?? this.engine.columns.getCompiledPlan();
		const colCount = columns.length;
		const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
		// Use hoisted state/totalWidth from recycleViewport when available to avoid
		// redundant reads for each row in the same viewport cycle.
		const state = _hoistedState ?? this.engine.stateManager.getState();
		const pinLeftWidth = plan.pinLeftWidth;
		const pinRightBaseLeft = plan.pinRightBaseLeft;
		const pinRightWidth = plan.pinRightWidth;
		const pinLeftContainer = this.ensurePinnedContainer(slot, 'left', pinLeftWidth);
		const pinRightContainer = this.ensurePinnedContainer(slot, 'right', pinRightWidth);
		if (pinRightContainer && slot.pinRightContainerLeft !== pinRightBaseLeft) {
			slot.pinRightContainerLeft = pinRightBaseLeft;
			pinRightContainer.style.left = `${pinRightBaseLeft}px`;
		}
		// When scroll-frame active and row didn't just enter, only render entered cols (stayed cols already positioned)
		const renderStayed = !isScrollFrameActive || rowEntered;

		const renderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;
			if (isScrollFrameActive) this.currentScrollCellsVisited++;

			let cellSlot = slot.cells.get(c);
			if (!cellSlot) {
				const cellEl = this.cellPool.acquire();
				cellSlot = CellSlot.fromElement<TRowData>(cellEl);
				slot.cells.set(c, cellSlot);
			}

			const cellLeft = plan.colLefts[c];
			const cellWidth = plan.colWidths[c];
			const isPinLeft = c < pinLeftColumns;
			const isPinRight = c >= pinRightStart;
			const leftArg = isPinRight ? cellLeft - pinRightBaseLeft : cellLeft;
			const targetContainer = isPinLeft ? pinLeftContainer : isPinRight ? pinRightContainer : slot.element;

			if (targetContainer && cellSlot.element.parentNode !== targetContainer) {
				targetContainer.appendChild(cellSlot.element);
			}

			if (isScrollFrameActive) {
				this.currentScrollCellsPatched++;
				this.bindCellSlotDuringScroll(
					cellSlot,
					node,
					rowIndex,
					c,
					col,
					colCount,
					pinLeftColumns,
					pinRightColumns,
					ctx!,
					slot.id,
					leftArg,
					-1,
					cellWidth
				);
				return;
			}

			// Non-scroll active frame: Full bind
			const access = this.engine.cellAccess.get(node.id, rowIndex, node, node.data, c, col);

			let cellClassName = 'og-cell';
			if (c < pinLeftColumns) {
				cellClassName += ' og-cell-pinned-left';
			} else if (isPinRight) {
				cellClassName += ' og-cell-pinned-right';
			}
			if (access.isFocused) {
				cellClassName += ' og-cell-focused';
				cellSlot.element.tabIndex = -1;
				const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
				if (
					activeEl &&
					(activeEl === document.body ||
						(this.viewportRenderer.container &&
							this.viewportRenderer.container.contains(activeEl) &&
							activeEl !== cellSlot.element &&
							!cellSlot.element.contains(activeEl) &&
							!this.isEditorInteractiveElement(activeEl)))
				) {
					if (this.isScrolling) {
						this.deferredFocusCell = cellSlot.element;
					} else {
						this.applyFocus(cellSlot.element);
					}
				}
			} else {
				if (cellSlot.element.hasAttribute('tabindex')) {
					cellSlot.element.removeAttribute('tabindex');
				}
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
						isRowSelected: access.isRowSelected || access.isRowFocused,
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

			if (state.styleSlots?.beforeCellRender) {
				try {
					state.styleSlots.beforeCellRender(access, cellSlot.element);
				} catch (e) {
					console.error('RenderEngine: Error in beforeCellRender styleSlot', e);
				}
			}

			const cellValue = access.value;
			const cellKey = access.isEditing ? `${node.id}:${col.field}` : `${col.field}@${slot.id}`;

			let contentMode: CellContentMode = 'empty';
			let formattedValue = '';

			if (((col as InternalColumnDef<TRowData>).cellRenderer || access.isEditing) && !access.isLoading) {
				contentMode = 'portal';
				if (cellSlot.element.dataset.cellKey !== cellKey || !this.portalMountManager.isCellMounted(cellKey)) {
					if (cellSlot.element.dataset.cellKey) {
						this.releaseCellPortal(cellSlot.element, false, 'invalidated');
						this.portalMountManager.flushCellReleaseTransaction(true);
					}
					cellSlot.contentElement.textContent = '';
				}
				const portalHost = this.ensureCellPortalHost(cellSlot.element);
				this.cellRenderer.showPortalContent(cellSlot.element);
				this.cancelPendingPortalRelease(cellKey);
				this.portalMountManager.mountCell({
					cellKey,
					container: portalHost,
					value: cellValue,
					node,
					col,
					rowIndex,
					colIndex: c,
					isEditing: access.isEditing,
					isLoading: access.isLoading,
					phase: access.isEditing ? 'edit' : phase,
					isScrolling: false,
					isFocused: access.isFocused,
					isSelected: access.isSelected,
				});
			} else {
				if (cellSlot.element.dataset.cellKey) {
					this.releaseCellPortal(cellSlot.element, false, 'invalidated');
				}
				if (access.isLoading) {
					contentMode = 'loading';
					this.cellRenderer.ensureLoadingSkeleton(cellSlot.element);
				} else {
					formattedValue = this.getCheapCellText(node, col, cellSlot);
					contentMode = formattedValue === '' ? 'empty' : 'text';
				}
			}

			const didWrite = cellSlot.update(
				c,
				col.field,
				rowIndex,
				node.id,
				leftArg,
				-1,
				cellWidth,
				cellClassName,
				contentMode,
				access.rawValue,
				formattedValue,
				contentMode === 'portal' ? cellKey : undefined
			);
			if (isScrollFrameActive && didWrite) this.currentScrollCellsWritten++;

			if (state.styleSlots?.afterCellRender) {
				try {
					state.styleSlots.afterCellRender(access, cellSlot.element);
				} catch (e) {
					console.error('RenderEngine: Error in afterCellRender styleSlot', e);
				}
			}
		};

		// Pinned left — always render
		for (let c = 0; c < pinLeftColumns; c++) renderCell(c);
		// Center — entered cols always, stayed cols only when full render needed
		for (const c of colsEntered) {
			if (c >= pinLeftColumns && c < pinRightStart) renderCell(c);
		}
		if (renderStayed) {
			for (const c of colsStayed) {
				if (c >= pinLeftColumns && c < pinRightStart) renderCell(c);
			}
		}
		// Pinned right — always render
		for (let c = pinRightStart; c < colCount; c++) {
			if (c >= 0) renderCell(c);
		}
	}

	public recycleLoadingRowCellsSlot(
		slot: RowSlot<TRowData>,
		visualRow: Extract<VisualRow<TRowData>, { kind: 'loading' }>,
		rowIndex: number,
		colsEntered: number[],
		colsStayed: number[],
		columns: ColumnDef<TRowData>[],
		isScrollFrameActive: boolean,
		ctx?: ScrollRenderContext<TRowData>,
		rowEntered = false,
		_hoistedState?: GridState<TRowData>,
		_hoistedTotalWidth?: number
	): void {
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const plan = ctx?.plan ?? this.engine.columns.getCompiledPlan();
		const colCount = columns.length;
		const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
		const pinLeftWidth = plan.pinLeftWidth;
		const pinRightBaseLeft = plan.pinRightBaseLeft;
		const pinRightWidth = plan.pinRightWidth;
		const pinLeftContainer = this.ensurePinnedContainer(slot, 'left', pinLeftWidth);
		const pinRightContainer = this.ensurePinnedContainer(slot, 'right', pinRightWidth);
		if (pinRightContainer && slot.pinRightContainerLeft !== pinRightBaseLeft) {
			slot.pinRightContainerLeft = pinRightBaseLeft;
			pinRightContainer.style.left = `${pinRightBaseLeft}px`;
		}
		const renderStayed = !isScrollFrameActive || rowEntered;

		const renderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;
			if (isScrollFrameActive) this.currentScrollCellsVisited++;

			let cellSlot = slot.cells.get(c);
			if (!cellSlot) {
				cellSlot = CellSlot.fromElement<TRowData>(this.cellPool.acquire());
				slot.cells.set(c, cellSlot);
			}

			const cellLeft = plan.colLefts[c];
			const cellWidth = plan.colWidths[c];
			const isPinLeft = c < pinLeftColumns;
			const isPinRight = c >= pinRightStart;
			const leftArg = isPinRight ? cellLeft - pinRightBaseLeft : cellLeft;
			const targetContainer = isPinLeft ? pinLeftContainer : isPinRight ? pinRightContainer : slot.element;

			if (targetContainer && cellSlot.element.parentNode !== targetContainer) {
				targetContainer.appendChild(cellSlot.element);
			}

			if (cellSlot.element.dataset.cellKey) {
				this.releaseCellPortal(cellSlot.element);
			}

			let cellClassName = 'og-cell og-cell-loading';

			if (isScrollFrameActive) {
				this.currentScrollCellsPatched++;
				this.markCellDirtyAfterScroll(cellSlot.element);
			} else {
				this.cellRenderer.ensureLoadingSkeleton(cellSlot.element);
			}

			const didWrite = cellSlot.update(
				c,
				col.field,
				rowIndex,
				`loading:${rowIndex}`,
				leftArg,
				-1,
				cellWidth,
				cellClassName,
				'loading',
				undefined,
				'',
				undefined
			);
			if (isScrollFrameActive && didWrite) this.currentScrollCellsWritten++;
		};

		for (let c = 0; c < pinLeftColumns; c++) renderCell(c);
		for (const c of colsEntered) {
			if (c >= pinLeftColumns && c < pinRightStart) renderCell(c);
		}
		if (renderStayed) {
			for (const c of colsStayed) {
				if (c >= pinLeftColumns && c < pinRightStart) renderCell(c);
			}
		}
		for (let c = pinRightStart; c < colCount; c++) {
			if (c >= 0) renderCell(c);
		}
	}

	private bindCellSlotDuringScroll(
		cellSlot: CellSlot<TRowData>,
		node: RowNode<TRowData>,
		rowIndex: number,
		colIndex: number,
		col: ColumnDef<TRowData>,
		colCount: number,
		pinLeftColumns: number,
		pinRightColumns: number,
		ctx: ScrollRenderContext<TRowData>,
		pooledRowId: string,
		left: number,
		right: number,
		width: number
	): void {
		const plan = ctx.plan.columnPlans[colIndex];
		const isEditing = !!(ctx.activeEdit && ctx.activeEdit.rowId === node.id && ctx.activeEdit.colField === col.field);
		const isRowLoading = ctx.loadingVersion > 0 && this.engine.data.isRowLoading(node.id);

		const rendererKind: 'primitive' | 'portal' | 'loading' = isRowLoading
			? 'loading'
			: isEditing || (plan && plan.mode.startsWith('custom-'))
				? 'portal'
				: 'primitive';

		let cellClassName = 'og-cell';
		if (colIndex < pinLeftColumns) {
			cellClassName += ' og-cell-pinned-left';
		} else if (colIndex >= Math.max(pinLeftColumns, colCount - pinRightColumns)) {
			cellClassName += ' og-cell-pinned-right';
		}
		if (rendererKind === 'loading') {
			cellClassName += ' og-cell-loading';
		}

		if (ctx.focusedCell && ctx.focusedCell.rowId === node.id && ctx.focusedCell.colField === col.field) {
			cellSlot.element.tabIndex = -1;
			const isProgrammatic =
				this.programmaticScrollCell && this.programmaticScrollCell.rowId === node.id && this.programmaticScrollCell.colField === col.field;
			this.deferredFocusCell = cellSlot.element;
			if (isProgrammatic) {
				this.programmaticScrollCell = null;
			}
		}

		if (ctx.hasStyleHooks) {
			this.markCellDirtyAfterScroll(cellSlot.element);
			if (this.renderStats) {
				this.renderStats.styleHookCallsDuringScroll++;
			}
		}

		const cellKey = isEditing ? `${node.id}:${col.field}` : `${col.field}@${pooledRowId}`;

		let contentMode: CellContentMode = 'empty';
		let formattedValue = '';

		if (rendererKind === 'loading') {
			contentMode = 'loading';
		} else if (rendererKind === 'portal') {
			contentMode = 'portal';
		} else {
			const cachedVal = this.engine.data.getCachedDisplayValue(node.id, col.field);
			if (cachedVal !== undefined) {
				formattedValue = cachedVal;
				contentMode = formattedValue === '' ? 'empty' : 'text';
			} else {
				formattedValue = '...';
				contentMode = 'text';
				this.markCellDirtyAfterScroll(cellSlot.element);
			}
		}

		const scrollMode = rendererKind === 'portal' ? plan?.mode : undefined;
		const isFocused = ctx.focusedCell?.rowId === node.id && ctx.focusedCell?.colField === col.field;
		const isPreservedPortal =
			rendererKind === 'portal' &&
			scrollMode === 'custom-defer' &&
			cellSlot.lastPortalKey === cellKey &&
			this.portalMountManager.isCellMounted(cellKey);
		const hasMountedPortalForCell = this.portalMountManager.isCellMounted(cellKey);
		const shouldKeepLivePortalDuringScroll = scrollMode === 'custom-live' && hasMountedPortalForCell;
		const shouldKeepPortalDuringScroll = shouldKeepLivePortalDuringScroll || isPreservedPortal;

		if (rendererKind === 'portal' && !shouldKeepPortalDuringScroll) {
			if (cellSlot.element.dataset.cellKey) {
				this.releaseCellPortal(cellSlot.element);
			}
			if (scrollMode === 'custom-fallback') {
				const cachedVal = this.engine.data.getCachedDisplayValue(node.id, col.field);
				if (cachedVal !== undefined) {
					formattedValue = cachedVal;
					contentMode = 'fallback';
				} else {
					formattedValue = '';
					contentMode = 'pending';
				}
			} else if (scrollMode === 'custom-defer' && (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.deferFallback === 'snapshot') {
				const cachedVal = this.engine.data.getCachedDisplayValue(node.id, col.field);
				if (cachedVal !== undefined) {
					formattedValue = cachedVal;
					contentMode = 'fallback';
				} else {
					formattedValue = '';
					contentMode = 'pending';
				}
			} else {
				formattedValue = '';
				contentMode = 'pending';
			}
			this.markCellDirtyAfterScroll(cellSlot.element);
		} else if (rendererKind === 'portal') {
			if (scrollMode === 'custom-live') {
				this.cellRenderer.showPortalContent(cellSlot.element);
				this.cancelPendingPortalRelease(cellKey);
				contentMode = 'portal';
				// Rebind the live portal with updated row data
				const portalHost = this.ensureCellPortalHost(cellSlot.element);
				this.portalMountManager.mountCellImmediately({
					cellKey,
					container: portalHost,
					value: this.getScrollMountValue(node, col, cellSlot),
					node,
					col,
					rowIndex,
					colIndex,
					isEditing,
					isLoading: false,
					phase: 'scroll',
					isScrolling: true,
					isFocused,
					isSelected: false,
				});
			} else if (scrollMode === 'custom-defer') {
				this.cellRenderer.showPortalContent(cellSlot.element);
				contentMode = 'portal';
			}
		} else {
			if (cellSlot.element.dataset.cellKey) {
				this.markCellDirtyAfterScroll(cellSlot.element);
			}
			if (rendererKind === 'loading') {
				contentMode = 'loading';
			}
		}

		const didWrite = cellSlot.update(
			colIndex,
			col.field,
			rowIndex,
			node.id,
			left,
			right,
			width,
			cellClassName,
			contentMode,
			undefined, // Skip raw value reference read during scroll to satisfy Phase 7
			formattedValue,
			contentMode === 'portal' ? cellKey : undefined
		);
		if (didWrite) this.currentScrollCellsWritten++;
		if (this.renderStats) {
			this.renderStats.cellsBoundDuringScroll++;
		}
	}

	private showDeferredSnapshot(cell: HTMLDivElement, node: RowNode<TRowData>, col: ColumnDef<TRowData>): boolean {
		if ((col as InternalColumnDef<TRowData>).cellRendererCapabilities?.deferFallback !== 'snapshot') return false;
		const cachedVal = this.engine.data.getCachedDisplayValue(node.id, col.field);
		if (cachedVal === undefined) return false;
		this.cellRenderer.setPrimitiveContent(cell, cachedVal, 'fallback');
		return true;
	}

	private getScrollMountValue(node: RowNode<TRowData>, col: ColumnDef<TRowData>, cellSlot?: CellSlot<TRowData>): unknown {
		const cachedVal = this.engine.data.getCachedDisplayValue(node.id, col.field);
		if (cachedVal !== undefined) return cachedVal;
		return cellSlot?.lastFormattedValue ?? '';
	}

	private getCheapCellText(
		node: RowNode<TRowData>,
		col: ColumnDef<TRowData>,
		cellSlot?: CellSlot<TRowData>,
		ctx?: ScrollRenderContext<TRowData>
	): string {
		const isScrolling = ctx ? ctx.isScrolling : this.isScrollFrameActive || this.engine.isScrolling;
		if (isScrolling) {
			const cachedVal = this.engine.data.getCachedDisplayValue(node.id, col.field);
			if (cachedVal !== undefined) return cachedVal;
			return cellSlot?.lastFormattedValue ?? '';
		}
		if (col.valueGetter || this.engine.hasFormula(node.id, col.field)) {
			const val = this.engine.data.getCellValue(node.id, col.field);
			return val == null ? '' : String(val);
		}
		const raw = node.data ? (node.data as Record<string, unknown>)[col.field] : undefined;
		return raw == null ? '' : String(raw);
	}

	private showScrollFallback(cell: HTMLDivElement, node: RowNode<TRowData>, col: ColumnDef<TRowData>): void {
		const cachedVal = this.engine.data.getCachedDisplayValue(node.id, col.field);
		if (cachedVal !== undefined) {
			this.cellRenderer.setPrimitiveContent(cell, cachedVal, 'fallback');
		} else {
			this.cellRenderer.showPendingContent(cell);
		}
	}

	public markCellDirtyAfterScroll(cell: HTMLDivElement): void {
		if (!this.dirtyCellsAfterScroll.has(cell)) {
			this.dirtyCellsAfterScroll.add(cell);
			this.dirtyCellsMarkedDuringScroll++;
		}
	}

	public releaseRowSlot(rowIndex: number, slot: RowSlot<TRowData>, isScrollFrameActive: boolean): void {
		this.releaseRowPortal(slot);
		if (isScrollFrameActive) {
			this.releaseSlotCellsHot(slot);
			slot.unbindHot();
			this.activeRows.delete(rowIndex);
			if (slot.element.parentNode) slot.element.remove();
			this.rowPool.releaseHot(slot.element);
		} else {
			for (const cell of slot.cells.values()) {
				if (cell.lastPortalKey) {
					this.releaseCellPortal(cell.element);
				}
				if (cell.element.parentNode) {
					cell.element.remove();
				}
				this.cellPool.releaseCold(cell.element);
			}
			slot.destroyCold();
			this.activeRows.delete(rowIndex);
			if (slot.element.parentNode) slot.element.remove();
			this.rowPool.releaseCold(slot.element);
		}
	}

	private releaseSlotCellsHot(slot: RowSlot<TRowData>): void {
		for (const cell of slot.cells.values()) {
			if (cell.lastPortalKey) {
				this.releaseCellPortal(cell.element);
			}
			cell.unbindHot();
			if (cell.element.parentNode) {
				cell.element.remove();
			}
			this.cellPool.releaseHot(cell.element);
		}
		slot.cells.clear();
	}

	private unbindAllCellsInSlot(slot: RowSlot<TRowData>): void {
		const cols = Array.from(slot.cells.keys());
		for (const c of cols) {
			const cell = slot.cells.get(c);
			if (cell) {
				if (cell.lastPortalKey) {
					this.releaseCellPortal(cell.element);
				}
				cell.unbindCold();
				slot.cells.delete(c);
				if (cell.element.parentNode) {
					cell.element.remove();
				}
				this.cellPool.releaseCold(cell.element);
			}
		}
	}

	public releaseCellPortal(
		cell: HTMLDivElement,
		forceDeferred?: boolean,
		reason: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated' = 'scrolled-out'
	): void {
		const cellKey = cell.dataset.cellKey;
		if (!cellKey) return;
		const container = this.getCellPortalHost(cell) ?? cell;
		const isDeferred = forceDeferred ?? (this.isScrollFrameActive || this.isScrolling);

		if (isDeferred) {
			this.currentScrollPortalOps++;
			this.portalMountManager.releaseCellForScroll({
				cellKey,
				container,
				flushSync: false,
			});
		} else {
			this.portalMountManager.releaseCell({
				cellKey,
				container,
				flushSync: false,
				reason,
			});
		}
	}

	public cancelPendingPortalRelease(cellKey: string): void {
		this.pendingPortalReleasesAfterScroll.delete(cellKey);
	}

	private releaseRowPortal(slot: RowSlot<TRowData>): boolean {
		const rowKey = slot.element.dataset.rowKey;
		if (!rowKey) return false;
		const host = this.rowPortalHosts.get(slot.element);
		if (!host) {
			delete slot.element.dataset.rowKey;
			return false;
		}
		this.portalMountManager.releaseRow({ rowKey, container: host });
		host.hidden = true;
		delete host.dataset.rowKey;
		host.remove();
		delete slot.element.dataset.rowKey;
		return true;
	}

	private ensureRowPortalHost(row: HTMLElement): HTMLElement {
		let host = this.rowPortalHosts.get(row);
		if (!host) {
			host = document.createElement('div');
			host.className = 'og-row-portal-host';
			host.hidden = true;
			row.appendChild(host);
			this.rowPortalHosts.set(row, host);
		} else if (host.parentElement !== row) {
			row.appendChild(host);
		}
		return host;
	}

	private ensureCellPortalHost(cell: HTMLDivElement): HTMLDivElement {
		this.cellRenderer.getOrCreateCellContentLayer(cell);
		return this.cellRenderer.getOrCreatePortalHost(cell) as HTMLDivElement;
	}

	private getCellPortalHost(cell: HTMLDivElement): HTMLDivElement | null {
		return this.cellRenderer.getPortalHost(cell) as HTMLDivElement | null;
	}

	public decorateDirtyCellsAfterScroll(options?: { maxCells?: number }): { remaining: number; processed: number } {
		const maxCells = options?.maxCells ?? Infinity;
		if (this.dirtyCellsAfterScroll.size === 0 && this.dirtyRowsAfterScroll.size === 0) {
			return { remaining: 0, processed: 0 };
		}
		const rowModel = this.engine.getRowModel();
		if (!rowModel) {
			this.dirtyCellsAfterScroll.clear();
			this.dirtyRowsAfterScroll.clear();
			return { remaining: 0, processed: 0 };
		}
		const state = this.engine.stateManager.getState();
		const columns = this.engine.columns.getDisplayedColumns();

		// Hoist viewport range computation — these are O(log n) binary searches, must not run per-comparison
		const rowCount = rowModel.getVisualRowCount();
		const colCount = columns.length;
		const rowRange = this.engine.viewport.getVisibleRowRange(rowCount);
		const colRange = this.engine.viewport.getVisibleColumnRange(colCount);
		const rowCenter = (rowRange.startIdx + rowRange.endIdx) / 2;
		const colCenter = (colRange.startIdx + colRange.endIdx) / 2;
		const activeEdit = state.activeEdit;
		const focusedCell = state.selection.focus;

		const getCellPriority = (cell: HTMLDivElement): number => {
			const rowIndexStr = cell.dataset.rowIndex;
			const colField = cell.dataset.colField;
			if (!rowIndexStr || !colField) return 0;
			const rowIndex = Number(rowIndexStr);

			if (activeEdit && cell.dataset.rowId === activeEdit.rowId && colField === activeEdit.colField) {
				return 6;
			}
			if (focusedCell && cell.dataset.rowId === focusedCell.rowId && colField === focusedCell.colField) {
				return 5;
			}

			const colIndex = this.engine.columns.getColumnIndex(colField);
			const isRowVisible = rowIndex >= rowRange.startIdx && rowIndex <= rowRange.endIdx;
			const isColVisible = colIndex >= colRange.startIdx && colIndex <= colRange.endIdx;

			if (!isRowVisible || !isColVisible) return 1;

			const normDist = Math.abs(rowIndex - rowCenter) + Math.abs(colIndex - colCenter);
			return 4 - normDist * 0.01;
		};

		let processed = 0;
		// Precompute priority once per cell so the sort comparator is O(1) per comparison
		// rather than calling getColumnIndex (a map lookup) O(n log n) times.
		const allDirty: Array<{ cell: HTMLDivElement; priority: number }> = [];
		for (const cell of this.dirtyCellsAfterScroll) {
			allDirty.push({ cell, priority: getCellPriority(cell) });
		}
		allDirty.sort((a, b) => b.priority - a.priority);

		const limit = Math.min(allDirty.length, maxCells);
		for (let i = 0; i < limit; i++) {
			const { cell } = allDirty[i];
			this.dirtyCellsAfterScroll.delete(cell);
			const rowIndexStr = cell.dataset.rowIndex;
			const colField = cell.dataset.colField;
			if (!rowIndexStr || !colField) continue;

			const rowIndex = Number(rowIndexStr);
			const visualRow = rowModel.getVisualRow(rowIndex);
			const colIndex = this.engine.columns.getColumnIndex(colField);

			if (visualRow?.kind === 'data' && colIndex >= 0) {
				const slot = this.activeRows.get(rowIndex);
				if (slot && slot.cells.get(colIndex)?.element === cell) {
					this.recycleRowCellsSlot(slot, visualRow.node, rowIndex, [colIndex], [], columns, false, undefined, 'scroll-idle', true);
					this.postScrollDirtyCellsDecorated++;
					processed++;
				}
			} else if (visualRow?.kind === 'loading' && colIndex >= 0) {
				const slot = this.activeRows.get(rowIndex);
				if (slot && slot.cells.get(colIndex)?.element === cell) {
					this.recycleLoadingRowCellsSlot(slot, visualRow, rowIndex, [colIndex], [], columns, false, undefined, true);
					this.postScrollDirtyCellsDecorated++;
					processed++;
				}
			}
		}

		const remaining = this.dirtyCellsAfterScroll.size;
		if (remaining === 0) {
			for (const r of this.dirtyRowsAfterScroll) {
				const slot = this.activeRows.get(r);
				const visualRow = rowModel.getVisualRow(r);
				if (slot && visualRow?.kind === 'data') {
					this.updateRowClassNameSlot(slot, visualRow.node, r, state);
				}
			}
			this.dirtyRowsAfterScroll.clear();
		}

		return { remaining, processed };
	}

	public applyFocus(cell: HTMLDivElement): void {
		if (this.isScrollFrameActive || this.isScrolling) {
			this.deferredFocusCell = cell;
			if (this.renderStats) {
				this.renderStats.focusCallsDuringScroll++;
			}
			return;
		}
		cell.focus({ preventScroll: true });
	}

	private isEditorInteractiveElement(el: Element | null): boolean {
		if (!el) return false;
		return el.closest('.og-cell-editor') !== null || el.closest('.og-context-menu') !== null;
	}
}

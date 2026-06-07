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
import { RowSlotPool } from './rowSlotPool.js';
import { CellSlot, type CellContentMode } from './cellSlot.js';

// Precomputed base class strings for non-data row kinds — avoids string concat per row per frame.
const ROW_KIND_BASE: Record<string, string> = {
	loading: 'og-row og-row-loading',
	group: 'og-row og-row-group',
	detail: 'og-row og-row-detail',
	footer: 'og-row og-row-footer',
};
import {
	applyRenderWindowRuntimeLimits,
	computeRenderWindow,
	diffRenderWindow,
	getRowIndices,
	sameRenderedWindow,
	type RenderWindow,
} from './renderWindow.js';
import { createEditRendererKey, createSlotRendererKey } from './identityKeys.js';

export class RowRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly geometryController: GeometryController<TRowData>;
	/** @internal — public for test access only; treat as private in production code. */
	public readonly portalMountManager: PortalMountManager<TRowData>;
	private readonly cellRenderer: CellRenderer;
	private readonly viewportRenderer: ViewportRenderer<TRowData>;

	// ── Phase 2: Stable row slot pool ─────────────────────────────────────────────────
	public rowSlotPool!: RowSlotPool<TRowData>;

	/**
	 * Lookup: visualRowIndex → RowSlot.
	 * Rebuilt every recycleViewport call from the pool positions.
	 * O(n) rebuild; exists purely so external callers (repaint, decorate) can look up slots.
	 */
	public activeRows = new Map<number, RowSlot<TRowData>>();
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
	public isScrollFrameActive = false;
	public isScrolling = false;
	public dirtyCellsMarkedDuringScroll = 0;

	// Phase 10: stable-slot virtualization stats
	public slotStats = {
		sameWindowBailouts: 0,
		rowSlotAppendsTotal: 0,
		rowSlotRemovesTotal: 0,
		cellAppendsTotal: 0,
		cellRemovesTotal: 0,
		fullRebindFrames: 0,
		enteredOnlyFrames: 0,
	};

	// Reusable sets — avoid per-frame allocations
	private readonly _rowsEnteredSet = new Set<number>();
	public postScrollDirtyCellsDecorated = 0;

	private rowPortalHosts = new WeakMap<HTMLElement, HTMLElement>();

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

	public mount(_estRows: number): void {
		this.rowSlotPool = new RowSlotPool<TRowData>(this.viewportRenderer.rowsContainer!);
	}

	public unmount(): void {
		this.clearActiveRows();
		this.dirtyCellsAfterScroll.clear();
		this.dirtyRowsAfterScroll.clear();
		this.pendingPortalReleasesAfterScroll.clear();
		this.deferredFocusCell = null;
		this.programmaticScrollCell = null;
		this.currentWindow = null;
	}

	public sync(_frame: InvalidationFrame): void {
		// Hook for Orchestrator — intentionally empty
	}

	public clearActiveRows(): void {
		// Release portals for all active rows, then destroy the pool
		for (const slot of this.rowSlotPool?.getSlots() ?? []) {
			this.releaseRowPortal(slot);
			// Release any cell portals
			slot.forEachCell((cell) => {
				if (cell.lastPortalKey) this.releaseCellPortal(cell.element, false, 'destroyed');
			});
		}
		this.rowSlotPool?.destroy();
		// Re-create pool attached to container (mount might not be re-called)
		if (this.viewportRenderer.rowsContainer) {
			this.rowSlotPool = new RowSlotPool<TRowData>(this.viewportRenderer.rowsContainer);
		}
		this.activeRows.clear();
	}

	// ── Pinned container management ──────────────────────────────────────────────────

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

		// Phase 3: iterate pool slots instead of activeRows.values()
		for (const slot of this.rowSlotPool.getSlots()) {
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

	// ── Phase 3: Core recycleViewport — stable slot virtualization ───────────────────

	public recycleViewport(isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow): void {
		this.isScrollFrameActive = isScrollFrameActive;
		this.isScrolling = isScrollFrameActive || this.engine.isScrolling;

		const state = ctx?.state ?? this.engine.stateManager.getState();
		const nextWindow =
			precomputedWindow ??
			applyRenderWindowRuntimeLimits(computeRenderWindow(this.engine), state.runtimeLimits, () => {
				if (this.renderStats) {
					this.renderStats.runtimeLimitsClamped = (this.renderStats.runtimeLimitsClamped || 0) + 1;
				}
			});

		// ── Phase 3: Same-window bailout ─────────────────────────────────────────────
		if (isScrollFrameActive && sameRenderedWindow(this.currentWindow, nextWindow)) {
			this.slotStats.sameWindowBailouts++;
			return;
		}

		// Compute delta for stats and "entered rows only" optimisation
		const delta = diffRenderWindow(this.currentWindow, nextWindow);

		if (isScrollFrameActive && this.renderStats) {
			this.renderStats.rowsEnteredDuringScroll = (this.renderStats.rowsEnteredDuringScroll || 0) + delta.rowsEntered.length;
			this.renderStats.rowsExitedDuringScroll = (this.renderStats.rowsExitedDuringScroll || 0) + delta.rowsExited.length;
			this.renderStats.rowsStayedDuringScroll = (this.renderStats.rowsStayedDuringScroll || 0) + delta.rowsStayed.length;
			this.renderStats.colsEnteredDuringScroll = (this.renderStats.colsEnteredDuringScroll || 0) + delta.colsEntered.length;
			this.renderStats.colsExitedDuringScroll = (this.renderStats.colsExitedDuringScroll || 0) + delta.colsExited.length;
			this.renderStats.colsStayedDuringScroll = (this.renderStats.colsStayedDuringScroll || 0) + delta.colsStayed.length;
		}

		// Load visible blocks if server row model
		const rowModel = this.engine.getRowModel();
		if (rowModel && typeof rowModel.loadVisibleBlocks === 'function') {
			rowModel.loadVisibleBlocks(nextWindow.rowStart, nextWindow.rowEnd);
		}

		const plan = ctx?.plan ?? this.engine.columns.getCompiledPlan();
		const columns = plan.displayedColumns;
		const loading = ctx ? ctx.loadingVersion > 0 : state.loading;

		// ── Phase 2: Identity-stable slot assignment ────────────────────────────────
		//
		// Each row KEEPS its slot across frames for as long as it remains in the
		// rendered window. Only entering/exiting rows swap slots — stayed rows are
		// 100% skipped in the hot path (no DOM work, no portal mounts).
		//
		// Data structures:
		//   activeRows : Map<rowIndex, RowSlot>  — persists across frames
		//   rowSlotPool free-queue               — unassigned, ready-to-take slots
		//
		const allRows = getRowIndices(nextWindow);
		const totalSlots = allRows.length;
		const prevSlotCount = this.rowSlotPool.count;

		this.rowSlotPool.resetScrollStats();

		// Step A: Release exiting rows — evacuate their portals, unbind, return slot to free queue.
		//         (On the very first frame currentWindow is null → delta.rowsExited is empty.)
		for (const r of delta.rowsExited) {
			const slot = this.activeRows.get(r);
			if (slot) {
				// Track recycled rows for scroll stats.
				if (isScrollFrameActive) this.currentScrollRowsRecycled++;
				// Release row portal (for full-width rows: group, detail, footer).
				this.releaseRowPortal(slot);
				// Evacuate cell portals using the scroll-specific path (releaseCellForScroll).
				// This immediately moves the portal's DOM container to the hidden warm-cache
				// container — keeping it connected to the document (so React/portal lifecycles
				// stay intact) but removing it from inside `.og-cell` (evacuation). This avoids:
				//   1. Firing onUnmountCellContent during the scroll frame (deferred by design).
				//   2. Incrementing portalReleasesDuringScroll (customRendererManager handles it).
				//   3. Leaving stale portal DOM inside a recycled cell slot.
				// Using forceDeferred=undefined lets releaseCellPortal choose based on
				// isScrollFrameActive (always true here), which routes to releaseCellForScroll.
				// After evacuating, clear lastPortalKey and dataset.cellKey so the recycled
				// slot doesn't appear to still hold a portal when the entering row binds.
				slot.forEachCell((cell) => {
					if (cell.lastPortalKey) {
						this.releaseCellPortal(cell.element, undefined, 'scrolled-out');
						cell.lastPortalKey = undefined;
						delete cell.element.dataset['cellKey'];
					}
				});
				slot.unbindHot();
				this.activeRows.delete(r);
				this.rowSlotPool.releaseSlot(slot);
			}
		}

		// Step B: Grow pool if entering rows outnumber freed slots.
		if (totalSlots > this.rowSlotPool.count) {
			this.rowSlotPool.growTo(totalSlots, isScrollFrameActive);
		}

		// Step C: Assign free slots to entering rows.
		//         (Includes brand-new slots created in step B.)
		for (const r of delta.rowsEntered) {
			const slot = this.rowSlotPool.acquireSlot(isScrollFrameActive);
			this.activeRows.set(r, slot);
		}

		// Step D: Shrink pool if free slots are excess (pool grew in a prior frame
		//         but the viewport has since shrunk).
		if (this.rowSlotPool.count > totalSlots) {
			this.rowSlotPool.shrinkFreeBy(this.rowSlotPool.count - totalSlots, isScrollFrameActive);
		}

		if (isScrollFrameActive) {
			this.slotStats.rowSlotAppendsTotal += this.rowSlotPool.slotAppendCount;
			this.slotStats.rowSlotRemovesTotal += this.rowSlotPool.slotRemoveCount;
		}

		// ── Phase 7: Column layout constants ─────────────────────────────────────────
		const pinLeftColumns = nextWindow.pinLeftCols;
		const pinRightColumns = nextWindow.pinRightCols;
		const colCount = columns.length;
		const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
		const centerColStart = nextWindow.colStart;
		const centerColEnd = nextWindow.colEnd;
		const centerColCount = Math.max(0, centerColEnd - centerColStart + 1);

		// ── Determine rebind scope ────────────────────────────────────────────────────
		// Identity-stable "entered-only" optimisation:
		//   - Scroll frame with no column/pinned changes: ONLY bind newly-entered rows.
		//     Stayed rows keep their slot assignment and all DOM content unchanged.
		//   - Column layout changed, pinned offset changed, pool resized, or non-scroll
		//     frame (initial paint / forced repaint): rebind ALL rows.
		const columnLayoutChanged = delta.colsEntered.length > 0 || delta.colsExited.length > 0;
		// Pinned rows change their CSS top on every vertical scroll frame (they "follow"
		// scrollTop). However this does NOT require a full rebind of every stayed row —
		// only the pinned rows themselves need position recalculation.
		const pinnedScrollOffsetChanged =
			!!this.currentWindow &&
			(nextWindow.pinTopRows > 0 || nextWindow.pinBottomRows > 0) &&
			this.currentWindow.scrollTop !== nextWindow.scrollTop;
		// rebindAll = true forces every visible row to be re-processed.
		// pinnedScrollOffsetChanged and slotPoolResized are intentionally excluded:
		//   - pinnedScrollOffsetChanged: pinned rows added selectively to rowsToProcess below.
		//   - slotPoolResized: entering rows are already in delta.rowsEntered; rebinding ALL
		//     stayed rows when the pool grows by just 1 is unnecessary and costly.
		const rebindAll = !isScrollFrameActive || columnLayoutChanged;

		if (isScrollFrameActive) {
			if (rebindAll) this.slotStats.fullRebindFrames++;
			else this.slotStats.enteredOnlyFrames++;
		}

		const rowsEnteredSet = this._rowsEnteredSet;
		rowsEnteredSet.clear();
		for (const r of delta.rowsEntered) rowsEnteredSet.add(r);

		// Hoisted constants
		const hoistedTotalWidth = plan.totalWidth;
		const hoistedTotalHeight = nextWindow.pinBottomRows > 0 ? this.engine.geometry.getTotalHeight(state.defaultRowHeight) : 0;

		// ── Phase 3+4: Bind slots ─────────────────────────────────────────────────────
		//
		// Identity-stable "entered-only" optimisation:
		//   rebindAll=true               → all visible rows
		//   pinnedScrollOffsetChanged    → entered rows + pinned rows (position update only)
		//   neither                      → entered rows only (stayed rows: zero work)
		//
		let rowsToProcess: number[];
		if (rebindAll) {
			rowsToProcess = allRows;
		} else if (pinnedScrollOffsetChanged) {
			// Only entered rows + pinned rows need processing. Stayed non-pinned rows
			// retain their existing slot/cell content — no DOM work required.
			rowsToProcess = [...delta.rowsEntered];
			for (let pr = 0; pr < nextWindow.pinTopRows; pr++) {
				if (!rowsEnteredSet.has(pr)) rowsToProcess.push(pr);
			}
			const pinBottomStart = Math.max(0, nextWindow.rowCount - nextWindow.pinBottomRows);
			for (let pr = pinBottomStart; pr < nextWindow.rowCount; pr++) {
				if (!rowsEnteredSet.has(pr)) rowsToProcess.push(pr);
			}
		} else {
			rowsToProcess = delta.rowsEntered;
		}

		// Track cells completely skipped due to identity-stable stayed-row optimisation
		if (isScrollFrameActive && this.renderStats) {
			const rowsSkipped = allRows.length - rowsToProcess.length;
			if (rowsSkipped > 0) {
				const visibleCols = pinLeftColumns + centerColCount + pinRightColumns;
				this.renderStats.cellsSkippedDuringScroll = (this.renderStats.cellsSkippedDuringScroll || 0) + rowsSkipped * visibleCols;
			}
		}

		for (const r of rowsToProcess) {
			if (isScrollFrameActive) this.currentScrollRowsVisited++;

			const slot = this.activeRows.get(r);
			if (!slot) continue;

			let visualRow = rowModel ? rowModel.getVisualRow(r) : null;
			if (!visualRow && loading) {
				visualRow = { kind: 'loading', id: `loading:${r}`, rowIndex: r };
			}
			if (!visualRow) {
				slot.unbindHot();
				continue;
			}

			// ── Position calculation ──────────────────────────────────────────────────
			let rowTop = this.engine.geometry.rowTops[r];
			const rowHeight = this.engine.geometry.rowHeights[r];
			const pinTopRows = nextWindow.pinTopRows;
			const pinBottomRows = nextWindow.pinBottomRows;
			const scrollTop = this.engine.viewport.scrollTop;
			const viewportHeight = this.engine.viewport.viewportHeight;

			if (r < pinTopRows) {
				rowTop = rowTop + scrollTop;
			} else if (r >= nextWindow.rowCount - pinBottomRows) {
				const bottomOffset = hoistedTotalHeight - this.engine.geometry.rowTops[r];
				rowTop = scrollTop + viewportHeight - bottomOffset;
			}

			// ── Row class name ────────────────────────────────────────────────────────
			let rowClassName = ROW_KIND_BASE[visualRow.kind] ?? 'og-row';
			if (visualRow.kind === 'group') {
				if (state.styleSlots?.groupRowClass) {
					try {
						const customClass = state.styleSlots.groupRowClass(visualRow);
						if (customClass) rowClassName += ' ' + customClass;
					} catch (e) {
						console.error('RenderEngine: Error in groupRowClass styleSlot', e);
					}
				}
			} else if (visualRow.kind === 'detail') {
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

			// ── Phase 4: Bind cells based on row kind ────────────────────────────────
			const rowEntered = rowsEnteredSet.has(r);
			if (visualRow.kind === 'loading') {
				this.releaseRowPortal(slot);
				this._bindAllLoadingCells(
					slot,
					r,
					pinLeftColumns,
					pinRightColumns,
					pinRightStart,
					centerColStart,
					centerColCount,
					columns,
					plan,
					isScrollFrameActive,
					ctx,
					state
				);
			} else if (visualRow.kind === 'data') {
				this.releaseRowPortal(slot);
				this._bindAllDataCells(
					slot,
					visualRow.node,
					r,
					pinLeftColumns,
					pinRightColumns,
					pinRightStart,
					centerColStart,
					centerColCount,
					columns,
					plan,
					isScrollFrameActive,
					ctx,
					state,
					rowEntered,
					delta.colsEntered,
					delta.colsExited
				);
			} else {
				// ── Phase 9: Full-width row (group / detail / footer) ─────────────────
				this._bindFullWidthRow(slot, visualRow, columns);
			}
		}

		this.currentWindow = nextWindow;
	}

	// ── Phase 5+6: Lane cell binding helpers ─────────────────────────────────────────

	/** Shared init/release callbacks for all ensureXCells calls. */
	private _initCell(el: HTMLDivElement): void {
		this.cellRenderer.initializeCell(el);
	}

	private _releaseCellFn(cell: CellSlot<TRowData>): void {
		if (cell.lastPortalKey) this.releaseCellPortal(cell.element, false, 'destroyed');
		cell.unbindCold();
	}

	/**
	 * Phase 5+6: Bind all cells for a data row using stable lane arrays.
	 * Ensures correct cell count in each lane (no-op when count unchanged),
	 * then binds each cell to its column — zero DOM moves during steady-state scroll.
	 */
	private _bindAllDataCells(
		slot: RowSlot<TRowData>,
		node: RowNode<TRowData>,
		rowIndex: number,
		pinLeftColumns: number,
		pinRightColumns: number,
		pinRightStart: number,
		centerColStart: number,
		centerColCount: number,
		columns: ColumnDef<TRowData>[],
		plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>,
		isScrollFrameActive: boolean,
		ctx: ScrollRenderContext<TRowData> | undefined,
		state: GridState<TRowData>,
		rowEntered: boolean,
		colsEntered: readonly number[] = [],
		colsExited: readonly number[] = []
	): void {
		const pinLeftWidth = plan.pinLeftWidth;
		const pinRightBaseLeft = plan.pinRightBaseLeft;
		const pinRightWidth = plan.pinRightWidth;
		const colCount = columns.length;

		// Ensure pinned containers (lazy creation, width-based)
		const pinLeftContainer = this.ensurePinnedContainer(slot, 'left', pinLeftWidth);
		const pinRightContainer = this.ensurePinnedContainer(slot, 'right', pinRightWidth);
		if (pinRightContainer && slot.pinRightContainerLeft !== pinRightBaseLeft) {
			slot.pinRightContainerLeft = pinRightBaseLeft;
			pinRightContainer.style.left = `${pinRightBaseLeft}px`;
		}

		// Update slot column-layout metadata for getCellForCol() lookups
		slot.centerColStart = centerColStart;
		slot.pinLeftCount = pinLeftColumns;
		slot.pinRightStart = pinRightStart;

		const initCell = (el: HTMLDivElement) => this._initCell(el);
		const releaseCellFn = (cell: CellSlot<TRowData>) => this._releaseCellFn(cell);

		// ── Phase 7: Horizontal same-count bailout ────────────────────────────────────
		// ensureXCells is a no-op when the count hasn't changed (zero DOM appends/removes).
		slot.ensureLeftCells(pinLeftColumns, pinLeftContainer, initCell, releaseCellFn);
		slot.ensureCenterCells(centerColCount, initCell, releaseCellFn);
		slot.ensureRightCells(pinRightColumns, pinRightContainer, initCell, releaseCellFn);

		// ── Bind left cells ───────────────────────────────────────────────────────────
		for (let i = 0; i < pinLeftColumns; i++) {
			const col = columns[i];
			if (!col) continue;
			const cellSlot = slot.leftCells[i];
			if (!cellSlot) continue;
			if (isScrollFrameActive) this.currentScrollCellsVisited++;
			const leftArg = plan.colLefts[i];
			const cellWidth = plan.colWidths[i];
			if (isScrollFrameActive) {
				this.currentScrollCellsPatched++;
				this.bindCellSlotDuringScroll(
					cellSlot,
					node,
					rowIndex,
					i,
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
			} else {
				this._bindCellFull(
					cellSlot,
					slot.id,
					node,
					rowIndex,
					i,
					col,
					pinLeftColumns,
					pinRightColumns,
					pinRightStart,
					pinRightBaseLeft,
					plan,
					state,
					isScrollFrameActive,
					ctx
				);
			}
		}

		// ── Bind center cells ─────────────────────────────────────────────────────────
		//
		// Identity-stable column optimisation:
		// During a scroll frame where the row did not freshly enter, check each center cell's
		// existing column assignment (cellSlot.colIndex) against the expected column for that
		// position (centerColStart + i). If they match, the cell's content is still valid —
		// skip it entirely (zero DOM work). Only cells whose expected column changed (newly
		// added, or re-indexed after ensureCenterCells grow/shrink) need rebinding.
		//
		// This means:
		//   • Pure vertical scroll (no col change)  → colsEntered=[] → rowEntered=false rows
		//     are not in rowsToProcess at all; this path never runs for them.
		//   • Horizontal scroll (colsEntered/colsExited non-empty) → only cells where the
		//     expected column index changed need work. Stayed cells are skipped.
		//   • Entered rows → rowEntered=true → full bind, no skip.
		for (let i = 0; i < centerColCount; i++) {
			const c = centerColStart + i;
			const col = columns[c];
			if (!col) continue;
			const cellSlot = slot.centerCells[i];
			if (!cellSlot) continue;

			// Identity-stable skip: if this cell already holds the correct column
			// (i.e. colIndex matches the expected position-indexed column), its DOM
			// content and portal are still valid — no work needed.
			if (isScrollFrameActive && !rowEntered && cellSlot.colIndex === c) {
				continue;
			}

			if (isScrollFrameActive) this.currentScrollCellsVisited++;
			const leftArg = plan.colLefts[c];
			const cellWidth = plan.colWidths[c];
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
			} else {
				this._bindCellFull(
					cellSlot,
					slot.id,
					node,
					rowIndex,
					c,
					col,
					pinLeftColumns,
					pinRightColumns,
					pinRightStart,
					pinRightBaseLeft,
					plan,
					state,
					isScrollFrameActive,
					ctx
				);
			}
		}

		// ── Bind right cells ──────────────────────────────────────────────────────────
		for (let i = 0; i < pinRightColumns; i++) {
			const c = pinRightStart + i;
			if (c >= colCount) continue;
			const col = columns[c];
			if (!col) continue;
			const cellSlot = slot.rightCells[i];
			if (!cellSlot) continue;
			if (isScrollFrameActive) this.currentScrollCellsVisited++;
			const cellLeft = plan.colLefts[c];
			const cellWidth = plan.colWidths[c];
			const leftArg = cellLeft - pinRightBaseLeft;
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
			} else {
				this._bindCellFull(
					cellSlot,
					slot.id,
					node,
					rowIndex,
					c,
					col,
					pinLeftColumns,
					pinRightColumns,
					pinRightStart,
					pinRightBaseLeft,
					plan,
					state,
					isScrollFrameActive,
					ctx
				);
			}
		}
	}

	/**
	 * Phase 5+6: Bind all cells for a loading row.
	 */
	private _bindAllLoadingCells(
		slot: RowSlot<TRowData>,
		rowIndex: number,
		pinLeftColumns: number,
		pinRightColumns: number,
		pinRightStart: number,
		centerColStart: number,
		centerColCount: number,
		columns: ColumnDef<TRowData>[],
		plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>,
		isScrollFrameActive: boolean,
		ctx: ScrollRenderContext<TRowData> | undefined,
		state: GridState<TRowData>
	): void {
		const pinLeftWidth = plan.pinLeftWidth;
		const pinRightBaseLeft = plan.pinRightBaseLeft;
		const pinRightWidth = plan.pinRightWidth;
		const colCount = columns.length;

		const pinLeftContainer = this.ensurePinnedContainer(slot, 'left', pinLeftWidth);
		const pinRightContainer = this.ensurePinnedContainer(slot, 'right', pinRightWidth);
		if (pinRightContainer && slot.pinRightContainerLeft !== pinRightBaseLeft) {
			slot.pinRightContainerLeft = pinRightBaseLeft;
			pinRightContainer.style.left = `${pinRightBaseLeft}px`;
		}

		slot.centerColStart = centerColStart;
		slot.pinLeftCount = pinLeftColumns;
		slot.pinRightStart = pinRightStart;

		const initCell = (el: HTMLDivElement) => this._initCell(el);
		const releaseCellFn = (cell: CellSlot<TRowData>) => this._releaseCellFn(cell);

		slot.ensureLeftCells(pinLeftColumns, pinLeftContainer, initCell, releaseCellFn);
		slot.ensureCenterCells(centerColCount, initCell, releaseCellFn);
		slot.ensureRightCells(pinRightColumns, pinRightContainer, initCell, releaseCellFn);

		const bindLoadingCell = (cellSlot: CellSlot<TRowData>, c: number, leftArg: number) => {
			const col = columns[c];
			if (!col || !cellSlot) return;
			if (isScrollFrameActive) this.currentScrollCellsVisited++;

			if (cellSlot.element.dataset.cellKey) this.releaseCellPortal(cellSlot.element);

			const cellWidth = plan.colWidths[c];

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
				'og-cell og-cell-loading',
				'loading',
				undefined,
				'',
				undefined
			);
			if (isScrollFrameActive && didWrite) this.currentScrollCellsWritten++;
		};

		for (let i = 0; i < pinLeftColumns; i++) {
			bindLoadingCell(slot.leftCells[i], i, plan.colLefts[i]);
		}
		for (let i = 0; i < centerColCount; i++) {
			const c = centerColStart + i;
			bindLoadingCell(slot.centerCells[i], c, plan.colLefts[c]);
		}
		for (let i = 0; i < pinRightColumns; i++) {
			const c = pinRightStart + i;
			if (c < colCount) bindLoadingCell(slot.rightCells[i], c, plan.colLefts[c] - pinRightBaseLeft);
		}
	}

	/**
	 * Phase 9: Full-width row (group / detail / footer).
	 * Reduce cell lane counts to zero (releasing any existing cell slots) and
	 * mount the row portal into the slot's portal host.
	 */
	private _bindFullWidthRow(slot: RowSlot<TRowData>, visualRow: VisualRow<TRowData>, _columns: ColumnDef<TRowData>[]): void {
		const initCell = (el: HTMLDivElement) => this._initCell(el);
		const releaseCellFn = (cell: CellSlot<TRowData>) => this._releaseCellFn(cell);

		// Collapse all lanes — any previously mounted cell portals are released by releaseCellFn
		slot.ensureLeftCells(0, null, initCell, releaseCellFn);
		slot.ensureCenterCells(0, initCell, releaseCellFn);
		slot.ensureRightCells(0, null, initCell, releaseCellFn);

		// Remove pin containers (no cells → no containers needed)
		this.ensurePinnedContainer(slot, 'left', 0);
		this.ensurePinnedContainer(slot, 'right', 0);

		const rowKey = visualRow.id;
		if (slot.element.dataset.rowKey !== rowKey) {
			this.releaseRowPortal(slot);
			slot.element.dataset.rowKey = rowKey;
		}
		const rowPortalHost = this.ensureRowPortalHost(slot.element);
		rowPortalHost.hidden = false;
		rowPortalHost.dataset.rowKey = rowKey;
		this.portalMountManager.mountRow({ rowKey, container: rowPortalHost, visualRow });
	}

	// ── Full cell binding (non-scroll frame) ─────────────────────────────────────────

	private _bindCellFull(
		cellSlot: CellSlot<TRowData>,
		slotId: string,
		node: RowNode<TRowData>,
		rowIndex: number,
		colIndex: number,
		col: ColumnDef<TRowData>,
		pinLeftColumns: number,
		pinRightColumns: number,
		pinRightStart: number,
		pinRightBaseLeft: number,
		plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>,
		state: GridState<TRowData>,
		_isScrollFrameActive: boolean,
		ctx?: ScrollRenderContext<TRowData>,
		phase: CellRendererPhase = 'initial'
	): void {
		const colCount = plan.displayedColumns.length;
		const access = this.engine.cellAccess.get(node.id, rowIndex, node, node.data, colIndex, col);

		let cellClassName = 'og-cell';
		if (colIndex < pinLeftColumns) {
			cellClassName += ' og-cell-pinned-left';
		} else if (colIndex >= pinRightStart) {
			cellClassName += ' og-cell-pinned-right';
		}
		if (access.isFocused) {
			cellClassName += ' og-cell-focused';
			cellSlot.element.tabIndex = -1;
			cellSlot.hasTabIndex = true;
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
			if (cellSlot.hasTabIndex) {
				cellSlot.element.removeAttribute('tabindex');
				cellSlot.hasTabIndex = false;
			}
		}
		if (access.isSelected) cellClassName += ' og-cell-selected';
		if (access.isLoading) cellClassName += ' og-cell-loading';

		if (state.styleSlots?.cellClass && node.data) {
			try {
				const customCellClass = state.styleSlots.cellClass(col, node.data, {
					row: node.data,
					rowId: node.id,
					rowIndex,
					col,
					colField: col.field,
					colIndex,
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
				if (customCellClass) cellClassName += ' ' + customCellClass;
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

		const isPinRight = colIndex >= pinRightStart;
		const cellLeft = plan.colLefts[colIndex];
		const leftArg = isPinRight ? cellLeft - pinRightBaseLeft : cellLeft;
		const cellWidth = plan.colWidths[colIndex];
		const cellValue = access.value;
		// slotId is the stable RowSlot id (e.g. "rsp-0") passed in by the caller.
		// Using slot.id (not data-row-id or node.id) ensures the portal key is stable
		// across rebinds — the portal manager's warm cache depends on key stability.
		const stableKey = access.isEditing ? createEditRendererKey(node.id, col.field) : createSlotRendererKey(slotId, col.field);

		let contentMode: CellContentMode = 'empty';
		let formattedValue = '';

		if (((col as InternalColumnDef<TRowData>).cellRenderer || access.isEditing) && !access.isLoading) {
			contentMode = 'portal';
			if (cellSlot.element.dataset.cellKey !== stableKey || !this.portalMountManager.isCellMounted(stableKey)) {
				if (cellSlot.element.dataset.cellKey) {
					this.releaseCellPortal(cellSlot.element, false, 'invalidated');
					this.portalMountManager.flushCellReleaseTransaction(true);
				}
				cellSlot.contentElement.textContent = '';
			}
			const portalHost = this.ensureCellPortalHost(cellSlot.element);
			this.cellRenderer.showPortalContent(cellSlot.element);
			this.cancelPendingPortalRelease(stableKey);
			this.portalMountManager.mountCell({
				cellKey: stableKey,
				container: portalHost,
				value: cellValue,
				node,
				col,
				rowIndex,
				colIndex,
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

		cellSlot.update(
			colIndex,
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
			contentMode === 'portal' ? stableKey : undefined
		);

		if (state.styleSlots?.afterCellRender) {
			try {
				state.styleSlots.afterCellRender(access, cellSlot.element);
			} catch (e) {
				console.error('RenderEngine: Error in afterCellRender styleSlot', e);
			}
		}
	}

	// ── Repaint helpers ──────────────────────────────────────────────────────────────

	public repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return;

		const state = this.engine.stateManager.getState();
		const columns = this.engine.columns.getDisplayedColumns();
		const plan = this.engine.columns.getCompiledPlan();
		const w = this.currentWindow;

		const pinLeftColumns = w?.pinLeftCols ?? this.engine.viewport.pinLeftColumns;
		const pinRightColumns = w?.pinRightCols ?? this.engine.viewport.pinRightColumns;
		const colCount = columns.length;
		const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
		const pinRightBaseLeft = plan.pinRightBaseLeft;

		// Repaint rows
		for (const rowId of frame.rows) {
			const rowIndex = rowModel.getVisualIndexByRowId(rowId);
			const slot = rowIndex >= 0 ? this.activeRows.get(rowIndex) : undefined;
			const row = rowIndex >= 0 ? rowModel.getVisualRow(rowIndex) : null;
			if (slot && row?.kind === 'data') {
				this.updateRowClassNameSlot(slot, row.node, rowIndex, state);
			}
		}

		// Repaint specific cells
		for (const [rowId, colFields] of frame.cellsByRowId) {
			const rowIndex = rowModel.getVisualIndexByRowId(rowId);
			if (rowIndex < 0) continue;
			const slot = this.activeRows.get(rowIndex);
			const row = rowModel.getVisualRow(rowIndex);
			if (!slot || row?.kind !== 'data') continue;

			for (const colField of colFields) {
				const colIndex = this.engine.columns.getColumnIndex(colField);
				if (colIndex < 0) continue;
				const cellSlot = slot.getCellForCol(colIndex);
				if (!cellSlot) continue;
				this._bindCellFull(
					cellSlot,
					slot.id,
					row.node,
					rowIndex,
					colIndex,
					columns[colIndex],
					pinLeftColumns,
					pinRightColumns,
					pinRightStart,
					pinRightBaseLeft,
					plan,
					state,
					false,
					undefined,
					'initial'
				);
			}
		}

		// Repaint column changes
		for (const colField of frame.columns) {
			const colIndex = this.engine.columns.getColumnIndex(colField);
			if (colIndex < 0) continue;
			for (const [rowIndex, slot] of this.activeRows) {
				const row = rowModel.getVisualRow(rowIndex);
				if (row?.kind === 'data') {
					const cellSlot = slot.getCellForCol(colIndex);
					if (!cellSlot) continue;
					this._bindCellFull(
						cellSlot,
						slot.id,
						row.node,
						rowIndex,
						colIndex,
						columns[colIndex],
						pinLeftColumns,
						pinRightColumns,
						pinRightStart,
						pinRightBaseLeft,
						plan,
						state,
						false,
						undefined,
						'initial'
					);
				}
			}
		}
	}

	/**
	 * Kept as a public method for external callers (e.g. orchestrator); internally
	 * uses the lane-based _bindCellFull instead of the old Map-based logic.
	 */
	public recycleRowCellsSlot(
		slot: RowSlot<TRowData>,
		node: RowNode<TRowData>,
		rowIndex: number,
		colsEntered: number[],
		colsStayed: number[],
		columns: ColumnDef<TRowData>[],
		isScrollFrameActive: boolean,
		ctx?: ScrollRenderContext<TRowData>,
		_phase: CellRendererPhase = 'initial',
		_rowEntered = false,
		_hoistedState?: GridState<TRowData>,
		_hoistedTotalWidth?: number
	): void {
		const state = _hoistedState ?? this.engine.stateManager.getState();
		const plan = ctx?.plan ?? this.engine.columns.getCompiledPlan();
		const colCount = columns.length;
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
		const pinRightBaseLeft = plan.pinRightBaseLeft;

		const bindOne = (c: number) => {
			const col = columns[c];
			if (!col) return;
			const cellSlot = slot.getCellForCol(c);
			if (!cellSlot) return;
			this._bindCellFull(
				cellSlot,
				slot.id,
				node,
				rowIndex,
				c,
				col,
				pinLeftColumns,
				pinRightColumns,
				pinRightStart,
				pinRightBaseLeft,
				plan,
				state,
				isScrollFrameActive,
				ctx,
				'initial'
			);
		};

		for (const c of colsEntered) bindOne(c);
		for (const c of colsStayed) bindOne(c);
	}

	public recycleLoadingRowCellsSlot(
		slot: RowSlot<TRowData>,
		_visualRow: Extract<VisualRow<TRowData>, { kind: 'loading' }>,
		rowIndex: number,
		colsEntered: number[],
		colsStayed: number[],
		columns: ColumnDef<TRowData>[],
		isScrollFrameActive: boolean,
		ctx?: ScrollRenderContext<TRowData>,
		_rowEntered = false,
		_hoistedState?: GridState<TRowData>,
		_hoistedTotalWidth?: number
	): void {
		const plan = ctx?.plan ?? this.engine.columns.getCompiledPlan();
		const pinRightBaseLeft = plan.pinRightBaseLeft;

		const bindOne = (c: number) => {
			const col = columns[c];
			if (!col) return;
			const cellSlot = slot.getCellForCol(c);
			if (!cellSlot) return;
			if (cellSlot.element.dataset.cellKey) this.releaseCellPortal(cellSlot.element);
			const leftArg = plan.colLefts[c];
			const cellWidth = plan.colWidths[c];
			if (!isScrollFrameActive) {
				this.cellRenderer.ensureLoadingSkeleton(cellSlot.element);
			} else {
				this.markCellDirtyAfterScroll(cellSlot.element);
			}
			cellSlot.update(
				c,
				col.field,
				rowIndex,
				`loading:${rowIndex}`,
				leftArg,
				-1,
				cellWidth,
				'og-cell og-cell-loading',
				'loading',
				undefined,
				'',
				undefined
			);
		};

		for (const c of colsEntered) bindOne(c);
		for (const c of colsStayed) bindOne(c);
	}

	// ── Scroll-path fast cell binding ────────────────────────────────────────────────

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
			cellSlot.hasTabIndex = true;
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

		const cellKey = isEditing ? createEditRendererKey(node.id, col.field) : createSlotRendererKey(pooledRowId, col.field);

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

		// Release any stale portal when transitioning away from portal mode (e.g. the cell
		// was rebound to a different column during horizontal scroll, and the new column
		// has no custom renderer). Without this, cellSlot.update() would clear
		// dataset.cellKey while the portal renderer inside remains mounted, causing
		// renderer.dataset.cellKey ≠ cell.dataset.cellKey in the DOM.
		if (rendererKind !== 'portal' && cellSlot.element.dataset.cellKey) {
			this.releaseCellPortal(cellSlot.element, false, 'invalidated');
		}

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
				// Only call mountCellImmediately if the portal is NOT already live
				// under this exact key. If lastPortalKey === cellKey, the renderer is
				// already mounted and current — calling mountCellImmediately would
				// spuriously increment customRendererMountsDuringScroll.
				const isAlreadyLive = cellSlot.lastPortalKey === cellKey && this.portalMountManager.isCellMounted(cellKey);
				if (!isAlreadyLive) {
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
				}
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
			undefined,
			formattedValue,
			contentMode === 'portal' ? cellKey : undefined
		);
		if (didWrite) this.currentScrollCellsWritten++;
		if (this.renderStats) {
			this.renderStats.cellsBoundDuringScroll = (this.renderStats.cellsBoundDuringScroll || 0) + 1;
		}
	}

	// ── Row class name helper ────────────────────────────────────────────────────────

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

	// ── Misc helpers ─────────────────────────────────────────────────────────────────

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

	public markCellDirtyAfterScroll(cell: HTMLDivElement): void {
		if (!this.dirtyCellsAfterScroll.has(cell)) {
			this.dirtyCellsAfterScroll.add(cell);
			this.dirtyCellsMarkedDuringScroll++;
		}
	}

	// ── Legacy slot release (kept for API compat; not called during steady scroll) ───

	public releaseRowSlot(rowIndex: number, slot: RowSlot<TRowData>, _isScrollFrameActive: boolean): void {
		this.releaseRowPortal(slot);
		const initCell = (el: HTMLDivElement) => this._initCell(el);
		const releaseCellFn = (cell: CellSlot<TRowData>) => this._releaseCellFn(cell);
		slot.ensureLeftCells(0, null, initCell, releaseCellFn);
		slot.ensureCenterCells(0, initCell, releaseCellFn);
		slot.ensureRightCells(0, null, initCell, releaseCellFn);
		slot.destroyCold();
		this.activeRows.delete(rowIndex);
		if (slot.element.parentNode) slot.element.remove();
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

	// ── Post-scroll decoration ────────────────────────────────────────────────────────

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
		const plan = this.engine.columns.getCompiledPlan();
		const w = this.currentWindow;
		const pinLeftColumns = w?.pinLeftCols ?? this.engine.viewport.pinLeftColumns;
		const pinRightColumns = w?.pinRightCols ?? this.engine.viewport.pinRightColumns;
		const colCount = columns.length;
		const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
		const pinRightBaseLeft = plan.pinRightBaseLeft;

		const rowCount = rowModel.getVisualRowCount();
		const colRange = this.engine.viewport.getVisibleColumnRange(colCount);
		const rowRange = this.engine.viewport.getVisibleRowRange(rowCount);
		const rowCenter = (rowRange.startIdx + rowRange.endIdx) / 2;
		const colCenter = (colRange.startIdx + colRange.endIdx) / 2;
		const activeEdit = state.activeEdit;
		const focusedCell = state.selection.focus;

		const getCellPriority = (cell: HTMLDivElement): number => {
			const rowIndexStr = cell.dataset.rowIndex;
			const colField = cell.dataset.colField;
			if (!rowIndexStr || !colField) return 0;
			const rowIndex = Number(rowIndexStr);

			if (activeEdit && cell.dataset.rowId === activeEdit.rowId && colField === activeEdit.colField) return 6;
			if (focusedCell && cell.dataset.rowId === focusedCell.rowId && colField === focusedCell.colField) return 5;

			const colIndex = this.engine.columns.getColumnIndex(colField);
			const isRowVisible = rowIndex >= rowRange.startIdx && rowIndex <= rowRange.endIdx;
			const isColVisible = colIndex >= colRange.startIdx && colIndex <= colRange.endIdx;
			if (!isRowVisible || !isColVisible) return 1;

			const normDist = Math.abs(rowIndex - rowCenter) + Math.abs(colIndex - colCenter);
			return 4 - normDist * 0.01;
		};

		let processed = 0;
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
				if (slot) {
					const cellSlot = slot.getCellForCol(colIndex);
					if (cellSlot && cellSlot.element === cell) {
						this._bindCellFull(
							cellSlot,
							slot.id,
							visualRow.node,
							rowIndex,
							colIndex,
							columns[colIndex],
							pinLeftColumns,
							pinRightColumns,
							pinRightStart,
							pinRightBaseLeft,
							plan,
							state,
							false,
							undefined,
							'scroll-idle'
						);
						this.postScrollDirtyCellsDecorated++;
						processed++;
					}
				}
			} else if (visualRow?.kind === 'loading' && colIndex >= 0) {
				const slot = this.activeRows.get(rowIndex);
				if (slot) {
					const cellSlot = slot.getCellForCol(colIndex);
					if (cellSlot && cellSlot.element === cell) {
						this.cellRenderer.ensureLoadingSkeleton(cell);
						this.postScrollDirtyCellsDecorated++;
						processed++;
					}
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

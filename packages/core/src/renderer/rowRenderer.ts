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
	type GridRowClassParams,
	type GridCellClassParams,
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
import type { SlotRuntimeStats } from './slotRuntimeStats.js';
import { FullWidthRowRenderer } from './fullWidthRowRenderer.js';

/** Build the base CSS class string for a data cell, including pin-zone classes. */
function buildCellPinClass(colIndex: number, pinLeftColumns: number, pinRightStart: number): string {
	if (colIndex < pinLeftColumns) return 'og-cell og-cell-pinned-left';
	if (colIndex >= pinRightStart) return 'og-cell og-cell-pinned-right';
	return 'og-cell';
}

export class RowRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly geometryController: GeometryController<TRowData>;
	/** @internal — public for test access only; treat as private in production code. */
	public readonly portalMountManager: PortalMountManager<TRowData>;
	private readonly cellRenderer: CellRenderer;
	private readonly viewportRenderer: ViewportRenderer<TRowData>;
	/** Phase 7 — Real full-width row renderer (group/detail/footer/loading-fw). */
	private fullWidthRenderer!: FullWidthRowRenderer<TRowData>;

	// ── Stable slot pool ──────────────────────────────────────────────────────────────
	public rowSlotPool!: RowSlotPool<TRowData>;

	/**
	 * Lookup: visualRowIndex → RowSlot.
	 * Derived from slot bindings — rebuilt at the end of every recycleViewport call.
	 * This is NOT the primary lifecycle owner; rowSlotPool is.
	 */
	public activeRows = new Map<number, RowSlot<TRowData>>();
	/** Alias for activeRows — the spec name for the derived lookup map. */
	public get visualIndexToSlot(): Map<number, RowSlot<TRowData>> {
		return this.activeRows;
	}
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
	public slotStats: SlotRuntimeStats = {
		rowSlotCount: 0,
		cellSlotCount: 0,
		rowSlotBindsDuringScroll: 0,
		cellSlotBindsDuringScroll: 0,
		rowDomAppendsDuringScroll: 0,
		rowDomRemovesDuringScroll: 0,
		cellDomAppendsDuringScroll: 0,
		cellDomRemovesDuringScroll: 0,
		sameWindowBailouts: 0,
		fullWidthModeSwitchesDuringScroll: 0,
		customRebindsDuringScroll: 0,
		customWarmMovesDeferredDuringScroll: 0,
		customWarmMovesFlushedAfterScroll: 0,
		customColdMountsDuringScroll: 0,
		// Legacy counters kept for backward compat
		rowSlotAppendsTotal: 0,
		rowSlotRemovesTotal: 0,
		cellAppendsTotal: 0,
		cellRemovesTotal: 0,
		fullRebindFrames: 0,
		enteredOnlyFrames: 0,
	};

	public postScrollDirtyCellsDecorated = 0;

	// Pre-allocated priority buckets for decorateDirtyCellsAfterScroll — zero allocation per scroll idle pass.
	// Bucket layout: [0] active-edit, [1] focused cell, [2] visible range, [3] off-screen / unknown.
	private readonly _dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]] = [[], [], [], []];

	// Pre-allocated scratch objects for styleSlot callbacks — mutated in place before each call
	// to eliminate per-cell object literal allocation during decoration passes.
	private readonly _rowClassScratch: GridRowClassParams<TRowData> = {
		row: null as unknown as TRowData,
		rowId: '',
		rowIndex: 0,
		isFocused: false,
		isSelected: false,
		isLoading: false,
		selection: null as unknown,
	} as GridRowClassParams<TRowData>;
	private readonly _cellClassScratch: GridCellClassParams<TRowData> = {
		row: null as unknown as TRowData,
		rowId: '',
		rowIndex: 0,
		col: null as unknown as ColumnDef<TRowData>,
		colField: '',
		colIndex: 0,
		isFocused: false,
		isRowFocused: false,
		isRowSelected: false,
		isSelected: false,
		isEditing: false,
		value: undefined,
		rawValue: undefined,
		isLoading: false,
		selection: null as unknown,
	} as GridCellClassParams<TRowData>;

	private rowPortalHosts = new WeakMap<HTMLElement, HTMLElement>();

	// Pre-allocated scratch for stable-slot assignment — reused per recycleViewport call
	// to avoid 4 per-frame allocations (result array, newWindowSet, assignedRows, freeSlots).
	private _ssResult: number[] = [];
	private _ssNewWindowSet = new Set<number>();
	private _ssAssignedRows = new Set<number>();
	private _ssFreeSlots: number[] = [];

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
		this.fullWidthRenderer = new FullWidthRowRenderer<TRowData>(this.portalMountManager, this.rowPortalHosts);
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
		// Release portals for all slots, then destroy the pool.
		for (const slot of this.rowSlotPool?.getSlots() ?? []) {
			this.releaseRowPortal(slot);
			slot.forEachCell((cell) => {
				if (cell.lastPortalKey) this.releaseCellPortal(cell.element, false, 'destroyed');
			});
		}
		this.rowSlotPool?.destroy();
		// Re-create pool and fullWidthRenderer (mount might not be re-called).
		if (this.viewportRenderer.rowsContainer) {
			this.rowSlotPool = new RowSlotPool<TRowData>(this.viewportRenderer.rowsContainer);
		}
		if (!this.fullWidthRenderer) {
			this.fullWidthRenderer = new FullWidthRowRenderer<TRowData>(this.portalMountManager, this.rowPortalHosts);
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

	// ── Slot-based viewport virtualization core ─────────────────────────────────────
	//
	// Architecture (from spec Phase 2-3):
	//   rowSlots[i] always represents viewport position i.
	//   slot[0] → allRows[0], slot[1] → allRows[1], ...
	//   When the render window shifts, slots rebind to new visual rows.
	//   The slot DOM element never moves; only the binding changes.
	//   activeRows (visualIndexToSlot) is rebuilt from slot bindings after each frame.

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

		// ── Same-window bailout ───────────────────────────────────────────────────────
		// If everything is unchanged (rowStart, rowEnd, colStart, colEnd, scroll geometry),
		// skip all row slot binding, cell slot binding, and custom renderer work.
		if (isScrollFrameActive && sameRenderedWindow(this.currentWindow, nextWindow)) {
			this.slotStats.sameWindowBailouts++;
			return;
		}

		// Compute delta — needed for column layout change detection and stats.
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

		// ── Slot count management ─────────────────────────────────────────────────────
		// Stable slot assignment: rows that are still in the window keep their current
		// slot (isRowRebind = false), preserving their custom-live portals in place.
		// Only entering/exiting rows use recycled slots (isRowRebind = true).
		const sortedRows = getRowIndices(nextWindow);
		const totalSlots = sortedRows.length;
		// Inline stable-slot assignment using pre-allocated scratch — avoids 4 per-frame allocations.
		const allRows = this._computeStableSlotRowsInline(sortedRows);

		this.rowSlotPool.resetScrollStats();

		// Pre-evacuate portals for slots being destroyed (only runs when pool shrinks).
		const prevSlotCount = this.rowSlotPool.count;
		if (prevSlotCount > totalSlots) {
			for (let i = totalSlots; i < prevSlotCount; i++) {
				const slot = this.rowSlotPool.getSlot(i);
				if (!slot) continue;
				this.releaseRowPortal(slot);
				slot.forEachCell((cell) => {
					if (cell.lastPortalKey) {
						this.releaseCellPortal(cell.element, undefined, 'scrolled-out');
						cell.lastPortalKey = undefined;
						delete cell.element.dataset['cellKey'];
					}
				});
			}
		}

		this.rowSlotPool.ensureSlotCount(totalSlots, isScrollFrameActive);

		if (isScrollFrameActive) {
			this.slotStats.rowSlotAppendsTotal += this.rowSlotPool.slotAppendCount;
			this.slotStats.rowSlotRemovesTotal += this.rowSlotPool.slotRemoveCount;
		}

		// ── Column layout constants ───────────────────────────────────────────────────
		const pinLeftColumns = nextWindow.pinLeftCols;
		const pinRightColumns = nextWindow.pinRightCols;
		const colCount = columns.length;
		const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
		const centerColStart = nextWindow.colStart;
		const centerColEnd = nextWindow.colEnd;
		const centerColCount = Math.max(0, centerColEnd - centerColStart + 1);

		// Column layout change detection — used for full vs partial cell rebind.
		const columnLayoutChanged = delta.colsEntered.length > 0 || delta.colsExited.length > 0;

		if (isScrollFrameActive) {
			if (columnLayoutChanged) this.slotStats.fullRebindFrames++;
			else this.slotStats.enteredOnlyFrames++;
		}

		// Hoisted loop-invariant constants — read once before the slot loop, not per row.
		const hoistedTotalHeight = nextWindow.pinBottomRows > 0 ? this.engine.geometry.getTotalHeight(state.defaultRowHeight) : 0;
		const pinTopRows = nextWindow.pinTopRows;
		const pinBottomRows = nextWindow.pinBottomRows;
		const scrollTop = this.engine.viewport.scrollTop;
		const viewportHeight = this.engine.viewport.viewportHeight;
		const rowTops = this.engine.geometry.rowTops;
		const rowHeights = this.engine.geometry.rowHeights;

		// Build O(1) sticky-group lookup. stickyGroupIndices.indexOf(r) is O(K) per row;
		// with a Map it becomes one property read per row regardless of group count.
		const stickyGroupMap: Map<number, number> | null =
			nextWindow.stickyGroupIndices && nextWindow.stickyGroupTops
				? new Map(nextWindow.stickyGroupIndices.map((idx, i) => [idx, nextWindow.stickyGroupTops![i]!]))
				: null;

		// ── Slot binding loop ─────────────────────────────────────────────────────────
		// Each slot[i] binds to allRows[i]. Stable-slot assignment keeps staying rows
		// in their current slots (isRowRebind=false) and recycles exiting-row slots
		// for entering rows (isRowRebind=true).
		//   slot DOM element never moves.
		//   slot.visualIndex tracks which visual row is currently bound.
		//   When isRowRebind=true the row portal is released before the new row binds.
		for (let slotIdx = 0; slotIdx < allRows.length; slotIdx++) {
			const r = allRows[slotIdx];
			const slot = this.rowSlotPool.getSlot(slotIdx);
			if (!slot) continue;

			if (isScrollFrameActive) this.currentScrollRowsVisited++;

			// Detect slot rebind — slot is transitioning to a different visual row.
			const isRowRebind = slot.visualIndex >= 0 && slot.visualIndex !== r;
			if (isRowRebind) {
				// Release the row portal only (for full-width rows: group/detail/footer content).
				// Cell portals are intentionally NOT pre-evacuated here. Releasing all portals
				// for every rebinding slot would flood the warm cache (size-bounded) with O(allSlots)
				// entries simultaneously, causing warm cache evictions and cold remounts. Instead,
				// each cell's binding code handles its own portal lifecycle: stable slots (same key)
				// are updated in-place via rebindInstance; new slots mount immediately with full content.
				this.releaseRowPortal(slot);
				if (isScrollFrameActive) this.currentScrollRowsRecycled++;
			}

			let visualRow = rowModel ? rowModel.getVisualRow(r) : null;
			if (!visualRow && loading) {
				visualRow = { kind: 'loading', id: `loading:${r}`, rowIndex: r };
			}
			if (!visualRow) {
				slot.unbindHot();
				continue;
			}

			// ── Position calculation ──────────────────────────────────────────────────
			let rowTop = rowTops[r];
			const rowHeight = rowHeights[r];

			let isStickyGroup = false;
			if (r < pinTopRows) {
				rowTop = rowTop + scrollTop;
			} else if (r >= nextWindow.rowCount - pinBottomRows) {
				const bottomOffset = hoistedTotalHeight - rowTops[r];
				rowTop = scrollTop + viewportHeight - bottomOffset;
			} else if (stickyGroupMap) {
				const stickyTop = stickyGroupMap.get(r);
				if (stickyTop !== undefined) {
					rowTop = stickyTop;
					isStickyGroup = true;
				}
			}

			// ── Row class name ────────────────────────────────────────────────────────
			let rowClassName = ROW_KIND_BASE[visualRow.kind] ?? 'og-row';
			if (isStickyGroup) rowClassName += ' og-row-group-sticky';
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
						const rs = this._rowClassScratch;
						rs.row = node.data;
						rs.rowId = node.id;
						rs.rowIndex = r;
						rs.isFocused = isFocusedRow;
						rs.isSelected = isSelectedRow || isFocusedRow;
						rs.isLoading = isLoadingRow;
						rs.selection = state.selection;
						const customRowClass = state.styleSlots.rowClass(node.data, rs);
						if (customRowClass) rowClassName += ' ' + customRowClass;
					} catch (e) {
						console.error('RenderEngine: Error in rowClass styleSlot', e);
					}
				}
			}

			const rowUpdated = slot.update(r, visualRow.id, visualRow.kind as any, rowTop, rowHeight, rowClassName);
			if (isScrollFrameActive && rowUpdated) this.currentScrollRowsRebound++;

			// ── Bind cells based on row kind ──────────────────────────────────────────
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
					isRowRebind,
					delta.colsEntered,
					delta.colsExited
				);
			} else {
				// Full-width row (group / detail / footer)
				this._bindFullWidthRow(slot, visualRow, columns);
			}
		}

		// ── Rebuild visualIndexToSlot (activeRows) ────────────────────────────────────
		// activeRows is derived from slot bindings, not the primary lifecycle owner.
		// Rebuilt here so external callers (repaint, decoration, API) can look up slots.
		this.activeRows.clear();
		for (const slot of this.rowSlotPool.getSlots()) {
			if (slot.visualIndex >= 0) {
				this.activeRows.set(slot.visualIndex, slot);
			}
		}

		this.currentWindow = nextWindow;
	}

	// ── Phase 5+6: Lane cell binding helpers ─────────────────────────────────────────

	// Arrow properties so these can be passed directly as callbacks without wrapping
	// in a new closure on every row bind — the hot path calls these once per lane per row.
	private readonly _initCell = (el: HTMLDivElement): void => {
		this.cellRenderer.initializeCell(el);
	};
	private readonly _releaseCellFn = (cell: CellSlot<TRowData>): void => {
		if (cell.lastPortalKey) this.releaseCellPortal(cell.element, false, 'destroyed');
		cell.unbindCold();
	};

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
		isRowRebind: boolean,
		colsEntered: readonly number[] = [],
		colsExited: readonly number[] = []
	): void {
		const pinLeftWidth = plan.pinLeftWidth;
		const pinRightBaseLeft = plan.pinRightBaseLeft;
		const pinRightWidth = plan.pinRightWidth;
		const colCount = columns.length;

		// Hoist per-row loading check — same result for every cell in the row.
		const isRowLoading = ctx ? ctx.loadingVersion > 0 && this.engine.data.isRowLoading(node.id) : false;

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

		const initCell = this._initCell;
		const releaseCellFn = this._releaseCellFn;

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
					pinLeftColumns,
					pinRightStart,
					ctx!,
					slot.id,
					leftArg,
					-1,
					cellWidth,
					isRowRebind,
					isRowLoading
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

			// Identity-stable skip: if the slot's visual row did not change (isRowRebind=false)
			// and this cell already holds the correct column, its DOM content is still valid.
			// With the stable-slot assignment, staying rows have isRowRebind=false, so this
			// skip fires during pure vertical scroll for rows that didn't enter or exit.
			if (isScrollFrameActive && !isRowRebind && cellSlot.colIndex === c) {
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
					pinLeftColumns,
					pinRightStart,
					ctx!,
					slot.id,
					leftArg,
					-1,
					cellWidth,
					isRowRebind,
					isRowLoading
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
					pinLeftColumns,
					pinRightStart,
					ctx!,
					slot.id,
					leftArg,
					-1,
					cellWidth,
					isRowRebind,
					isRowLoading
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

		const initCell = this._initCell;
		const releaseCellFn = this._releaseCellFn;

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
	 * Phase 7: Full-width row (group / detail / footer).
	 * Delegates to FullWidthRowRenderer which owns the row portal host lifecycle.
	 * Collapses cell lanes before mounting the full-width portal.
	 */
	private _bindFullWidthRow(slot: RowSlot<TRowData>, visualRow: VisualRow<TRowData>, _columns: ColumnDef<TRowData>[]): void {
		this.fullWidthRenderer.bind(
			slot,
			visualRow,
			(s) => {
				// Collapse all lanes — cell portals released via releaseCellFn
				s.ensureLeftCells(0, null, this._initCell, this._releaseCellFn);
				s.ensureCenterCells(0, this._initCell, this._releaseCellFn);
				s.ensureRightCells(0, null, this._initCell, this._releaseCellFn);
				this.ensurePinnedContainer(s, 'left', 0);
				this.ensurePinnedContainer(s, 'right', 0);
			},
			(s) => this.releaseRowPortal(s)
		);
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
		const access = this.engine.cellAccess.get(node.id, rowIndex, node, node.data, colIndex, col, undefined, state);

		let cellClassName = buildCellPinClass(colIndex, pinLeftColumns, pinRightStart);
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
				const s = this._cellClassScratch;
				s.row = node.data;
				s.rowId = node.id;
				s.rowIndex = rowIndex;
				s.col = col;
				s.colField = col.field;
				s.colIndex = colIndex;
				s.isFocused = access.isFocused;
				s.isRowFocused = access.isRowFocused;
				s.isRowSelected = access.isRowSelected || access.isRowFocused;
				s.isSelected = access.isSelected;
				s.isEditing = access.isEditing;
				s.value = access.value;
				s.rawValue = access.rawValue;
				s.isLoading = access.isLoading;
				s.selection = state.selection;
				const customCellClass = state.styleSlots.cellClass(col, node.data, s);
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
				rowSlotId: slotId,
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
		pinLeftColumns: number,
		pinRightStart: number,
		ctx: ScrollRenderContext<TRowData>,
		pooledRowId: string,
		left: number,
		right: number,
		width: number,
		isRowRebind: boolean,
		isRowLoading: boolean
	): void {
		const plan = ctx.plan.columnPlans[colIndex];
		const isEditing = !!(ctx.activeEdit && ctx.activeEdit.rowId === node.id && ctx.activeEdit.colField === col.field);

		const rendererKind: 'primitive' | 'portal' | 'loading' = isRowLoading ? 'loading' : isEditing || plan?.isCustom ? 'portal' : 'primitive';

		let cellClassName = buildCellPinClass(colIndex, pinLeftColumns, pinRightStart);
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

		let contentMode: CellContentMode = 'empty';
		let formattedValue = '';

		if (rendererKind === 'loading') {
			contentMode = 'loading';
		} else if (rendererKind !== 'portal') {
			// Primitive fast path — no cellKey allocation needed.
			const cachedVal = this.engine.data.getCachedDisplayValue(node.id, col.field);
			if (cachedVal !== undefined) {
				formattedValue = cachedVal;
				contentMode = formattedValue === '' ? 'empty' : 'text';
			} else {
				formattedValue = '...';
				contentMode = 'text';
				this.markCellDirtyAfterScroll(cellSlot.element);
			}
			// Release any stale portal from a column that previously had a custom renderer.
			if (cellSlot.element.dataset.cellKey) {
				this.releaseCellPortal(cellSlot.element, false, 'invalidated');
			}
			const didWritePrimitive = cellSlot.update(
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
				undefined
			);
			if (didWritePrimitive) this.currentScrollCellsWritten++;
			if (this.renderStats) {
				this.renderStats.cellsBoundDuringScroll = (this.renderStats.cellsBoundDuringScroll || 0) + 1;
			}
			return;
		} else {
			contentMode = 'portal';
		}

		// Portal path — compute cellKey only when needed.
		const cellKey = isEditing ? createEditRendererKey(node.id, col.field) : createSlotRendererKey(pooledRowId, col.field);

		const scrollMode = plan?.mode;
		const isFocused = ctx.focusedCell?.rowId === node.id && ctx.focusedCell?.colField === col.field;
		const isMounted = this.portalMountManager.isCellMounted(cellKey);

		// Two freeze variants keep React work off the hot scroll path:
		//   isPortalFrozen: slot stayed on the same row — portal is fully current.
		//   isStaleFrozen:  slot moved to a new row (isRowRebind) but the slot-keyed portal
		//                   is already mounted — keep showing stale content during scroll
		//                   (no blank flash) and schedule a post-scroll full rebind.
		// Only 'custom-live' same-row portals bypass the freeze to push fresh data each frame.
		const canFreezePortal = cellSlot.lastPortalKey === cellKey && isMounted;
		const isPortalFrozen = !isRowRebind && canFreezePortal;
		const isStaleFrozen = isRowRebind && canFreezePortal;

		if (isPortalFrozen || isStaleFrozen) {
			// Keep the existing portal visible — no React work this scroll frame.
			this.cellRenderer.showPortalContent(cellSlot.element);
			this.cancelPendingPortalRelease(cellKey);
			contentMode = 'portal';

			if (isPortalFrozen && scrollMode === 'custom-live') {
				// Live same-row portal: push fresh data on every scroll frame.
				// mountCellImmediately tries imperativeUpdate first (zero React cost if supported).
				const portalHost = this.ensureCellPortalHost(cellSlot.element);
				this.portalMountManager.mountCellImmediately({
					cellKey,
					container: portalHost,
					value: this.getScrollMountValue(node, col, cellSlot),
					node,
					col,
					rowIndex,
					colIndex,
					rowSlotId: pooledRowId,
					isEditing,
					isLoading: false,
					phase: 'scroll',
					isScrolling: false,
					isFocused,
					isSelected: false,
				});
				cellSlot.lastMountedDataVersion = ctx.dataVersion;
			} else {
				// Stale (row rebind) or non-live same-row: defer to post-scroll decoration pass.
				this.markCellDirtyAfterScroll(cellSlot.element);
			}
		} else {
			// New key (column renderer changed) or first-ever mount for this slot.
			// Release the old portal if it had a different key.
			if (cellSlot.lastPortalKey && cellSlot.lastPortalKey !== cellKey) {
				// Use undefined (not false) so the release is deferred during scroll,
				// and 'scrolled-out' so it goes to the warm cache (not destroyed).
				this.releaseCellPortal(cellSlot.element, undefined, 'scrolled-out');
			}
			const portalHost = this.ensureCellPortalHost(cellSlot.element);
			this.portalMountManager.mountCellImmediately({
				cellKey,
				container: portalHost,
				value: this.getScrollMountValue(node, col, cellSlot),
				node,
				col,
				rowIndex,
				colIndex,
				rowSlotId: pooledRowId,
				isEditing,
				isLoading: isRowLoading,
				phase: 'scroll',
				isScrolling: false,
				isFocused,
				isSelected: false,
			});
			contentMode = 'portal';
			cellSlot.lastMountedDataVersion = ctx.dataVersion;
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
				const rs = this._rowClassScratch;
				rs.row = node.data;
				rs.rowId = node.id;
				rs.rowIndex = rowIndex;
				rs.isFocused = isFocusedRow;
				rs.isSelected = isSelectedRow || isFocusedRow;
				rs.isLoading = isLoadingRow;
				rs.selection = state.selection;
				const customRowClass = state.styleSlots.rowClass(node.data, rs);
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

	// ── Stable slot assignment (inlined, scratch-reusing) ───────────────────────────────

	/**
	 * Assign new-window rows to existing slot indices without allocating.
	 * Pre-allocated scratch (result array, sets, free-slot list) are cleared and reused.
	 *
	 * Pass 1: slots whose current row is still in the new window stay in place.
	 * Pass 2: entering rows fill freed slots in window order.
	 */
	private _computeStableSlotRowsInline(newWindowRows: readonly number[]): number[] {
		const n = newWindowRows.length;

		// Resize result array in place when the window grows.
		const result = this._ssResult;
		if (result.length < n) {
			result.length = n;
		}

		// Populate the new-window set (cleared from last call).
		const newWindowSet = this._ssNewWindowSet;
		newWindowSet.clear();
		for (let i = 0; i < n; i++) newWindowSet.add(newWindowRows[i]);

		const assignedRows = this._ssAssignedRows;
		assignedRows.clear();

		const freeSlots = this._ssFreeSlots;
		freeSlots.length = 0;

		const slotCount = Math.min(this.rowSlotPool.count, n);
		for (let i = 0; i < slotCount; i++) {
			const slot = this.rowSlotPool.getSlot(i);
			const vi = slot ? slot.visualIndex : -1;
			if (vi >= 0 && newWindowSet.has(vi)) {
				result[i] = vi;
				assignedRows.add(vi);
			} else {
				result[i] = -1;
				freeSlots.push(i);
			}
		}
		for (let i = slotCount; i < n; i++) {
			result[i] = -1;
			freeSlots.push(i);
		}

		let freeIdx = 0;
		for (let i = 0; i < n; i++) {
			const row = newWindowRows[i];
			if (!assignedRows.has(row)) {
				result[freeSlots[freeIdx++]] = row;
			}
		}

		return result;
	}

	// ── Legacy slot release (kept for API compat; not called during steady scroll) ───

	public releaseRowSlot(rowIndex: number, slot: RowSlot<TRowData>, _isScrollFrameActive: boolean): void {
		this.releaseRowPortal(slot);
		const initCell = this._initCell;
		const releaseCellFn = this._releaseCellFn;
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
		// Delegate to FullWidthRowRenderer which owns the portal host lifecycle.
		// Falls back to direct cleanup if fullWidthRenderer not yet initialized (clearActiveRows on unmount).
		if (this.fullWidthRenderer) {
			return this.fullWidthRenderer.release(slot);
		}
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

		// Classify dirty cells into priority buckets — O(N) with zero per-cell allocation.
		// Buckets: [0] active edit, [1] focused, [2] visible range, [3] off-screen/unknown.
		const b0 = this._dirtyBuckets[0];
		b0.length = 0;
		const b1 = this._dirtyBuckets[1];
		b1.length = 0;
		const b2 = this._dirtyBuckets[2];
		b2.length = 0;
		const b3 = this._dirtyBuckets[3];
		b3.length = 0;
		for (const cell of this.dirtyCellsAfterScroll) {
			const p = getCellPriority(cell);
			if (p >= 6) b0.push(cell);
			else if (p >= 5) b1.push(cell);
			else if (p > 1) b2.push(cell);
			else b3.push(cell);
		}

		let processed = 0;
		for (let bi = 0; bi < 4 && processed < maxCells; bi++) {
			const bucket = this._dirtyBuckets[bi];
			for (let i = 0; i < bucket.length; i++) {
				if (processed >= maxCells) break;
				const cell = bucket[i];
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

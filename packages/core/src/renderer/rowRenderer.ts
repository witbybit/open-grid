import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { CellRenderer } from './cellRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import { SelectionPaintManager } from './selectionPaintManager.js';
import {
	type CellRendererPhase,
	type ColumnDef,
	type InternalColumnDef,
	type VisualRow,
	type GridState,
	type RowNode,
	type GridCellPointer,
	type GridCellClassParams,
} from '../store.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { GridCellContentUnmount } from './IGridRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import { RowSlot } from './rowSlot.js';
import { RowSlotPool } from './rowSlotPool.js';
import { CellSlot, type CellContentMode } from './cellSlot.js';
import { StableSlotAssigner } from './stableSlotAssigner.js';
import { reportRendererFault } from './rendererFaults.js';
import {
	decorateDirtyCellsAfterScroll as decorateDirtyCellsAfterScrollMaintenance,
	repaintInvalidatedRowsAndCells as repaintInvalidatedRowsAndCellsMaintenance,
	type RowCellBindRequest,
} from './rowRenderMaintenance.js';

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
	createEmptyViewportDelta,
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
	/** Forwarded to SelectionPaintManager — renderEngine.ts accesses this directly. */
	public get hoveredRowIndex(): number | null {
		return this.selectionPaint.hoveredRowIndex;
	}
	public set hoveredRowIndex(v: number | null) {
		this.selectionPaint.hoveredRowIndex = v;
	}
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
		rowSlotAppendsTotal: 0,
		rowSlotRemovesTotal: 0,
		fullRebindFrames: 0,
		enteredOnlyFrames: 0,
	};

	public postScrollDirtyCellsDecorated = 0;

	// Pre-allocated priority buckets for decorateDirtyCellsAfterScroll — zero allocation per scroll idle pass.
	// Bucket layout: [0] active-edit, [1] focused cell, [2] visible range, [3] off-screen / unknown.
	private readonly _dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]] = [[], [], [], []];
	// Reusable scratch for getRowIndices() — avoids an O(visibleRows) array per frame.
	private readonly _rowIndicesScratch: number[] = [];
	// Reusable scratch for diffRenderWindow() — avoids six array allocations per frame.
	private readonly _deltaScratch = createEmptyViewportDelta();

	// Pre-allocated scratch object for cell styleSlot callbacks — mutated in place before each call
	// to eliminate per-cell object literal allocation during decoration passes.
	// Row class scratch is owned by SelectionPaintManager.
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

	/** Manages row selection paint state, row class building, and row click handling. */
	public readonly selectionPaint: SelectionPaintManager<TRowData>;

	// Stable slot assigner — single implementation shared with tests.
	// Internal scratch buffers are reused per call: zero per-frame allocations.
	private readonly _slotAssigner = new StableSlotAssigner();
	// Pre-allocated scratch for extracting current visual indices from the slot pool.
	private _currentSlotRowsScratch: number[] = [];

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
		this.selectionPaint = new SelectionPaintManager<TRowData>(engine);
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
		this.selectionPaint.rebuildSelection(state.selectedRowIds);
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
		// Uses the reusable scratch delta (valid until the next recycleViewport call).
		const delta = diffRenderWindow(this.currentWindow, nextWindow, this._deltaScratch);

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
		const sortedRows = getRowIndices(nextWindow, this._rowIndicesScratch);
		const totalSlots = sortedRows.length;

		// Extract current visual indices from the slot pool into pre-allocated scratch,
		// then run stable-slot assignment through the single shared implementation.
		const poolCount = this.rowSlotPool.count;
		this._currentSlotRowsScratch.length = poolCount;
		for (let i = 0; i < poolCount; i++) {
			const slot = this.rowSlotPool.getSlot(i);
			this._currentSlotRowsScratch[i] = slot ? slot.visualIndex : -1;
		}
		const allRows = this._slotAssigner.assign(this._currentSlotRowsScratch, sortedRows);

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

		const hasRowClassHook = !!state.styleSlots?.rowClass;

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

			// Resolve the visual row early — needed for identity-based rebind check.
			let visualRow = rowModel ? rowModel.getVisualRow(r) : null;
			if (!visualRow && loading) {
				visualRow = { kind: 'loading', id: `loading:${r}`, rowIndex: r };
			}
			if (!visualRow) {
				slot.unbindHot();
				continue;
			}

			// Detect slot rebind — slot is transitioning to a different visual row.
			// Check both position index AND row identity: a slot that stays at the same
			// visual index but now holds a different row (e.g. a detail row collapses and
			// the row below slides up to fill its position) must still release its portal.
			const isRowRebind = slot.visualIndex >= 0 && (slot.visualIndex !== r || slot.lastVisualRowId !== visualRow.id);

			// ── Staying-row cheap path ───────────────────────────────────────────────
			// During a scroll frame, a slot that keeps its visual row and whose column
			// layout did not change needs only a position refresh: its class, cells and
			// portals are all still valid (cells would all hit the identity-stable skip
			// below anyway). Data/selection/hover changes are gated during scroll and
			// repainted post-scroll, so nothing here can go stale. Excluded: loading
			// rows (kind may flip when a block lands).
			if (
				isScrollFrameActive &&
				!isRowRebind &&
				!columnLayoutChanged &&
				slot.visualIndex === r &&
				slot.rowKind !== '' &&
				slot.rowKind !== 'loading'
			) {
				let top: number;
				if (r < pinTopRows) {
					top = rowTops[r] + scrollTop;
				} else if (r >= nextWindow.rowCount - pinBottomRows) {
					top = scrollTop + viewportHeight - (hoistedTotalHeight - rowTops[r]);
				} else {
					top = rowTops[r];
				}
				slot.updatePosition(top);
				if (hasRowClassHook && slot.rowKind === 'data') {
					this.dirtyRowsAfterScroll.add(r);
				}
				continue;
			}

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

			// ── Position calculation ──────────────────────────────────────────────────
			let rowTop = rowTops[r];
			const rowHeight = rowHeights[r];

			if (r < pinTopRows) {
				rowTop = rowTop + scrollTop;
			} else if (r >= nextWindow.rowCount - pinBottomRows) {
				const bottomOffset = hoistedTotalHeight - rowTops[r];
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
						reportRendererFault(this.engine, 'group-row-class', e, { rowId: visualRow.id, rowIndex: r });
					}
				}
			} else if (visualRow.kind === 'detail') {
				if (state.styleSlots?.detailRowClass) {
					try {
						const customClass = state.styleSlots.detailRowClass(visualRow);
						if (customClass) rowClassName += ' ' + customClass;
					} catch (e) {
						reportRendererFault(this.engine, 'detail-row-class', e, { rowId: visualRow.id, rowIndex: r });
					}
				}
			} else if (visualRow.kind === 'data') {
				const node = visualRow.node;
				const isFocusedRow = state.selection.focus?.rowId === node.id;
				const isSelectedRow = !!state.selection.bounds && r >= state.selection.bounds.minRow && r <= state.selection.bounds.maxRow;
				const isLoadingRow = this.engine.data.isRowLoading(node.id);

				if (r < pinTopRows) rowClassName += ' og-row-pinned-top';
				else if (r >= nextWindow.rowCount - pinBottomRows) rowClassName += ' og-row-pinned-bottom';

				if (this.selectionPaint.hoveredRowIndex === r) rowClassName += ' og-row-hovered';
				if (isSelectedRow || isFocusedRow) rowClassName += ' og-row-selected';
				if (isFocusedRow) rowClassName += ' og-row-focused';
				if (this.selectionPaint.selectedRowIdSet?.has(node.id)) rowClassName += ' og-row-node-selected';
				if (isLoadingRow) rowClassName += ' og-row-loading';

				if (isScrollFrameActive && state.styleSlots?.rowClass && node.data) {
					this.dirtyRowsAfterScroll.add(r);
				} else if (state.styleSlots?.rowClass && node.data) {
					try {
						const rs = this.selectionPaint.rowClassScratchRef;
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
						reportRendererFault(this.engine, 'row-class', e, { rowId: node.id, rowIndex: r });
					}
				}
			}

			const rowUpdated = slot.update(r, visualRow.id, visualRow.kind as any, rowTop, rowHeight, rowClassName);
			if (slot.element.style.zIndex !== '') slot.element.style.zIndex = '';
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
		this.selectionPaint.attachClickListenerIfNeeded(el);
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
		// Note: right container horizontal position is now handled by CSS sticky
		// (position:sticky; right:0; margin-left:auto in a flex row) — no JS needed.

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
		//
		// Identity-stable skip (mirrors centre cells): pinned-left columns are always
		// at the same visual positions regardless of horizontal scroll. If this row
		// is staying (isRowRebind=false) and the cell's existing column assignment
		// already matches slot i, the DOM content is still valid — skip entirely.
		for (let i = 0; i < pinLeftColumns; i++) {
			const col = columns[i];
			if (!col) continue;
			const cellSlot = slot.leftCells[i];
			if (!cellSlot) continue;

			if (isScrollFrameActive && !isRowRebind && cellSlot.colIndex === i) {
				continue;
			}

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
		//
		// Identity-stable skip (mirrors centre cells): pinned-right columns are
		// always at fixed positions. If the row is staying and the cell's column
		// assignment already matches column c, the DOM is still valid — skip it.
		for (let i = 0; i < pinRightColumns; i++) {
			const c = pinRightStart + i;
			if (c >= colCount) continue;
			const col = columns[c];
			if (!col) continue;
			const cellSlot = slot.rightCells[i];
			if (!cellSlot) continue;

			if (isScrollFrameActive && !isRowRebind && cellSlot.colIndex === c) {
				continue;
			}

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
		// Note: right container's horizontal position is now handled by CSS sticky
		// (position:sticky; right:0; margin-left:auto in a flex row) — no JS needed.

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
				reportRendererFault(this.engine, 'cell-class', e, { rowId: node.id, rowIndex, colField: col.field, colIndex });
			}
		}

		if (state.styleSlots?.beforeCellRender) {
			try {
				state.styleSlots.beforeCellRender(access, cellSlot.element);
			} catch (e) {
				reportRendererFault(this.engine, 'before-cell-render', e, { rowId: node.id, rowIndex, colField: col.field, colIndex });
			}
		}

		const isPinRight = colIndex >= pinRightStart;
		const cellLeft = plan.colLefts[colIndex];
		const leftArg = isPinRight ? cellLeft - pinRightBaseLeft : cellLeft;
		const cellWidth = plan.colWidths[colIndex];

		// Checkbox selection column: render a checkbox instead of normal cell content.
		// Uses 'custom' contentMode so cellSlot.update() positions the cell without clearing the checkbox DOM.
		if (col.checkboxSelection) {
			const cell = cellSlot.contentElement;
			const rowId = node.id;
			const isChecked = (this.selectionPaint.selectedRowIdSet ?? new Set(state.selectedRowIds)).has(rowId);
			cellClassName += ' og-cell-row-selector';
			let checkbox = cell.querySelector<HTMLInputElement>('input[type="checkbox"].og-row-checkbox');
			if (!checkbox) {
				checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.className = 'og-row-checkbox';
				checkbox.addEventListener('click', (e) => {
					e.stopPropagation();
					const input = e.currentTarget as HTMLInputElement;
					const id = input.dataset.rowId;
					if (!id) return;
					const shouldSelect = input.checked;
					if ((e as MouseEvent).shiftKey && this.selectionPaint.rowCheckboxAnchorId) {
						const rangeIds = this.selectionPaint.getDataRowIdsBetween(this.selectionPaint.rowCheckboxAnchorId, id);
						if (rangeIds.length > 0) {
							if (shouldSelect) this.engine.selectRowIds(rangeIds, 'checkbox');
							else this.engine.deselectRowIds(rangeIds, 'checkbox');
						}
					} else {
						this.engine.toggleRowId(id, 'checkbox');
					}
					this.selectionPaint.rowCheckboxAnchorId = id;
				});
				cell.textContent = '';
				cell.appendChild(checkbox);
			}
			checkbox.dataset.rowId = rowId;
			checkbox.setAttribute('aria-label', isChecked ? `Deselect row ${rowIndex + 1}` : `Select row ${rowIndex + 1}`);
			checkbox.title = 'Select row. Shift-click selects a range.';
			if (checkbox.checked !== isChecked) checkbox.checked = isChecked;
			cellSlot.update(colIndex, col.field, rowIndex, node.id, leftArg, -1, cellWidth, cellClassName, 'custom', undefined, '', undefined);
			return;
		}
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
					// No per-cell sync flush here: inside a release transaction the release is
					// batched and flushed once at endCellReleaseTransaction; outside one it
					// executes immediately. Either way a per-cell flushSync React commit is
					// never needed — keyed portals reconcile old-out/new-in within one commit.
					this.releaseCellPortal(cellSlot.element, false, 'invalidated');
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
				reportRendererFault(this.engine, 'after-cell-render', e, { rowId: node.id, rowIndex, colField: col.field, colIndex });
			}
		}
	}

	// ── Repaint helpers ──────────────────────────────────────────────────────────────

	public repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		repaintInvalidatedRowsAndCellsMaintenance(this.getMaintenanceDeps(), frame);
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
		// Checkbox column: defer full render to the post-scroll decoration pass so the
		// checkbox DOM is never overwritten by the primitive fast-path text writer.
		if (col.checkboxSelection) {
			this.markCellDirtyAfterScroll(cellSlot.element);
			let cellClassName = buildCellPinClass(colIndex, pinLeftColumns, pinRightStart) + ' og-cell-row-selector';
			cellSlot.update(colIndex, col.field, rowIndex, node.id, left, right, width, cellClassName, 'custom', undefined, '', undefined);
			return;
		}

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
		// Data-stale checks use two independent versions:
		//   globalVersion: bumped on sort/filter/group/row-add-remove → all portals thaw
		//   rowVersions[rowId]: bumped only when that row's data changed → only that row thaws
		const globalChanged = cellSlot.lastMountedGlobalVersion !== -1 && ctx.globalVersion !== cellSlot.lastMountedGlobalVersion;
		const rowChanged =
			cellSlot.lastMountedRowVersion !== -1 &&
			ctx.rowVersions.get(node.id) !== undefined &&
			ctx.rowVersions.get(node.id) !== cellSlot.lastMountedRowVersion;
		const isDataStale = !isRowRebind && canFreezePortal && (globalChanged || rowChanged);
		const isPortalFrozen = !isRowRebind && canFreezePortal && !isDataStale;
		const isStaleFrozen = (isRowRebind || isDataStale) && canFreezePortal;

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
				cellSlot.lastMountedRowVersion = ctx.rowVersions.get(node.id) ?? -1;
				cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
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
			cellSlot.lastMountedRowVersion = ctx.rowVersions.get(node.id) ?? -1;
			cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
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

	public releaseCellPortal(
		cell: HTMLDivElement,
		forceDeferred?: boolean,
		reason: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated' = 'scrolled-out'
	): void {
		// Use CellSlot.binding as the authoritative identity source; fall back to dataset
		// for elements not yet fully migrated (e.g. full-width row slots).
		const cellSlot = CellSlot.fromElement(cell);
		const cellKey = cellSlot.binding?.cellKey ?? cell.dataset.cellKey;
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
		return decorateDirtyCellsAfterScrollMaintenance(this.getMaintenanceDeps(), options);
	}

	private bindCellFullFromRequest(request: RowCellBindRequest<TRowData>): void {
		this._bindCellFull(
			request.cellSlot as CellSlot<TRowData>,
			request.slotId,
			request.node,
			request.rowIndex,
			request.colIndex,
			request.col,
			request.pinLeftColumns,
			request.pinRightColumns,
			request.pinRightStart,
			request.pinRightBaseLeft,
			request.plan,
			request.state,
			request.isScrollFrameActive,
			request.ctx,
			request.phase
		);
	}

	private getMaintenanceDeps() {
		return {
			engine: this.engine,
			selectionPaint: this.selectionPaint,
			cellRenderer: this.cellRenderer,
			activeRows: this.activeRows,
			getCurrentWindow: () => this.currentWindow,
			dirtyCellsAfterScroll: this.dirtyCellsAfterScroll,
			dirtyRowsAfterScroll: this.dirtyRowsAfterScroll,
			dirtyBuckets: this._dirtyBuckets,
			incrementPostScrollDirtyCellsDecorated: () => {
				this.postScrollDirtyCellsDecorated++;
			},
			bindCellFull: (request: RowCellBindRequest<TRowData>) => this.bindCellFullFromRequest(request),
		};
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

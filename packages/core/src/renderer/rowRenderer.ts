import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { CellRenderer } from './cellRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import { SelectionPaintManager } from './selectionPaintManager.js';
import { type ColumnDef, type VisualRow, type GridState, type RowNode, type GridCellPointer, type GridCellClassParams } from '../store.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { GridCellContentUnmount } from './IGridRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import { RowSlot } from './rowSlot.js';
import { RowSlotPool } from './rowSlotPool.js';
import { CellSlot } from './cellSlot.js';
import { StableSlotAssigner } from './stableSlotAssigner.js';
import { reportRendererFault } from './rendererFaults.js';
import {
	createRowRendererRuntimeArgs,
	bindAllDataCellsRuntime,
	bindAllLoadingCellsRuntime,
	bindFullWidthRow,
	decorateDirtyCellsAfterScroll as decorateDirtyCellsAfterScrollRuntime,
	repaintInvalidatedRowsAndCells as repaintInvalidatedRowsAndCellsRuntime,
	type RowRendererRuntimeHost,
} from './rowRendererRuntime.js';

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
import type { SlotRuntimeStats } from './slotRuntimeStats.js';
import { FullWidthRowRenderer } from './fullWidthRowRenderer.js';

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
				bindAllLoadingCellsRuntime(createRowRendererRuntimeArgs(this as unknown as RowRendererRuntimeHost<TRowData>), {
					slot,
					rowIndex: r,
					pinLeftColumns,
					pinRightColumns,
					pinRightStart,
					centerColStart,
					centerColCount,
					columns,
					plan,
					isScrollFrameActive,
				});
			} else if (visualRow.kind === 'data') {
				this.releaseRowPortal(slot);
				bindAllDataCellsRuntime(createRowRendererRuntimeArgs(this as unknown as RowRendererRuntimeHost<TRowData>), {
					slot,
					node: visualRow.node,
					rowIndex: r,
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
				});
			} else {
				// Full-width row (group / detail / footer)
				bindFullWidthRow(createRowRendererRuntimeArgs(this as unknown as RowRendererRuntimeHost<TRowData>), slot, visualRow);
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
	public readonly initCell = (el: HTMLDivElement): void => {
		this.cellRenderer.initializeCell(el);
		this.selectionPaint.attachClickListenerIfNeeded(el);
	};
	public readonly releaseCellFn = (cell: CellSlot<TRowData>): void => {
		if (cell.lastPortalKey) this.releaseCellPortal(cell.element, false, 'destroyed');
		cell.unbindCold();
	};

	public get cellClassScratch(): GridCellClassParams<TRowData> {
		return this._cellClassScratch;
	}

	public get dirtyBuckets(): [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]] {
		return this._dirtyBuckets;
	}

	public get viewportContainer(): HTMLElement | null | undefined {
		return this.viewportRenderer.container;
	}

	public get fullWidthRendererRef(): FullWidthRowRenderer<TRowData> {
		return this.fullWidthRenderer;
	}

	public readonly clearProgrammaticScrollCell = (): void => {
		this.programmaticScrollCell = null;
	};

	public readonly setDeferredFocusCell = (cell: HTMLDivElement): void => {
		this.deferredFocusCell = cell;
	};

	public readonly incrementStyleHookCallsDuringScroll = (): void => {
		if (this.renderStats) this.renderStats.styleHookCallsDuringScroll++;
	};

	public readonly incrementCellsBoundDuringScroll = (): void => {
		if (this.renderStats) this.renderStats.cellsBoundDuringScroll = (this.renderStats.cellsBoundDuringScroll || 0) + 1;
	};

	public readonly incrementCurrentScrollCellsVisited = (): void => {
		this.currentScrollCellsVisited++;
	};

	public readonly incrementCurrentScrollCellsPatched = (): void => {
		this.currentScrollCellsPatched++;
	};

	public readonly incrementCurrentScrollCellsWritten = (): void => {
		this.currentScrollCellsWritten++;
	};

	public readonly incrementPostScrollDirtyCellsDecorated = (): void => {
		this.postScrollDirtyCellsDecorated++;
	};

	// ── Repaint helpers ──────────────────────────────────────────────────────────────

	public repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		repaintInvalidatedRowsAndCellsRuntime(createRowRendererRuntimeArgs(this as unknown as RowRendererRuntimeHost<TRowData>), frame);
	}

	// ── Misc helpers ─────────────────────────────────────────────────────────────────

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
		return decorateDirtyCellsAfterScrollRuntime(createRowRendererRuntimeArgs(this as unknown as RowRendererRuntimeHost<TRowData>), options);
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

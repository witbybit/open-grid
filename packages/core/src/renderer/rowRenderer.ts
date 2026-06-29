import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { CellRenderer } from './cellRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import { SelectionPaintManager } from './selectionPaintManager.js';
import { type ColumnDef, type GridCellClassParams } from '../columnDef.js';
import type { VisualRow } from '../visualRow.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RowNode } from '../rowNode.js';
import type { GridCellPointer } from '../api/GridApi.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { GridCellContentUnmount } from './IGridRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import { RowSlot } from './rowSlot.js';
import { RowSlotPool } from './rowSlotPool.js';
import { reportRendererFault } from './rendererFaults.js';
import { RowRendererRuntimeBridge } from './rowRendererRuntime.js';
import { asVisibleBlockLoadCapableRowModel } from '../rowModel.js';
import { compileStyleRules, evaluateDetailRowStyleRules, evaluateGroupRowStyleRules, evaluateRowStyleRules } from '../styling/styleRules.js';
import { PinnedContainerManager } from './pinnedContainerManager.js';
import { compileColumnTopology, type CompiledColumnTopology } from './columnTopology.js';

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
	sameVisibleContentWindow,
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
	/** Full-width row renderer (group/detail/footer/loading-fw). */
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
	public get cellClassScratch(): GridCellClassParams<TRowData> {
		return this._cellClassScratch;
	}
	public get dirtyBuckets(): [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]] {
		return this._dirtyBuckets;
	}
	public currentWindow: RenderWindow | null = null;

	public dirtyCellsAfterScroll = new Set<HTMLDivElement>();
	public dirtyRowsAfterScroll = new Set<number>();

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
	public runtimeState!: import('./renderRuntimeState.js').RenderRuntimeState;
	public dirtyCellsMarkedDuringScroll = 0;

	// Stable-slot virtualization counters — reset per scroll frame by renderScrollCoordinator.
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
	private getVisibleBlockLoadCapableRowModel() {
		return asVisibleBlockLoadCapableRowModel(this.engine.getRowModel());
	}

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
	private readonly runtime: RowRendererRuntimeBridge<TRowData>;
	private readonly pinnedContainers = new PinnedContainerManager<TRowData>();
	private cachedColumnTopology: CompiledColumnTopology | null = null;
	private cachedColumnTopologyVersion = -1;
	/** Live column-reorder preview source, wired by RenderEngine to the
	 *  ColumnInteractionController. Returns 0 outside an active header drag. */
	public columnShiftSource: ((colIndex: number) => number) | null = null;

	/** Manages row selection paint state, row class building, and row click handling. */
	public readonly selectionPaint: SelectionPaintManager<TRowData>;

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
		this.runtime = new RowRendererRuntimeBridge<TRowData>({
			engine: this.engine,
			cellRenderer: this.cellRenderer,
			portalMountManager: this.portalMountManager,
			getViewportContainer: () => this.viewportRenderer.container,
			selectionPaint: this.selectionPaint,
			getFullWidthRenderer: () => this.fullWidthRenderer,
			stateHost: this,
			initCell: (el) => {
				this.cellRenderer.initializeCell(el);
				this.selectionPaint.attachClickListenerIfNeeded(el);
			},
			releaseCellFn: (cell) => {
				if (cell.lastPortalKey) this.runtime.releaseCellPortal(cell.element, false, 'destroyed');
				cell.unbindCold();
			},
			ensurePinnedContainer: (slot, side, width) => this.ensurePinnedContainer(slot, side, width),
			releaseRowPortal: (slot) => this.releaseRowPortal(slot),
			getColumnShift: (colIndex) => (this.columnShiftSource ? this.columnShiftSource(colIndex) : 0),
		});
	}

	public mount(_estRows: number): void {
		this.rowSlotPool = new RowSlotPool<TRowData>(this.viewportRenderer.rowsContainer!);
		this.fullWidthRenderer = new FullWidthRowRenderer<TRowData>(this.portalMountManager, this.rowPortalHosts);
	}

	public unmount(): void {
		this.clearActiveRows();
		this.dirtyCellsAfterScroll.clear();
		this.dirtyRowsAfterScroll.clear();
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
				if (cell.lastPortalKey) this.runtime.releaseCellPortal(cell.element, false, 'destroyed');
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
		return this.pinnedContainers.ensure(slot, side, width);
	}

	private rotateViewportSlots(nextWindow: RenderWindow): void {
		const previous = this.currentWindow;
		if (!previous) return;
		if (
			previous.pinTopRows !== nextWindow.pinTopRows ||
			previous.pinBottomRows !== nextWindow.pinBottomRows ||
			previous.rowCount !== nextWindow.rowCount
		) {
			return;
		}

		const previousCenterCount = Math.max(0, previous.rowEnd - previous.rowStart + 1);
		const nextCenterCount = Math.max(0, nextWindow.rowEnd - nextWindow.rowStart + 1);
		if (previousCenterCount !== nextCenterCount || previousCenterCount <= 1) {
			return;
		}

		const delta = nextWindow.rowStart - previous.rowStart;
		if (delta === 0 || Math.abs(delta) >= previousCenterCount) {
			return;
		}

		const topCount = nextWindow.pinTopRows;
		const normalizedRotation = delta > 0 ? delta : previousCenterCount + delta;
		const result = this.rowSlotPool.rotateRange(topCount, previousCenterCount, normalizedRotation);
		if (this.renderStats) {
			this.renderStats.rowSlotMoves += result.moved;
		}
	}

	private getCompiledColumnTopology(plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>): CompiledColumnTopology {
		if (this.cachedColumnTopology && this.cachedColumnTopologyVersion === plan.version) {
			return this.cachedColumnTopology;
		}
		const topology = compileColumnTopology(plan);
		this.cachedColumnTopology = topology;
		this.cachedColumnTopologyVersion = plan.version;
		return topology;
	}

	private getRenderedRowTop(
		rowIndex: number,
		rowTops: ArrayLike<number>,
		scrollTop: number,
		pinTopRows: number,
		rowCount: number,
		pinBottomRows: number,
		viewportHeight: number,
		totalHeight: number
	): number {
		if (rowIndex < pinTopRows) {
			return rowTops[rowIndex] + scrollTop;
		}
		if (rowIndex >= rowCount - pinBottomRows) {
			return scrollTop + viewportHeight - (totalHeight - rowTops[rowIndex]);
		}
		return rowTops[rowIndex];
	}

	// ── Slot-based viewport virtualization core ─────────────────────────────────────
	//
	// Row slot contract:
	//   rowSlots[i] always represents viewport position i.
	//   slot[0] → allRows[0], slot[1] → allRows[1], ...
	//   When the render window shifts, slots rebind to new visual rows.
	//   The slot DOM element never moves; only the binding changes.
	//   activeRows (visualIndexToSlot) is maintained incrementally during recycleViewport.

	public recycleViewport(isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow): void {
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
		if (isScrollFrameActive && sameRenderedWindow(this.currentWindow, nextWindow) && sameVisibleContentWindow(this.currentWindow, nextWindow)) {
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

		// Load visible blocks if server row model (server-specific, not in VisualRowModel)
		const fullRowModel = this.getVisibleBlockLoadCapableRowModel();
		if (fullRowModel) {
			fullRowModel.loadVisibleBlocks(nextWindow.rowStart, nextWindow.rowEnd);
		}
		// Renderer-facing visual row access uses the stable VisualRowModel contract.
		const rowModel = this.engine.getVisualRowModel();

		const plan = ctx?.plan ?? this.engine.columns.getCompiledPlan();
		const columnTopology = this.getCompiledColumnTopology(plan);
		const columns = plan.displayedColumns;
		const loading = ctx ? ctx.loadingVersion > 0 : state.loading;

		// ── Slot count management ─────────────────────────────────────────────────────
		const sortedRows = getRowIndices(nextWindow, this._rowIndicesScratch);
		const totalSlots = sortedRows.length;

		this.rowSlotPool.resetScrollStats();

		// Pre-evacuate portals for slots being destroyed (only runs when pool shrinks).
		const prevSlotCount = this.rowSlotPool.count;
		if (prevSlotCount > totalSlots) {
			for (let i = totalSlots; i < prevSlotCount; i++) {
				const slot = this.rowSlotPool.getSlot(i);
				if (!slot) continue;
				// Incremental index: remove excess slots before they are destroyed.
				if (slot.visualIndex >= 0) this.activeRows.delete(slot.visualIndex);
				this.releaseRowPortal(slot);
				slot.forEachCell((cell) => {
					if (cell.lastPortalKey) {
						this.runtime.releaseCellPortal(cell.element, undefined, 'scrolled-out');
						cell.lastPortalKey = undefined;
						delete cell.element.dataset['cellKey'];
					}
				});
			}
		}

		this.rowSlotPool.ensureSlotCount(totalSlots, isScrollFrameActive);
		this.rotateViewportSlots(nextWindow);
		const allRows = sortedRows;
		if (this.renderStats) {
			this.renderStats.rowSlotAssigns += allRows.length;
		}

		if (isScrollFrameActive) {
			this.slotStats.rowSlotAppendsTotal += this.rowSlotPool.slotAppendCount;
			this.slotStats.rowSlotRemovesTotal += this.rowSlotPool.slotRemoveCount;
		}

		// ── Column layout constants ───────────────────────────────────────────────────
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
		const prevVisibleRowStart = this.currentWindow?.visibleRowStart ?? -1;
		const prevVisibleRowEnd = this.currentWindow?.visibleRowEnd ?? -1;
		const prevVisibleColStart = this.currentWindow?.visibleColStart ?? -1;
		const prevVisibleColEnd = this.currentWindow?.visibleColEnd ?? -1;
		const nextVisibleRowStart = nextWindow.visibleRowStart ?? nextWindow.rowStart;
		const nextVisibleRowEnd = nextWindow.visibleRowEnd ?? nextWindow.rowEnd;
		const nextVisibleColStart = nextWindow.visibleColStart ?? nextWindow.colStart;
		const nextVisibleColEnd = nextWindow.visibleColEnd ?? nextWindow.colEnd;
		const visibleColumnsChanged = prevVisibleColStart !== nextVisibleColStart || prevVisibleColEnd !== nextVisibleColEnd;
		const refreshVisibleColumns =
			isScrollFrameActive && visibleColumnsChanged
				? new Set(delta.colsEntered.filter((c) => c >= nextVisibleColStart && c <= nextVisibleColEnd))
				: null;
		const canTrustStableIdentity =
			!!this.currentWindow &&
			(this.currentWindow.rowModelVersion ?? 0) === (nextWindow.rowModelVersion ?? 0) &&
			(this.currentWindow.columnVersion ?? 0) === (nextWindow.columnVersion ?? 0);

		const compiledStyleRules = compileStyleRules(state.styleRules);
		const hasRowClassHook = compiledStyleRules.hasRowRules;

		// ── Slot binding loop ─────────────────────────────────────────────────────────
		// Each slot[i] binds to allRows[i], where slot index is the viewport-position contract.
		// Contiguous scrolling rotates the center slice ahead of time so staying rows keep their
		// physical slot and only true entered/exited rows rebind.
		for (let slotIdx = 0; slotIdx < allRows.length; slotIdx++) {
			const r = allRows[slotIdx];
			const slot = this.rowSlotPool.getSlot(slotIdx);
			if (!slot) continue;

			if (isScrollFrameActive) this.currentScrollRowsVisited++;

			const isPinnedVisibleRow = r < pinTopRows || r >= nextWindow.rowCount - pinBottomRows;
			const isRowVisible = isPinnedVisibleRow || (r >= nextVisibleRowStart && r <= nextVisibleRowEnd);
			const wasPinnedVisibleRow =
				r < pinTopRows || (this.currentWindow ? r >= this.currentWindow.rowCount - this.currentWindow.pinBottomRows : false);
			const wasRowVisible = wasPinnedVisibleRow || (r >= prevVisibleRowStart && r <= prevVisibleRowEnd);
			// A row crossing the visible-content band should not force a cell refresh during
			// active vertical scroll if the row identity and column window stayed stable.
			// Warm slots already retain their text/portal/custom content; post-scroll repaint
			// will reconcile deferred styling and selection state.
			const rowNeedsContentRefresh = isScrollFrameActive && isRowVisible && !!refreshVisibleColumns && refreshVisibleColumns.size > 0;

			if (
				isScrollFrameActive &&
				canTrustStableIdentity &&
				(!columnLayoutChanged || !isRowVisible) &&
				!rowNeedsContentRefresh &&
				slot.visualIndex === r &&
				slot.rowKind !== '' &&
				slot.rowKind !== 'loading'
			) {
				const top = this.getRenderedRowTop(
					r,
					rowTops,
					scrollTop,
					pinTopRows,
					nextWindow.rowCount,
					pinBottomRows,
					viewportHeight,
					hoistedTotalHeight
				);
				slot.updatePosition(top);
				if (hasRowClassHook && slot.rowKind === 'data') {
					this.dirtyRowsAfterScroll.add(r);
				}
				continue;
			}

			// Resolve the visual row early — needed for identity-based rebind check.
			let visualRow = rowModel ? rowModel.getVisualRow(r) : null;
			if (!visualRow && loading) {
				visualRow = { kind: 'loading', id: `loading:${r}`, rowIndex: r };
			}
			if (!visualRow) {
				const prevUnbind = slot.visualIndex;
				this.releaseRowPortal(slot);
				slot.unbindHot();
				if (prevUnbind >= 0) this.activeRows.delete(prevUnbind);
				continue;
			}

			// Detect slot rebind — slot is transitioning to a different visual row.
			// Check both position index AND row identity: a slot that stays at the same
			// visual index but now holds a different row (e.g. a detail row collapses and
			// the row below slides up to fill its position) must still release its portal.
			const isRowRebind = slot.visualIndex >= 0 && (slot.visualIndex !== r || slot.lastVisualRowId !== visualRow.id);
			if (isRowRebind && this.renderStats) {
				this.renderStats.rowSlotRebinds++;
			}

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
				(!columnLayoutChanged || !isRowVisible) &&
				!rowNeedsContentRefresh &&
				slot.visualIndex === r &&
				slot.rowKind !== '' &&
				slot.rowKind !== 'loading'
			) {
				const top = this.getRenderedRowTop(
					r,
					rowTops,
					scrollTop,
					pinTopRows,
					nextWindow.rowCount,
					pinBottomRows,
					viewportHeight,
					hoistedTotalHeight
				);
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

			rowTop = this.getRenderedRowTop(
				r,
				rowTops,
				scrollTop,
				pinTopRows,
				nextWindow.rowCount,
				pinBottomRows,
				viewportHeight,
				hoistedTotalHeight
			);

			// ── Row class name ────────────────────────────────────────────────────────
			let rowClassName = ROW_KIND_BASE[visualRow.kind] ?? 'og-row';
			if (visualRow.kind === 'group') {
				if (compiledStyleRules.hasGroupRowRules) {
					try {
						const customClass = evaluateGroupRowStyleRules(compiledStyleRules, visualRow);
						if (customClass) rowClassName += ' ' + customClass;
					} catch (e) {
						reportRendererFault(this.engine, 'group-row-class', e, { rowId: visualRow.id, rowIndex: r });
					}
				}
			} else if (visualRow.kind === 'detail') {
				if (compiledStyleRules.hasDetailRowRules) {
					try {
						const customClass = evaluateDetailRowStyleRules(compiledStyleRules, visualRow);
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

				if (isScrollFrameActive && compiledStyleRules.hasRowRules && node.data) {
					this.dirtyRowsAfterScroll.add(r);
				} else if (compiledStyleRules.hasRowRules && node.data) {
					try {
						const rs = this.selectionPaint.rowClassScratchRef;
						rs.row = node.data;
						rs.rowId = node.id;
						rs.rowIndex = r;
						rs.isFocused = isFocusedRow;
						rs.isSelected = isSelectedRow || isFocusedRow;
						rs.isLoading = isLoadingRow;
						rs.selection = state.selection;
						const customRowClass = evaluateRowStyleRules(compiledStyleRules, node.data, rs);
						if (customRowClass) rowClassName += ' ' + customRowClass;
					} catch (e) {
						reportRendererFault(this.engine, 'row-class', e, { rowId: node.id, rowIndex: r });
					}
				}
			}

			const prevSlotIdx = slot.visualIndex;
			const rowUpdated = slot.update(r, visualRow.id, visualRow.kind as any, rowTop, rowHeight, rowClassName);
			// Incremental index: update map only when the binding changes.
			if (prevSlotIdx !== r) {
				if (prevSlotIdx >= 0) this.activeRows.delete(prevSlotIdx);
				this.activeRows.set(r, slot);
			}
			if (slot.element.style.zIndex !== '') slot.element.style.zIndex = '';
			if (isScrollFrameActive && rowUpdated) this.currentScrollRowsRebound++;

			// ── Bind cells based on row kind ──────────────────────────────────────────
			if (visualRow.kind === 'loading') {
				this.releaseRowPortal(slot);
				this.runtime.bindAllLoadingCells({
					slot,
					rowIndex: r,
					centerColStart,
					centerColCount,
					columns,
					plan,
					columnTopology,
					isScrollFrameActive,
				});
			} else if (visualRow.kind === 'data') {
				this.releaseRowPortal(slot);
				this.runtime.bindAllDataCells({
					slot,
					node: visualRow.node,
					rowIndex: r,
					centerColStart,
					centerColCount,
					columns,
					plan,
					columnTopology,
					isScrollFrameActive,
					ctx,
					state,
					isRowRebind,
					forceCellRefresh: false,
					isRowVisible,
					refreshVisibleColumns,
				});
			} else {
				// Full-width row (group / detail / footer)
				this.runtime.bindFullWidthRow(slot, visualRow);
			}
		}

		this.activeRows.clear();
		for (const slot of this.rowSlotPool.getSlots()) {
			if (slot.visualIndex >= 0) {
				this.activeRows.set(slot.visualIndex, slot);
			}
		}

		this.currentWindow = nextWindow;
	}

	// ── Lane cell binding helpers ────────────────────────────────────────────────────

	// Arrow properties so these can be passed directly as callbacks without wrapping
	// in a new closure on every row bind — the hot path calls these once per lane per row.
	// ── Repaint helpers ──────────────────────────────────────────────────────────────

	public repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		this.runtime.repaintInvalidatedRowsAndCells(frame);
	}

	// ── Misc helpers ─────────────────────────────────────────────────────────────────

	private releaseRowPortal(slot: RowSlot<TRowData>): boolean {
		// Delegate to FullWidthRowRenderer which owns the portal host lifecycle.
		// Falls back to direct cleanup if fullWidthRenderer not yet initialized (clearActiveRows on unmount).
		if (this.fullWidthRenderer) {
			return this.fullWidthRenderer.release(slot);
		}
		const rowKey = slot.lastPortalRowKey;
		if (!rowKey) return false;
		const host = this.rowPortalHosts.get(slot.element);
		if (!host) {
			slot.lastPortalRowKey = undefined;
			delete slot.element.dataset.rowKey;
			return false;
		}
		this.portalMountManager.releaseRow({ rowKey, container: host });
		host.hidden = true;
		delete host.dataset.rowKey;
		host.remove();
		slot.lastPortalRowKey = undefined;
		delete slot.element.dataset.rowKey;
		return true;
	}

	// ── Post-scroll decoration ────────────────────────────────────────────────────────

	public decorateDirtyCellsAfterScroll(options?: { maxCells?: number }): { remaining: number; processed: number } {
		return this.runtime.decorateDirtyCellsAfterScroll(options);
	}

	public applyFocus(cell: HTMLDivElement): void {
		this.runtime.applyFocus(cell);
	}
}

import type { RenderColumn, RendererEngineView } from './RendererEngineView.js';
import { RowBinder } from './RowBinder.js';
import { computeRenderLayout } from './RenderLayout.js';
import type { VisualRow } from '../pipeline/VisualRow.js';
import type { RowId } from '../rows/RowId.js';
import { CORE_STYLES } from '../../renderer/styles.js';
import { LayerRegistry } from './LayerRegistry.js';
import { compileColumnTopology } from './ColumnTopologyCompiler.js';
import type { CompiledColumnTopology } from './ColumnTopologyCompiler.js';
import { GeometryController } from './GeometryController.js';
import { RenderScrollCoordinator } from './RenderScrollCoordinator.js';
import { ScrollEngine } from './ScrollEngine.js';
import { FrameCoordinator, defaultGridScheduler } from './GridScheduler.js';
import type { GridScheduler } from './GridScheduler.js';

const STYLE_TAG_ATTR = 'data-og-core-styles';

/** Inject CORE_STYLES once per document; subsequent calls are no-ops. */
function injectCoreStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.querySelector(`[${STYLE_TAG_ATTR}]`)) return;
	const tag = document.createElement('style');
	tag.setAttribute(STYLE_TAG_ATTR, '1');
	tag.textContent = CORE_STYLES;
	document.head.appendChild(tag);
}

// ---------------------------------------------------------------------------
// Public callback interfaces (kept stable for React adapter compatibility)
// ---------------------------------------------------------------------------

/**
 * Callbacks wired by the React adapter for portal-based custom cell renderers.
 * The renderer fires these when a cell slot binds or unbinds, letting React mount
 * a portal into the provided container element.
 */
export interface CellContentMount<TRow> {
	readonly cellKey: string;
	readonly container: HTMLElement;
	readonly rowId: RowId | null;
	readonly field: string;
	readonly row: VisualRow<TRow>;
	readonly column: RenderColumn;
}

export interface CellContentUnmount {
	readonly cellKey: string;
}

export interface DomGridRendererCallbacks<TRow> {
	onMountCellContent?: (mount: CellContentMount<TRow>) => void;
	onUnmountCellContent?: (unmount: CellContentUnmount) => void;
}

// ---------------------------------------------------------------------------
// Internal row slot state
// ---------------------------------------------------------------------------

/** One DOM row slot and its current binding metadata. */
interface RowSlotState {
	el: HTMLDivElement;
	/** Last-painted visual row index (-1 if slot was just created/unused). */
	visualRowIndex: number;
	/** The rowId last bound to this slot — used to detect recycle events. */
	lastRowId: RowId | null;
	/** Monotonically increasing generation: incremented when rowId changes. */
	generation: number;
	/** Child cell elements indexed by column field, for incremental updates. */
	cellsByField: Map<string, HTMLDivElement>;
	/** Mounted cell keys (for unmount callbacks on recycle). */
	mountedCellKeys: Set<string>;
	pinLeft: HTMLDivElement | null;
	pinRight: HTMLDivElement | null;
	/** Last row kind rendered in this slot — used to detect kind transitions and clear stale content. */
	lastKind: VisualRow['kind'] | null;
}

// ---------------------------------------------------------------------------
// Header cell tracking
// ---------------------------------------------------------------------------

interface HeaderCellState {
	el: HTMLDivElement;
	field: string;
	lastSortDirection: 'asc' | 'desc' | null | undefined;
	lastWidth: number;
	lastLeft: number;
}

// ---------------------------------------------------------------------------
// Resize drag state
// ---------------------------------------------------------------------------

interface ResizeDragState {
	field: string;
	startX: number;
	startWidth: number;
}

// ---------------------------------------------------------------------------
// DomGridRenderer
// ---------------------------------------------------------------------------

/**
 * Pure-DOM renderer that reads from {@link RendererEngineView} and paints the `.og-*` layer
 * structure (ARCHITECTURE.md §3 R12–R13). Uses the new infrastructure components:
 * - {@link LayerRegistry} for DOM structure
 * - {@link ColumnTopologyCompiler} for column layout (compiled once per column version)
 * - {@link GeometryController} for row positioning
 * - {@link RenderScrollCoordinator} to track the visible window
 * - {@link ScrollEngine} for scroll handling
 * - {@link FrameCoordinator} / {@link GridScheduler} for RAF scheduling
 */
export class DomGridRenderer<TRow> {
	private readonly rowBinder = new RowBinder<TRow>();
	private slots: RowSlotState[] = [];

	// Infrastructure
	private layerRegistry: LayerRegistry | null = null;
	private scrollEngine: ScrollEngine | null = null;
	private frameCoordinator: FrameCoordinator;
	private readonly scrollCoordinator = new RenderScrollCoordinator({ rowOverscanPx: 200, colBuffer: 2 });
	private readonly geometryController = new GeometryController();

	// Column topology (compiled once per column version, reused across frames)
	private compiledTopology: CompiledColumnTopology | null = null;
	private lastCompiledColVersion = -1;

	// Header cell map: field → stable {el, state} (cells are relocated not recreated on pin/reorder)
	private headerCells = new Map<string, HeaderCellState>();

	// Lifecycle
	private unsubscribe: (() => void) | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private container: HTMLElement | null = null;

	// Viewport state (updated by scroll / resize; forwarded to engine view)
	private vpWidth = 0;
	private vpHeight = 0;
	private scrollTop = 0;
	private scrollLeft = 0;

	// Callbacks
	private sortCallback: ((field: string, currentDir: 'asc' | 'desc' | null) => void) | null = null;
	private resizeCallback: ((field: string, newWidth: number) => void) | null = null;
	private groupToggleCallback: ((groupKey: string) => void) | null = null;
	private treeToggleCallback: ((rowId: string) => void) | null = null;
	private detailToggleCallback: ((rowId: string) => void) | null = null;
	private floatingFilterChangeCallback: ((field: string, value: string, operator: string) => void) | null = null;
	private filterChipRemoveCallback: ((columnId: string) => void) | null = null;
	private groupPanelRemoveCallback: ((columnId: string) => void) | null = null;
	private resizeDragState: ResizeDragState | null = null;

	// Floating filter input map: field → input element
	private floatingFilterInputs = new Map<string, HTMLInputElement>();

	// Selection overlay
	private selectionOverlay: HTMLDivElement | null = null;

	constructor(
		private readonly view: RendererEngineView<TRow>,
		private readonly callbacks: DomGridRendererCallbacks<TRow> = {},
		private readonly scheduler: GridScheduler = defaultGridScheduler,
	) {
		this.frameCoordinator = new FrameCoordinator({ scheduler: this.scheduler });

		this.frameCoordinator
			.onScrollFrame(() => this.handleScrollFrame())
			.onPaintFrame(() => this.paint())
			.onScrollEnd(() => this.frameCoordinator.schedulePaintFrame());
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	mount(container: HTMLElement): void {
		injectCoreStyles();
		this.container = container;

		// Build DOM layer structure via LayerRegistry
		this.layerRegistry = new LayerRegistry(container);

		// Wire ScrollEngine to the scroll viewport
		const sv = this.layerRegistry.layers.scrollViewport;
		this.scrollEngine = new ScrollEngine(sv, {
			onScroll: (state) => {
				this.scrollTop = state.scrollTop;
				this.scrollLeft = state.scrollLeft;
				this.view.setScroll(state.scrollTop, state.scrollLeft);
				this.frameCoordinator.scheduleScrollFrame();
			},
			onScrollEnd: () => {
				this.frameCoordinator.schedulePaintFrame();
			},
		});

		// Subscribe to engine changes
		this.unsubscribe = this.view.subscribe(() => {
			this.frameCoordinator.schedulePaintFrame();
		});

		// ResizeObserver for container size changes
		this.resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			this.vpWidth = width;
			this.vpHeight = height;
			this.view.setSize(width, height);
			this.frameCoordinator.schedulePaintFrame();
		});
		this.resizeObserver.observe(container);

		// Prime viewport with current dimensions
		const rect = container.getBoundingClientRect();
		this.vpWidth = rect.width || 800;
		this.vpHeight = rect.height || 500;
		this.view.setSize(this.vpWidth, this.vpHeight);

		// Initial paint
		this.paint();
	}

	unmount(): void {
		this.frameCoordinator.destroy();

		this.unsubscribe?.();
		this.unsubscribe = null;

		this.resizeObserver?.disconnect();
		this.resizeObserver = null;

		this.scrollEngine?.destroy();
		this.scrollEngine = null;

		// Unmount portal callbacks for all mounted cells
		this.fireUnmountForAllSlots();

		this.layerRegistry?.destroy();
		this.layerRegistry = null;

		this.slots = [];
		this.headerCells.clear();
		this.floatingFilterInputs.clear();
		this.rowBinder.reset();
		this.compiledTopology = null;
		this.lastCompiledColVersion = -1;
		this.container = null;
		this.selectionOverlay = null;
		this.resizeDragState = null;
	}

	/** Wire a sort handler called when the user clicks a sortable column header. */
	setSortCallback(fn: (field: string, currentDir: 'asc' | 'desc' | null) => void): void {
		this.sortCallback = fn;
	}

	/** Wire a resize handler called when the user finishes resizing a column header. */
	setResizeCallback(fn: (field: string, newWidth: number) => void): void {
		this.resizeCallback = fn;
	}

	/** Wire a handler called when the user clicks to expand/collapse a group row. */
	setGroupToggleCallback(fn: (groupKey: string) => void): void {
		this.groupToggleCallback = fn;
	}

	/** Wire a handler called when the user clicks to expand/collapse a tree node. */
	setTreeToggleCallback(fn: (rowId: string) => void): void {
		this.treeToggleCallback = fn;
	}

	/** Wire a handler called when the user clicks to expand/collapse a detail panel. */
	setDetailToggleCallback(fn: (rowId: string) => void): void {
		this.detailToggleCallback = fn;
	}

	/** Wire a handler called when a floating filter input value changes. */
	setFloatingFilterChangeCallback(fn: (field: string, value: string, operator: string) => void): void {
		this.floatingFilterChangeCallback = fn;
	}

	/** Wire a handler called when the user removes a filter chip from the filter chip bar. */
	setFilterChipRemoveCallback(fn: (columnId: string) => void): void {
		this.filterChipRemoveCallback = fn;
	}

	/** Wire a handler called when the user removes a column from the group panel. */
	setGroupPanelRemoveCallback(fn: (columnId: string) => void): void {
		this.groupPanelRemoveCallback = fn;
	}

	/** Force an immediate synchronous paint (for tests / imperative refresh). */
	schedulePaint(): void {
		this.frameCoordinator.schedulePaintFrame();
	}

	// ---------------------------------------------------------------------------
	// Frame handlers
	// ---------------------------------------------------------------------------

	private handleScrollFrame(): void {
		if (!this.layerRegistry) return;

		const layout = computeRenderLayout(this.view);
		const columns = this.view.getColumns();

		// Ensure topology is compiled
		this.ensureTopologyCompiled(columns);

		const topology = this.compiledTopology!;
		const rowCount = this.view.getVisualRowCount();
		const cfg = this.view.getDisplayConfig();
		const defaultRowHeight = cfg.defaultRowHeight || 40;

		// Recompute geometry
		this.geometryController.recomputeIfNeeded(rowCount, defaultRowHeight);

		// Update scroll coordinator
		const changed = this.scrollCoordinator.update({
			scrollTop: this.scrollTop,
			scrollLeft: this.scrollLeft,
			viewportWidth: this.vpWidth,
			viewportHeight: this.vpHeight,
			rowCount,
			defaultRowHeight,
			rowOverscanPx: 200,
			pinLeftCount: topology.leftPlacements.length,
			pinRightCount: topology.rightPlacements.length,
			centerColCount: topology.centerPlacements.length,
			colPlacements: topology.centerPlacements.map((p) => ({
				absoluteLeft: p.laneLeft,
				width: p.width,
			})),
			rowVersion: this.view.getVersion('rows'),
			colVersion: this.view.getVersion('columns'),
		});

		if (changed) {
			// Apply layout metrics
			this.applyLayerLayout(layout, topology);
			// Repaint rows (cheap: only visible range)
			this.paintRows(topology, defaultRowHeight);
		}
	}

	private paint(): void {
		if (!this.layerRegistry) return;

		const layout = computeRenderLayout(this.view);
		const columns = this.view.getColumns();

		// Recompile topology if column version changed
		this.ensureTopologyCompiled(columns);

		const topology = this.compiledTopology!;
		const rowCount = this.view.getVisualRowCount();
		const cfg = this.view.getDisplayConfig();
		const defaultRowHeight = cfg.defaultRowHeight || 40;

		// Rebuild row geometry
		this.geometryController.recomputeIfNeeded(rowCount, defaultRowHeight);

		// Sync scroll coordinator
		this.scrollCoordinator.update({
			scrollTop: this.scrollTop,
			scrollLeft: this.scrollLeft,
			viewportWidth: this.vpWidth,
			viewportHeight: this.vpHeight,
			rowCount,
			defaultRowHeight,
			rowOverscanPx: 200,
			pinLeftCount: topology.leftPlacements.length,
			pinRightCount: topology.rightPlacements.length,
			centerColCount: topology.centerPlacements.length,
			colPlacements: topology.centerPlacements.map((p) => ({
				absoluteLeft: p.laneLeft,
				width: p.width,
			})),
			rowVersion: this.view.getVersion('rows'),
			colVersion: this.view.getVersion('columns'),
		});

		const win = this.scrollCoordinator.getCurrent();

		// Apply DOM layout
		this.applyLayerLayout(layout, topology);

		// Paint top chrome
		this.paintGroupPanel(layout.chrome.groupPanelHeight);
		this.paintFilterChipBar(layout.chrome.filterChipBarHeight);

		// Paint header (skip if column version unchanged)
		this.paintHeader(topology, layout.chrome.headerHeight);

		// Paint floating filters
		this.paintFloatingFilters(topology, layout.chrome.floatingFilterHeight);

		// Paint rows
		this.paintRows(topology, defaultRowHeight);

		// Paint selection overlay
		this.paintSelectionOverlay(win, topology, defaultRowHeight);
	}

	// ---------------------------------------------------------------------------
	// DOM layer layout
	// ---------------------------------------------------------------------------

	private applyLayerLayout(layout: ReturnType<typeof computeRenderLayout>, topology: CompiledColumnTopology): void {
		const cfg = this.view.getDisplayConfig();

		this.layerRegistry!.applyLayout({
			totalRowsHeight: layout.dimensions.totalRowsHeight,
			contentWidth: layout.dimensions.contentWidth,
			groupPanelHeight: layout.chrome.groupPanelHeight,
			filterChipBarHeight: layout.chrome.filterChipBarHeight,
			headerHeight: layout.chrome.headerHeight,
			floatingFilterHeight: layout.chrome.floatingFilterHeight,
			pinLeftWidth: topology.pinLeftWidth,
			pinRightWidth: topology.pinRightWidth,
			showStatusBar: cfg.showStatusBar,
			statusBarHeight: layout.chrome.statusBarHeight,
			showPagination: false,
			paginationHeight: 0,
		});

		// Expose bottom chrome height as CSS variable
		if (this.container) {
			this.container.style.setProperty('--og-bottom-chrome-height', `${layout.chrome.bottomChromeHeight}px`);
		}
	}

	// ---------------------------------------------------------------------------
	// Column topology
	// ---------------------------------------------------------------------------

	private ensureTopologyCompiled(columns: readonly RenderColumn[]): void {
		const colVersion = this.view.getVersion('columns');
		if (this.compiledTopology !== null && colVersion === this.lastCompiledColVersion) return;

		this.compiledTopology = compileColumnTopology(columns, colVersion);
		this.geometryController.updateTopology(this.compiledTopology);
		this.lastCompiledColVersion = colVersion;

		// Invalidate header cells when column topology changes
		this.clearStaledHeaderCells(columns);
	}

	private clearStaledHeaderCells(columns: readonly RenderColumn[]): void {
		const currentFields = new Set(columns.map((c) => c.field));
		for (const [field, state] of this.headerCells) {
			if (!currentFields.has(field)) {
				state.el.remove();
				this.headerCells.delete(field);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Header rendering
	// ---------------------------------------------------------------------------

	private paintHeader(topology: CompiledColumnTopology, headerHeight: number): void {
		const { headerLeft, headerCenter, headerRight } = this.layerRegistry!.layers;

		const rendered = new Set<string>();

		const paintPlacement = (field: string, header: string, left: number, width: number, sortable: boolean, sortDirection: 'asc' | 'desc' | null, lane: 'left' | 'center' | 'right', columnId: string) => {
			rendered.add(field);

			let state = this.headerCells.get(field);
			if (!state) {
				const el = this.createHeaderCellElement(field, columnId);
				state = { el, field, lastSortDirection: undefined, lastWidth: -1, lastLeft: -1 };
				this.headerCells.set(field, state);
			}

			const el = state.el;

			// Update geometry only when changed
			const nextWidth = `${width}px`;
			const nextLeft = `${left}px`;
			const nextHeight = `${headerHeight}px`;
			if (el.style.width !== nextWidth) el.style.width = nextWidth;
			if (el.style.left !== nextLeft) el.style.left = nextLeft;
			if (el.style.height !== nextHeight) el.style.height = nextHeight;

			// Update label text
			const labelEl = el.querySelector<HTMLSpanElement>('.og-header-label');
			if (labelEl && labelEl.textContent !== header) labelEl.textContent = header;

			// Update data attributes
			if (el.dataset.field !== field) el.dataset.field = field;
			if (el.dataset.colId !== columnId) el.dataset.colId = columnId;

			// Sort indicator
			if (state.lastSortDirection !== sortDirection) {
				state.lastSortDirection = sortDirection;
				const sortEl = el.querySelector<HTMLElement>('.og-sort-indicator');
				if (sortEl) {
					if (sortDirection) {
						sortEl.style.display = '';
						sortEl.dataset.sort = sortDirection;
						sortEl.textContent = sortDirection === 'asc' ? '▲' : '▼';
					} else {
						sortEl.style.display = 'none';
					}
				}
			}

			// Move to correct lane container if needed
			const targetLayer = lane === 'left' ? headerLeft : lane === 'right' ? headerRight : headerCenter;
			if (el.parentNode !== targetLayer) {
				targetLayer.appendChild(el);
			}
		};

		// Left pins
		for (const p of topology.leftPlacements) {
			paintPlacement(p.field, p.header, p.laneLeft, p.width, p.sortable, p.sortDirection, 'left', p.columnId);
		}

		// Center columns
		const win = this.scrollCoordinator.getCurrent();
		for (let i = win.colStart; i <= win.colEnd && i < topology.centerPlacements.length; i++) {
			const p = topology.centerPlacements[i];
			if (!p) continue;
			paintPlacement(p.field, p.header, p.laneLeft, p.width, p.sortable, p.sortDirection, 'center', p.columnId);
		}

		// Right pins
		for (const p of topology.rightPlacements) {
			paintPlacement(p.field, p.header, p.laneLeft, p.width, p.sortable, p.sortDirection, 'right', p.columnId);
		}

		// Remove header cells no longer in the window
		for (const [field, state] of this.headerCells) {
			if (!rendered.has(field)) {
				state.el.remove();
				this.headerCells.delete(field);
			}
		}
	}

	private createHeaderCellElement(field: string, columnId: string): HTMLDivElement {
		const cell = document.createElement('div');
		cell.className = 'og-header-cell';
		cell.dataset.field = field;
		cell.dataset.colId = columnId;

		// Position absolute within the header lane
		cell.style.position = 'absolute';
		cell.style.top = '0';
		cell.style.display = 'flex';
		cell.style.alignItems = 'center';
		cell.style.overflow = 'hidden';
		cell.style.boxSizing = 'border-box';

		// Label span
		const label = document.createElement('span');
		label.className = 'og-header-label';
		label.style.overflow = 'hidden';
		label.style.textOverflow = 'ellipsis';
		label.style.whiteSpace = 'nowrap';
		label.style.flex = '1';
		label.style.minWidth = '0';
		label.textContent = field;
		cell.appendChild(label);

		// Sort indicator
		const sortIndicator = document.createElement('span');
		sortIndicator.className = 'og-sort-indicator';
		sortIndicator.style.display = 'none';
		sortIndicator.style.marginLeft = '4px';
		sortIndicator.style.flexShrink = '0';
		sortIndicator.style.fontSize = '10px';
		cell.appendChild(sortIndicator);

		// Sort click handler on the label (not the resize handle)
		label.addEventListener('click', (e) => {
			e.stopPropagation();
			if (!this.sortCallback) return;
			const colField = cell.dataset.field ?? field;
			const curDir = (cell.dataset.sortDir as 'asc' | 'desc' | undefined) ?? null;
			// Cycle: null → asc → desc → null
			const nextDir: 'asc' | 'desc' | null = curDir === null ? 'asc' : curDir === 'asc' ? 'desc' : null;
			this.sortCallback(colField, nextDir !== null ? curDir : null);
		});
		sortIndicator.addEventListener('click', (e) => {
			e.stopPropagation();
			if (!this.sortCallback) return;
			const colField = cell.dataset.field ?? field;
			const curDir = (cell.dataset.sortDir as 'asc' | 'desc' | undefined) ?? null;
			const nextDir: 'asc' | 'desc' | null = curDir === null ? 'asc' : curDir === 'asc' ? 'desc' : null;
			this.sortCallback(colField, nextDir !== null ? curDir : null);
		});

		// Resize handle
		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'og-col-resize-handle';
		resizeHandle.style.position = 'absolute';
		resizeHandle.style.right = '0';
		resizeHandle.style.top = '0';
		resizeHandle.style.bottom = '0';
		resizeHandle.style.width = '6px';
		resizeHandle.style.cursor = 'col-resize';
		resizeHandle.style.zIndex = '1';

		resizeHandle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const colField = cell.dataset.field ?? field;
			const currentWidth = cell.offsetWidth;

			this.resizeDragState = {
				field: colField,
				startX: e.clientX,
				startWidth: currentWidth,
			};

			const onMouseMove = (me: MouseEvent) => {
				if (!this.resizeDragState) return;
				const delta = me.clientX - this.resizeDragState.startX;
				const newWidth = Math.max(40, this.resizeDragState.startWidth + delta);
				// Optimistically update header cell width for immediate visual feedback
				cell.style.width = `${newWidth}px`;
			};

			const onMouseUp = (ue: MouseEvent) => {
				document.removeEventListener('mousemove', onMouseMove);
				document.removeEventListener('mouseup', onMouseUp);
				if (!this.resizeDragState) return;
				const delta = ue.clientX - this.resizeDragState.startX;
				const newWidth = Math.max(40, this.resizeDragState.startWidth + delta);
				this.resizeCallback?.(this.resizeDragState.field, newWidth);
				this.resizeDragState = null;
			};

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});

		cell.appendChild(resizeHandle);
		return cell;
	}

	// ---------------------------------------------------------------------------
	// Row rendering
	// ---------------------------------------------------------------------------

	private paintRows(topology: CompiledColumnTopology, defaultRowHeight: number): void {
		if (!this.layerRegistry) return;

		const win = this.scrollCoordinator.getCurrent();
		const rowCount = this.view.getVisualRowCount();

		// Build the visible window rows list and bind slots
		const bindings = this.rowBinder.bind(this.view);
		const needed = this.rowBinder.slotCount;

		this.ensureSlots(needed);

		// Hide slots beyond the current window
		for (let i = needed; i < this.slots.length; i++) {
			const slot = this.slots[i];
			if (slot) slot.el.style.display = 'none';
		}

		for (const binding of bindings) {
			const slot = this.slots[binding.slotIndex];
			if (!slot) continue;

			const { row, top, height, visualRowIndex } = binding;
			const rowId = row.kind === 'data' ? row.rowId : null;

			// Detect recycle: rowId changed → fire unmount for old portals, increment generation
			if (rowId !== slot.lastRowId && slot.lastRowId !== null) {
				this.fireUnmountForSlot(slot);
				slot.generation++;
			}

			// Paint the slot
			this.paintRowSlot(slot, row, visualRowIndex, top, height, topology, defaultRowHeight, win.colStart, win.colEnd);

			slot.lastRowId = rowId;
		}
	}

	private paintRowSlot(
		slot: RowSlotState,
		row: VisualRow<TRow>,
		visualRowIndex: number,
		top: number,
		height: number,
		topology: CompiledColumnTopology,
		defaultRowHeight: number,
		colStart: number,
		colEnd: number,
	): void {
		const el = slot.el;

		el.style.display = '';
		el.style.transform = `translateY(${top}px)`;
		el.style.height = `${height}px`;
		el.dataset.rowIndex = String(visualRowIndex);

		el.className = this.rowClass(row);

		this.paintCells(slot, row, topology, colStart, colEnd);
		slot.visualRowIndex = visualRowIndex;
	}

	private rowClass(row: VisualRow<TRow>): string {
		let cls = 'og-row';
		switch (row.kind) {
			case 'group':
				cls += ' og-row-group';
				break;
			case 'detail':
				cls += ' og-row-detail';
				break;
			case 'loading':
				cls += ' og-row-loading';
				break;
		}
		if (row.kind === 'data' && this.view.isRowSelected(row.rowId)) {
			cls += ' og-row-selected';
		}
		return cls;
	}

	private paintCells(
		slot: RowSlotState,
		row: VisualRow<TRow>,
		topology: CompiledColumnTopology,
		colStart: number,
		colEnd: number,
	): void {
		// When the row kind changes, clear all previous slot content first.
		if (slot.lastKind !== null && slot.lastKind !== row.kind) {
			this.clearSlotContent(slot);
		}
		slot.lastKind = row.kind;

		if (row.kind === 'group') {
			this.paintGroupRow(slot, row);
			return;
		}
		if (row.kind === 'detail') {
			this.paintDetailRow(slot, row);
			return;
		}
		if (row.kind === 'placeholder') {
			// Placeholder rows are outside the loaded block — render empty.
			slot.el.style.display = 'none';
			return;
		}

		// data | tree | loading — paint column cells
		this.paintColumnCells(slot, row, topology, colStart, colEnd);
	}

	/** Remove all cell/content elements from a slot (called on row-kind transition). */
	private clearSlotContent(slot: RowSlotState): void {
		this.fireUnmountForSlot(slot);
		slot.cellsByField.clear();
		slot.pinLeft?.remove();
		slot.pinLeft = null;
		slot.pinRight?.remove();
		slot.pinRight = null;
		slot.el.innerHTML = '';
	}

	// ---------------------------------------------------------------------------
	// Group row
	// ---------------------------------------------------------------------------

	private paintGroupRow(slot: RowSlotState, row: Extract<VisualRow<TRow>, { kind: 'group' }>): void {
		const el = slot.el;
		// Reuse existing group content if present; create on first paint.
		let groupEl = el.querySelector<HTMLDivElement>('.og-group-row-content');
		if (!groupEl) {
			groupEl = document.createElement('div');
			groupEl.className = 'og-group-row-content';
			groupEl.style.display = 'flex';
			groupEl.style.alignItems = 'center';
			groupEl.style.height = '100%';
			groupEl.style.paddingLeft = '8px';
			groupEl.style.gap = '6px';
			groupEl.style.cursor = 'pointer';
			groupEl.style.userSelect = 'none';

			const chevron = document.createElement('span');
			chevron.className = 'og-group-chevron';
			chevron.style.display = 'inline-block';
			chevron.style.width = '16px';
			chevron.style.textAlign = 'center';
			chevron.style.transition = 'transform 0.15s';
			chevron.style.flexShrink = '0';
			groupEl.appendChild(chevron);

			const label = document.createElement('span');
			label.className = 'og-group-label';
			label.style.overflow = 'hidden';
			label.style.textOverflow = 'ellipsis';
			label.style.whiteSpace = 'nowrap';
			label.style.fontWeight = '600';
			groupEl.appendChild(label);

			const count = document.createElement('span');
			count.className = 'og-group-count';
			count.style.opacity = '0.6';
			count.style.fontSize = '0.85em';
			count.style.flexShrink = '0';
			groupEl.appendChild(count);

			groupEl.addEventListener('click', () => {
				this.groupToggleCallback?.(row.groupKey);
			});

			el.appendChild(groupEl);
		}

		// Update depth indentation
		const indentPx = row.depth * 16;
		groupEl.style.paddingLeft = `${8 + indentPx}px`;

		// Update chevron
		const chevron = groupEl.querySelector<HTMLSpanElement>('.og-group-chevron');
		if (chevron) {
			chevron.textContent = row.expanded ? '▾' : '▸';
			chevron.style.transform = '';
		}

		// Update label
		const label = groupEl.querySelector<HTMLSpanElement>('.og-group-label');
		if (label) {
			const valText = row.value != null ? String(row.value) : '(blank)';
			label.textContent = valText;
		}

		// Update count
		const countEl = groupEl.querySelector<HTMLSpanElement>('.og-group-count');
		if (countEl) {
			countEl.textContent = `(${row.count})`;
		}

		// Re-wire click to latest groupKey (handles slot recycle)
		const oldHandler = (groupEl as HTMLDivElement & { _ogGroupHandler?: () => void })._ogGroupHandler;
		if (oldHandler) groupEl.removeEventListener('click', oldHandler);
		const handler = () => { this.groupToggleCallback?.(row.groupKey); };
		(groupEl as HTMLDivElement & { _ogGroupHandler?: () => void })._ogGroupHandler = handler;
		groupEl.addEventListener('click', handler);
	}

	// ---------------------------------------------------------------------------
	// Detail row
	// ---------------------------------------------------------------------------

	private paintDetailRow(slot: RowSlotState, row: Extract<VisualRow<TRow>, { kind: 'detail' }>): void {
		const el = slot.el;
		let detailEl = el.querySelector<HTMLDivElement>('.og-detail-row-content');
		if (!detailEl) {
			detailEl = document.createElement('div');
			detailEl.className = 'og-detail-row-content';
			detailEl.style.width = '100%';
			detailEl.style.height = '100%';
			detailEl.dataset.parentRowId = String(row.parentRowId);
			el.appendChild(detailEl);
		}
		// Portal consumers can mount into detailEl via callbacks if wired up.
	}

	// ---------------------------------------------------------------------------
	// Column-based cell painting (data | tree | loading)
	// ---------------------------------------------------------------------------

	private paintColumnCells(
		slot: RowSlotState,
		row: VisualRow<TRow>,
		topology: CompiledColumnTopology,
		colStart: number,
		colEnd: number,
	): void {
		const el = slot.el;
		const hasLeft = topology.pinLeftWidth > 0;
		const hasRight = topology.pinRightWidth > 0;

		// Ensure pin containers exist lazily
		if (hasLeft && !slot.pinLeft) {
			const pl = document.createElement('div');
			pl.className = 'og-row-pin-left';
			el.insertBefore(pl, el.firstChild);
			slot.pinLeft = pl;
		}
		if (hasRight && !slot.pinRight) {
			const pr = document.createElement('div');
			pr.className = 'og-row-pin-right';
			el.appendChild(pr);
			slot.pinRight = pr;
		}

		// Update pin container widths
		if (slot.pinLeft) slot.pinLeft.style.width = `${topology.pinLeftWidth}px`;
		if (slot.pinRight) slot.pinRight.style.width = `${topology.pinRightWidth}px`;

		// Determine which center columns to render
		const visibleCenterPlacements = topology.centerPlacements.slice(colStart, colEnd + 1);

		// Build the full set of fields to render in this frame
		const renderFields = new Set<string>();
		for (const p of topology.leftPlacements) renderFields.add(p.field);
		for (const p of visibleCenterPlacements) renderFields.add(p.field);
		for (const p of topology.rightPlacements) renderFields.add(p.field);

		// Remove cells that left the window
		for (const [field, cellEl] of slot.cellsByField) {
			if (!renderFields.has(field)) {
				if (row.kind === 'data') {
					const cellKey = `${row.rowId}:${field}`;
					if (slot.mountedCellKeys.has(cellKey)) {
						this.callbacks.onUnmountCellContent?.({ cellKey });
						slot.mountedCellKeys.delete(cellKey);
					}
				}
				cellEl.remove();
				slot.cellsByField.delete(field);
			}
		}

		// Paint left pins
		for (const p of topology.leftPlacements) {
			this.paintCell(slot, row, p.field, p.laneLeft, p.width, 'left', 0);
		}

		// Paint visible center columns — first visible col gets tree indent
		let firstCenter = true;
		for (const p of visibleCenterPlacements) {
			const treeIndent = firstCenter && row.kind === 'tree' ? row.depth * 16 : 0;
			firstCenter = false;
			this.paintCell(slot, row, p.field, topology.pinLeftWidth + p.laneLeft, p.width, 'center', treeIndent);
		}

		// Paint right pins
		for (const p of topology.rightPlacements) {
			this.paintCell(slot, row, p.field, p.laneLeft, p.width, 'right', 0);
		}
	}

	private paintCell(
		slot: RowSlotState,
		row: VisualRow<TRow>,
		field: string,
		cssLeft: number,
		width: number,
		lane: 'left' | 'center' | 'right',
		treeIndent: number,
	): void {
		const el = slot.el;
		let cellEl = slot.cellsByField.get(field);
		const isNew = !cellEl;

		if (!cellEl) {
			cellEl = document.createElement('div');
			cellEl.className = 'og-cell';
			cellEl.style.position = 'absolute';
			cellEl.style.top = '0';
			cellEl.style.bottom = '0';
			cellEl.style.overflow = 'hidden';
			cellEl.style.boxSizing = 'border-box';
			if (lane === 'left') cellEl.classList.add('og-cell-pinned-left');
			if (lane === 'right') cellEl.classList.add('og-cell-pinned-right');

			const content = document.createElement('div');
			content.className = 'og-cell-content';
			content.dataset.contentMode = 'text';
			cellEl.appendChild(content);

			// Append to appropriate container
			if (lane === 'left' && slot.pinLeft) {
				slot.pinLeft.appendChild(cellEl);
			} else if (lane === 'right' && slot.pinRight) {
				slot.pinRight.appendChild(cellEl);
			} else {
				el.appendChild(cellEl);
			}

			slot.cellsByField.set(field, cellEl);
		}

		// Update geometry
		const nextLeft = `${cssLeft}px`;
		const nextWidth = `${width}px`;
		if (cellEl.style.left !== nextLeft) cellEl.style.left = nextLeft;
		if (cellEl.style.width !== nextWidth) cellEl.style.width = nextWidth;

		// Tree indentation on first center column
		if (treeIndent > 0) {
			cellEl.style.paddingLeft = `${treeIndent}px`;
		} else if (cellEl.style.paddingLeft) {
			cellEl.style.paddingLeft = '';
		}

		// Update content
		const contentEl = cellEl.firstElementChild as HTMLDivElement | null;
		if (!contentEl) return;

		if (row.kind === 'data') {
			const val = this.view.getCellDisplayValue(row.rowId, field);
			const text = val != null ? String(val) : '';
			if (contentEl.dataset.contentMode !== 'text') contentEl.dataset.contentMode = 'text';

			// Fire portal callback on new bind
			if (isNew && this.callbacks.onMountCellContent) {
				const columns = this.view.getColumns();
				const col = columns.find((c) => c.field === field);
				if (col) {
					const cellKey = `${row.rowId}:${field}`;
					slot.mountedCellKeys.add(cellKey);
					this.callbacks.onMountCellContent({
						cellKey,
						container: cellEl,
						rowId: row.rowId,
						field,
						row,
						column: col,
					});
				}
			} else if (!isNew || !this.callbacks.onMountCellContent) {
				if (contentEl.textContent !== text) contentEl.textContent = text;
			}
		} else if (row.kind === 'tree') {
			// Tree rows are real data rows — display cell value same as data
			const val = this.view.getCellDisplayValue(row.rowId, field);
			const text = val != null ? String(val) : '';
			if (contentEl.dataset.contentMode !== 'text') contentEl.dataset.contentMode = 'text';
			// Add expand/collapse chevron to first column if this is a tree row with children
			// (simplified: always show chevron; wires to treeToggleCallback on click)
			if (isNew) {
				cellEl.addEventListener('click', (e) => {
					if (!(e.target as HTMLElement).closest('.og-tree-chevron')) return;
					this.treeToggleCallback?.(String(row.rowId));
				});
			}
			if (contentEl.textContent !== text) contentEl.textContent = text;
		} else if (row.kind === 'loading') {
			if (contentEl.dataset.contentMode !== 'loading') {
				contentEl.dataset.contentMode = 'loading';
				contentEl.innerHTML = '';
				const skel = document.createElement('div');
				skel.className = 'og-cell-loading-skeleton';
				contentEl.appendChild(skel);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Group panel chrome
	// ---------------------------------------------------------------------------

	private paintGroupPanel(groupPanelHeight: number): void {
		if (!this.layerRegistry) return;
		const el = this.layerRegistry.layers.groupPanelLayer;
		if (groupPanelHeight === 0) return;

		const groupBy = this.view.getGroupBy();
		const columns = this.view.getColumns();

		// Rebuild content on every paint (group-by changes are rare and the element is simple)
		el.innerHTML = '';
		el.style.display = 'flex';
		el.style.alignItems = 'center';
		el.style.gap = '6px';
		el.style.padding = '0 10px';
		el.style.fontSize = '12px';

		if (groupBy.length === 0) {
			const hint = document.createElement('span');
			hint.style.color = 'var(--og-cell-text-muted, #888)';
			hint.style.pointerEvents = 'none';
			hint.textContent = 'Drag a column here to group…';
			el.appendChild(hint);
		} else {
			const label = document.createElement('span');
			label.textContent = 'Group by:';
			label.style.color = 'var(--og-cell-text-muted, #888)';
			label.style.marginRight = '4px';
			el.appendChild(label);

			for (const g of groupBy) {
				const col = columns.find((c) => String(c.columnId) === String(g.columnId));
				const name = col?.header ?? g.field;
				const chip = document.createElement('div');
				chip.style.display = 'inline-flex';
				chip.style.alignItems = 'center';
				chip.style.gap = '4px';
				chip.style.padding = '2px 8px';
				chip.style.border = '1px solid var(--og-border, #ddd)';
				chip.style.borderRadius = '12px';
				chip.style.background = 'var(--og-primary, #4f46e5)';
				chip.style.color = '#fff';
				chip.style.fontSize = '12px';

				const chipLabel = document.createElement('span');
				chipLabel.textContent = name;
				chip.appendChild(chipLabel);

				const remove = document.createElement('button');
				remove.textContent = '✕';
				remove.style.border = 'none';
				remove.style.background = 'transparent';
				remove.style.color = '#fff';
				remove.style.cursor = 'pointer';
				remove.style.padding = '0';
				remove.style.fontSize = '10px';
				remove.addEventListener('click', (e) => {
					e.stopPropagation();
					this.groupPanelRemoveCallback?.(String(g.columnId));
				});
				chip.appendChild(remove);
				el.appendChild(chip);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Filter chip bar chrome
	// ---------------------------------------------------------------------------

	private paintFilterChipBar(filterChipBarHeight: number): void {
		if (!this.layerRegistry) return;
		const el = this.layerRegistry.layers.filterChipBarLayer;
		if (filterChipBarHeight === 0) return;

		const filterModel = this.view.getFilterModel();
		const columns = this.view.getColumns();

		el.innerHTML = '';
		el.style.display = 'flex';
		el.style.alignItems = 'center';
		el.style.gap = '6px';
		el.style.padding = '0 10px';
		el.style.fontSize = '12px';
		el.style.overflowX = 'auto';

		if (filterModel.length > 0) {
			for (const f of filterModel) {
				const col = columns.find((c) => String(c.columnId) === String(f.columnId));
				const name = col?.header ?? f.field;
				const chip = document.createElement('div');
				chip.style.display = 'inline-flex';
				chip.style.alignItems = 'center';
				chip.style.gap = '4px';
				chip.style.padding = '2px 8px';
				chip.style.border = '1px solid var(--og-border, #ddd)';
				chip.style.borderRadius = '12px';
				chip.style.background = 'var(--og-cell-bg, #fff)';
				chip.style.fontSize = '12px';
				chip.style.whiteSpace = 'nowrap';

				const chipLabel = document.createElement('span');
				chipLabel.textContent = `${name}: ${f.operator ?? ''} ${String(f.value ?? '')}`.trim();
				chip.appendChild(chipLabel);

				const remove = document.createElement('button');
				remove.textContent = '✕';
				remove.style.border = 'none';
				remove.style.background = 'transparent';
				remove.style.cursor = 'pointer';
				remove.style.padding = '0 2px';
				remove.style.fontSize = '10px';
				remove.style.color = 'var(--og-cell-text-muted, #888)';
				remove.addEventListener('click', (e) => {
					e.stopPropagation();
					this.filterChipRemoveCallback?.(String(f.columnId));
				});
				chip.appendChild(remove);
				el.appendChild(chip);
			}
		} else {
			const hint = document.createElement('span');
			hint.style.color = 'var(--og-cell-text-muted, #888)';
			hint.textContent = 'No active filters';
			el.appendChild(hint);
		}
	}

	// ---------------------------------------------------------------------------
	// Floating filter chrome
	// ---------------------------------------------------------------------------

	private paintFloatingFilters(topology: CompiledColumnTopology, floatingFilterHeight: number): void {
		if (!this.layerRegistry || floatingFilterHeight === 0) return;

		const filterModel = this.view.getFilterModel();
		const { floatingFilterLeft, floatingFilterCenter, floatingFilterRight } = this.layerRegistry.layers;

		const filterByField = new Map(filterModel.map((f) => [f.field, f]));
		const renderedFields = new Set<string>();

		const paintFilterInput = (
			field: string,
			cssLeft: number,
			width: number,
			lane: 'left' | 'center' | 'right',
		): void => {
			renderedFields.add(field);
			let input = this.floatingFilterInputs.get(field);
			const isNew = !input;

			if (!input) {
				input = document.createElement('input');
				input.type = 'text';
				input.placeholder = 'Filter…';
				input.style.position = 'absolute';
				input.style.top = '4px';
				input.style.bottom = '4px';
				input.style.boxSizing = 'border-box';
				input.style.border = '1px solid var(--og-border, #ddd)';
				input.style.borderRadius = '3px';
				input.style.padding = '0 6px';
				input.style.fontSize = '12px';
				input.style.background = 'var(--og-cell-bg, #fff)';
				input.style.color = 'inherit';
				input.dataset.field = field;
				input.addEventListener('input', () => {
					this.floatingFilterChangeCallback?.(field, input!.value, 'contains');
				});
				const targetLane = lane === 'left' ? floatingFilterLeft : lane === 'right' ? floatingFilterRight : floatingFilterCenter;
				targetLane.appendChild(input);
				this.floatingFilterInputs.set(field, input);
			}

			input.style.left = `${cssLeft}px`;
			input.style.width = `${width - 4}px`;

			// Sync value with current filter model (without clobbering user typing)
			const active = filterByField.get(field);
			const modelVal = active ? String(active.value ?? '') : '';
			if (isNew || document.activeElement !== input) {
				input.value = modelVal;
			}
		};

		const win = this.scrollCoordinator.getCurrent();

		for (const p of topology.leftPlacements) {
			paintFilterInput(p.field, p.laneLeft, p.width, 'left');
		}
		for (let i = win.colStart; i <= win.colEnd && i < topology.centerPlacements.length; i++) {
			const p = topology.centerPlacements[i];
			if (!p) continue;
			paintFilterInput(p.field, topology.pinLeftWidth + p.laneLeft, p.width, 'center');
		}
		for (const p of topology.rightPlacements) {
			paintFilterInput(p.field, p.laneLeft, p.width, 'right');
		}

		// Remove inputs that left the window
		for (const [field, input] of this.floatingFilterInputs) {
			if (!renderedFields.has(field)) {
				input.remove();
				this.floatingFilterInputs.delete(field);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Selection overlay
	// ---------------------------------------------------------------------------

	private paintSelectionOverlay(
		win: Readonly<import('./RenderWindow.js').RenderWindow>,
		topology: CompiledColumnTopology,
		defaultRowHeight: number,
	): void {
		if (!this.layerRegistry) return;

		// For now: a simple single .og-selection-overlay positioned over the selected range.
		// More sophisticated multi-range overlays can be added later.
		// We just ensure the overlay div exists in the overlay layer.
		if (!this.selectionOverlay) {
			const overlay = document.createElement('div');
			overlay.className = 'og-selection-overlay';
			overlay.style.position = 'absolute';
			overlay.style.pointerEvents = 'none';
			overlay.style.display = 'none';
			this.layerRegistry.layers.overlayLayer.appendChild(overlay);
			this.selectionOverlay = overlay;
		}

		// Hide by default — specific selection logic can be wired later
		this.selectionOverlay.style.display = 'none';
	}

	// ---------------------------------------------------------------------------
	// Slot management
	// ---------------------------------------------------------------------------

	private ensureSlots(count: number): void {
		if (!this.layerRegistry) return;
		while (this.slots.length < count) {
			const el = document.createElement('div');
			el.className = 'og-row';
			el.style.position = 'absolute';
			el.style.left = '0';
			el.style.right = '0';
			this.layerRegistry.layers.rowsContainer.appendChild(el);
			this.slots.push({
				el,
				visualRowIndex: -1,
				lastRowId: null,
				generation: 0,
				cellsByField: new Map(),
				mountedCellKeys: new Set(),
				pinLeft: null,
				pinRight: null,
				lastKind: null,
			});
		}
	}

	// ---------------------------------------------------------------------------
	// Portal cleanup
	// ---------------------------------------------------------------------------

	private fireUnmountForSlot(slot: RowSlotState): void {
		for (const cellKey of slot.mountedCellKeys) {
			this.callbacks.onUnmountCellContent?.({ cellKey });
		}
		slot.mountedCellKeys.clear();
	}

	private fireUnmountForAllSlots(): void {
		for (const slot of this.slots) {
			this.fireUnmountForSlot(slot);
		}
	}
}

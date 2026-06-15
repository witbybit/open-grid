import type { GridEngine } from '../engine/GridEngine.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { computeGridLayoutPlan } from './layoutPlan.js';
import type {
	ColumnFilter,
	FilterModel,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SetFilterCondition,
} from '../filterModel.js';
import type { InternalColumnDef } from '../columnDef.js';

/** Params passed to a custom floatingFilterRenderer function. */
export interface FloatingFilterRendererParams<TRowData = unknown> {
	column: InternalColumnDef<TRowData>;
	colField: string;
	/** Current filter for this column, or null. */
	currentFilter: ColumnFilter | null;
	/** Call this to programmatically update the filter for this column. */
	setFilter(filter: ColumnFilter | null): void;
	/** The cell container element — size to fill it. */
	eCell: HTMLDivElement;
}

/** Debounce a function call by `ms` ms. */
function debounce(fn: (...args: unknown[]) => void, ms: number): (...args: unknown[]) => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...args) => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), ms);
	};
}

export class FloatingFilterRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;

	private filterLayer: HTMLDivElement | null = null;
	private filterLeftLayer: HTMLDivElement | null = null;
	private filterRightLayer: HTMLDivElement | null = null;

	// Cell elements keyed by column field (survives reorder)
	private cells = new Map<string, HTMLDivElement>();
	private lastScrollLeft = 0;
	private lastSyncedViewportWidth = -1;
	private lastLeftTransform = '';
	private lastRightLeft = -1;
	private lastRightTransform = '';
	private lastFilterModel: FilterModel | null = null;
	private lastVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1 };
	private unsubscribers: (() => void)[] = [];

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
	}

	public mount(filterLayer: HTMLDivElement, filterLeftLayer: HTMLDivElement, filterRightLayer: HTMLDivElement): void {
		this.filterLayer = filterLayer;
		this.filterLeftLayer = filterLeftLayer;
		this.filterRightLayer = filterRightLayer;
		this.clearCells();

		// Re-render on filter model change (values may change from outside)
		const unsub1 = this.engine.stateManager.subscribeToKey('filterModel', () => this.repaint());
		// Re-render on column change
		const unsub2 = this.engine.stateManager.subscribeToKey('columns', () => this.repaint());
		this.unsubscribers.push(unsub1, unsub2);
	}

	public unmount(): void {
		this.unsubscribers.forEach((u) => u());
		this.unsubscribers = [];
		this.clearCells();
		this.filterLayer = null;
		this.filterLeftLayer = null;
		this.filterRightLayer = null;
	}

	public repaint(layoutPlan?: GridLayoutPlan): void {
		this.syncVisibleFilters(true, layoutPlan ?? computeGridLayoutPlan(this.engine));
	}

	public syncScrollLeft(layoutPlan: GridLayoutPlan): void {
		const scrollLeft = layoutPlan.viewport.scrollLeft;
		const clientWidth = layoutPlan.viewport.clientWidth;
		if (scrollLeft === this.lastScrollLeft && clientWidth === this.lastSyncedViewportWidth) return;
		this.lastScrollLeft = scrollLeft;
		this.lastSyncedViewportWidth = clientWidth;
		this.syncPinnedPositions(layoutPlan);
	}

	private syncPinnedPositions(plan: GridLayoutPlan): void {
		if (!this.filterLayer || !this.filterLeftLayer || !this.filterRightLayer) return;

		const scrollLeft = plan.viewport.scrollLeft;
		const clientWidth = plan.viewport.clientWidth;
		const pinLeftWidth = plan.columns.pinLeftWidth;
		const pinRightWidth = plan.columns.pinRightWidth;

		// Center lane scrolls with the viewport
		const centerTransform = `translate3d(${-scrollLeft}px, 0, 0)`;
		if (this.filterLayer.style.transform !== centerTransform) {
			this.filterLayer.style.transform = centerTransform;
		}

		// Left pin: counter-scroll so it stays fixed at left edge
		const leftTransform = `translate3d(${scrollLeft}px, 0, 0)`;
		if (this.lastLeftTransform !== leftTransform) {
			this.lastLeftTransform = leftTransform;
			this.filterLeftLayer.style.transform = leftTransform;
		}

		// Right pin: position at right edge of client, counter-scroll
		const rightLeft = scrollLeft + clientWidth - pinRightWidth;
		if (this.lastRightLeft !== rightLeft) {
			this.lastRightLeft = rightLeft;
			this.filterRightLayer.style.left = `${rightLeft}px`;
		}
		const rightTransform = `translate3d(${scrollLeft}px, 0, 0)`;
		if (this.lastRightTransform !== rightTransform) {
			this.lastRightTransform = rightTransform;
			this.filterRightLayer.style.transform = rightTransform;
		}

		// Hide left/right layers when empty
		this.filterLeftLayer.style.display = pinLeftWidth > 0 ? '' : 'none';
		this.filterRightLayer.style.display = pinRightWidth > 0 ? '' : 'none';
	}

	private syncVisibleFilters(force: boolean, plan: GridLayoutPlan): void {
		if (!this.filterLayer || !this.filterLeftLayer || !this.filterRightLayer) return;
		if (plan.chrome.floatingFilterHeight === 0) return;

		const columnPlan = this.engine.columns.getCompiledPlan();
		const columns = columnPlan.displayedColumns as InternalColumnDef<TRowData>[];
		const colLefts = columnPlan.colLefts;
		const colWidths = columnPlan.colWidths;
		const colStart = plan.columns.colStart;
		const colEnd = plan.columns.colEnd;
		const pinLeftCount = plan.columns.pinLeftCount;
		const firstRightPinColIdx = columns.length - plan.columns.pinRightCount;
		const filterModel = this.engine.stateManager.getState().filterModel;

		const rangeKey = `${colStart}:${colEnd}:${pinLeftCount}:${plan.columns.pinRightCount}`;
		const filterChanged = filterModel !== this.lastFilterModel;
		if (
			!force &&
			rangeKey ===
				`${this.lastVisibleRange.startIdx}:${this.lastVisibleRange.endIdx}:${this.lastVisibleRange.pinLeft}:${this.lastVisibleRange.pinRight}` &&
			!filterChanged
		) {
			return;
		}
		this.lastFilterModel = filterModel;
		this.lastVisibleRange = { startIdx: colStart, endIdx: colEnd, pinLeft: pinLeftCount, pinRight: plan.columns.pinRightCount };

		const colCount = columns.length;
		const seen = new Set<string>();

		for (let c = 0; c < colCount; c++) {
			const col = columns[c];
			const isPinLeft = c < pinLeftCount;
			const isPinRight = c >= firstRightPinColIdx;
			const isCenter = !isPinLeft && !isPinRight;

			if (isCenter && (c < colStart || c > colEnd)) continue;

			seen.add(col.field);

			const left = colLefts[c] ?? 0;
			const width = colWidths[c] ?? this.engine.stateManager.getState().defaultColWidth;
			const currentFilter = (filterModel?.[col.field] ?? null) as ColumnFilter | null;

			let cell = this.cells.get(col.field);
			if (!cell) {
				cell = this.createCell(c, col, left, width, currentFilter, isPinLeft, isPinRight);
			} else {
				// Update position if column widths changed
				cell.style.left = `${left}px`;
				cell.style.width = `${width}px`;
				// Sync filter value if it changed
				this.updateCellFilterValue(cell, currentFilter);
			}
		}

		// Remove cells that are no longer in the visible range
		for (const [c, cell] of this.cells) {
			if (!seen.has(c)) {
				cell.remove();
				this.cells.delete(c);
			}
		}

		this.syncPinnedPositions(plan);
	}

	private createCell(
		colIndex: number,
		col: InternalColumnDef<TRowData>,
		left: number,
		width: number,
		currentFilter: ColumnFilter | null,
		isPinLeft: boolean,
		isPinRight: boolean
	): HTMLDivElement {
		const cell = document.createElement('div');
		cell.className = 'og-floating-filter-cell';
		cell.dataset.colField = col.field;
		cell.dataset.colIndex = String(colIndex);
		cell.style.left = `${left}px`;
		cell.style.width = `${width}px`;

		const setFilter = (filter: ColumnFilter | null): void => {
			const state = this.engine.stateManager.getState();
			const newModel: FilterModel = { ...(state.filterModel ?? {}) };
			if (filter == null) {
				delete newModel[col.field];
			} else {
				newModel[col.field] = filter;
			}
			this.engine.stateManager.setState({ filterModel: Object.keys(newModel).length > 0 ? newModel : null });
			this.engine.invalidation.invalidateFull('floating-filter');
		};

		// Use custom renderer if provided
		if ((col as any).floatingFilterRenderer) {
			const params: FloatingFilterRendererParams<TRowData> = { column: col, colField: col.field, currentFilter, setFilter, eCell: cell };
			(col as any).floatingFilterRenderer(params);
		} else {
			this.buildDefaultInput(cell, col, currentFilter, setFilter);
		}

		const parent = isPinLeft ? this.filterLeftLayer : isPinRight ? this.filterRightLayer : this.filterLayer;
		parent?.appendChild(cell);
		this.cells.set(col.field, cell);
		return cell;
	}

	private buildDefaultInput(
		cell: HTMLDivElement,
		col: InternalColumnDef<TRowData>,
		currentFilter: ColumnFilter | null,
		setFilter: (f: ColumnFilter | null) => void
	): void {
		const filterType = col.filterType ?? 'text';
		if (filterType === 'none') return;

		if (filterType === 'set') {
			this.buildSetBadge(cell, col, currentFilter as SetFilterCondition | null, setFilter);
			return;
		}

		const input = document.createElement('input');
		input.className = 'og-floating-filter-input';

		if (filterType === 'number') {
			input.type = 'number';
			input.placeholder = 'Filter…';
			const numFilter = currentFilter?.type === 'number' ? (currentFilter as NumberFilterCondition) : null;
			if (numFilter && numFilter.value != null) input.value = String(numFilter.value);
		} else if (filterType === 'date') {
			input.type = 'date';
			const dateFilter = currentFilter?.type === 'date' ? (currentFilter as DateFilterCondition) : null;
			if (dateFilter?.dateFrom) input.value = dateFilter.dateFrom;
		} else {
			// text (default)
			input.type = 'text';
			input.placeholder = 'Filter…';
			const textFilter = currentFilter?.type === 'text' ? (currentFilter as TextFilterCondition) : null;
			if (textFilter?.value) input.value = textFilter.value;
		}

		const debouncedUpdate = debounce((...args: unknown[]) => {
			const val = args[0] as string;
			if (!val) {
				setFilter(null);
				return;
			}
			if (filterType === 'number') {
				const n = parseFloat(val);
				if (!isNaN(n)) setFilter({ type: 'number', operator: 'equals', value: n });
			} else if (filterType === 'date') {
				setFilter({ type: 'date', operator: 'equals', dateFrom: val });
			} else {
				setFilter({ type: 'text', operator: 'contains', value: val });
			}
		}, 200);

		input.addEventListener('input', () => debouncedUpdate(input.value));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				input.value = '';
				setFilter(null);
			}
		});

		cell.dataset.inputType = filterType;
		cell.appendChild(input);
	}

	private buildSetBadge(
		cell: HTMLDivElement,
		col: InternalColumnDef<TRowData> | null,
		currentFilter: SetFilterCondition | null,
		setFilter: (f: ColumnFilter | null) => void
	): void {
		const openDropdown = (): void => {
			const filterValues = ((col as any)?.filterValues as string[] | undefined) ?? [];
			this.openSetDropdown(cell, filterValues, currentFilter, setFilter);
		};

		if (currentFilter && currentFilter.values.length > 0) {
			const badge = document.createElement('div');
			badge.className = 'og-floating-filter-set-badge';
			const count = currentFilter.values.length;
			badge.title = currentFilter.values.map((v) => (v === null ? '(blank)' : String(v))).join(', ');
			badge.textContent = `${count} value${count !== 1 ? 's' : ''}`;
			badge.addEventListener('click', openDropdown);
			cell.dataset.inputType = 'set';
			cell.appendChild(badge);
		} else {
			const empty = document.createElement('div');
			empty.className = 'og-floating-filter-empty';
			empty.textContent = 'All';
			empty.addEventListener('click', openDropdown);
			cell.dataset.inputType = 'set';
			cell.appendChild(empty);
		}
	}

	private openSetDropdown(
		cell: HTMLDivElement,
		filterValues: string[],
		currentFilter: SetFilterCondition | null,
		setFilter: (f: ColumnFilter | null) => void
	): void {
		const DROPDOWN_ID = 'og-floating-set-dropdown';
		// Toggle: if already open for this cell, close it
		const existing = document.getElementById(DROPDOWN_ID);
		if (existing) {
			existing.remove();
			if ((existing as any).__cell === cell) return;
		}

		const selected = new Set<string>((currentFilter?.values ?? []).map(String));

		const dropdown = document.createElement('div');
		dropdown.id = DROPDOWN_ID;
		(dropdown as any).__cell = cell;
		dropdown.style.cssText = [
			'position:fixed',
			'z-index:9000',
			'min-width:160px',
			'max-height:260px',
			'overflow-y:auto',
			'padding:4px 0',
			'border-radius:8px',
			'box-shadow:0 8px 24px rgba(0,0,0,0.5)',
			`background:var(--og-popover-bg,#1e293b)`,
			`border:1px solid var(--og-border-color)`,
			`font-family:var(--og-font-family)`,
		].join(';');

		const rect = cell.getBoundingClientRect();
		dropdown.style.top = `${rect.bottom + 2}px`;
		dropdown.style.left = `${rect.left}px`;

		const applyFilter = (): void => {
			const arr = [...selected];
			setFilter(arr.length > 0 ? { type: 'set', values: arr } : null);
		};

		for (const v of filterValues) {
			const row = document.createElement('label');
			row.style.cssText =
				'display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;font-size:11px;white-space:nowrap;' +
				`color:var(--og-text-color)`;
			row.addEventListener('mouseenter', () => (row.style.background = 'var(--og-popover-item-hover-bg)'));
			row.addEventListener('mouseleave', () => (row.style.background = ''));

			const cb = document.createElement('input');
			cb.type = 'checkbox';
			cb.checked = selected.has(v);
			cb.style.cssText = `accent-color:var(--og-focus-ring);cursor:pointer;flex-shrink:0`;
			cb.addEventListener('change', () => {
				if (cb.checked) selected.add(v);
				else selected.delete(v);
				applyFilter();
			});

			const label = document.createElement('span');
			label.textContent = v;

			row.appendChild(cb);
			row.appendChild(label);
			dropdown.appendChild(row);
		}

		// "Clear" footer if anything is selected
		if (filterValues.length > 0) {
			const sep = document.createElement('div');
			sep.style.cssText = `margin:4px 0;border-top:1px solid var(--og-border-color)`;
			dropdown.appendChild(sep);

			const clearBtn = document.createElement('button');
			clearBtn.textContent = 'Clear filter';
			clearBtn.style.cssText = [
				'width:100%',
				'padding:5px 12px',
				'background:none',
				'border:none',
				'cursor:pointer',
				'font-size:10px',
				'text-align:left',
				`color:var(--og-focus-ring)`,
				`font-family:var(--og-font-family)`,
				'font-weight:600',
			].join(';');
			clearBtn.addEventListener('click', () => {
				selected.clear();
				applyFilter();
				dropdown.remove();
			});
			dropdown.appendChild(clearBtn);
		}

		// Inherit the grid's theme scope so CSS vars (--og-*) resolve correctly
		const gridContainer = cell.closest('.og-grid-container') as HTMLElement | null;
		if (gridContainer?.dataset.ogThemeScope) {
			dropdown.dataset.ogThemeScope = gridContainer.dataset.ogThemeScope;
		}
		document.body.appendChild(dropdown);

		const onOutsideClick = (e: MouseEvent): void => {
			if (!dropdown.contains(e.target as Node) && e.target !== cell) {
				dropdown.remove();
				document.removeEventListener('mousedown', onOutsideClick, true);
			}
		};
		const onEscape = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				dropdown.remove();
				document.removeEventListener('keydown', onEscape, true);
			}
		};
		setTimeout(() => {
			document.addEventListener('mousedown', onOutsideClick, true);
			document.addEventListener('keydown', onEscape, true);
		}, 0);
	}

	private updateCellFilterValue(cell: HTMLDivElement, currentFilter: ColumnFilter | null): void {
		const inputType = cell.dataset.inputType;
		if (!inputType || inputType === 'set') {
			// Re-build set badge if filter changed
			const hasBadge = cell.querySelector('.og-floating-filter-set-badge');
			const hasEmpty = cell.querySelector('.og-floating-filter-empty');
			const setFilter = (newFilter: ColumnFilter | null): void => {
				const colField = cell.dataset.colField!;
				const state = this.engine.stateManager.getState();
				const newModel: FilterModel = { ...(state.filterModel ?? {}) };
				if (newFilter == null) delete newModel[colField];
				else newModel[colField] = newFilter;
				this.engine.stateManager.setState({ filterModel: Object.keys(newModel).length > 0 ? newModel : null });
				this.engine.invalidation.invalidateFull('floating-filter');
			};
			const setFilter2 = currentFilter?.type === 'set' ? currentFilter : null;
			if ((setFilter2 && !hasBadge) || (!setFilter2 && !hasEmpty)) {
				cell.innerHTML = '';
				const colField = cell.dataset.colField ?? '';
				const colForBadge = colField
					? ((this.engine.columns.getCompiledPlan().displayedColumns.find((c) => (c as InternalColumnDef<TRowData>).field === colField) as
							| InternalColumnDef<TRowData>
							| undefined) ?? null)
					: null;
				this.buildSetBadge(cell, colForBadge, setFilter2, setFilter);
			}
			return;
		}

		const input = cell.querySelector('input') as HTMLInputElement | null;
		if (!input) return;

		if (document.activeElement === input) return; // don't override while user types

		if (!currentFilter) {
			if (input.value !== '') input.value = '';
			return;
		}

		if (currentFilter.type === 'text' && inputType === 'text') {
			const v = (currentFilter as TextFilterCondition).value ?? '';
			if (input.value !== v) input.value = v;
		} else if (currentFilter.type === 'number' && inputType === 'number') {
			const v = (currentFilter as NumberFilterCondition).value;
			const s = v != null ? String(v) : '';
			if (input.value !== s) input.value = s;
		} else if (currentFilter.type === 'date' && inputType === 'date') {
			const v = (currentFilter as DateFilterCondition).dateFrom ?? '';
			if (input.value !== v) input.value = v;
		}
	}

	private clearCells(): void {
		for (const cell of this.cells.values()) cell.remove();
		this.cells.clear();
		this.lastVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1 };
		this.lastScrollLeft = 0;
		this.lastSyncedViewportWidth = -1;
		this.lastLeftTransform = '';
		this.lastRightLeft = -1;
		this.lastRightTransform = '';
		this.lastFilterModel = null;
	}
}

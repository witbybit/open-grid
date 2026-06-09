import { CellSlot, toPx } from './cellSlot.js';

export class RowSlot<TRowData = unknown> {
	public readonly id: string;
	public readonly element: HTMLDivElement;

	public visualIndex = -1;
	public visualRowId = '';
	public rowKind: 'data' | 'group' | 'detail' | 'loading' | 'footer' | '' = '';
	public rowTop = -1;
	public rowHeight = -1;

	// Integer comparisons are faster than string comparisons
	public lastTop = -1;
	public lastHeight = -1;
	public lastClassName = '';
	public lastVisualIndex = -2; // distinct from -1 so first update always fires
	public lastVisualRowId = '\0'; // guaranteed != any real rowId on first update

	public keepAlive = false;

	public pinLeftContainer: HTMLDivElement | null = null;
	public pinRightContainer: HTMLDivElement | null = null;
	public pinLeftContainerWidth = -1;
	public pinRightContainerWidth = -1;
	public pinLeftContainerTransform = '';
	public pinRightContainerLeft = -1;
	public pinRightContainerTransform = '';

	// ── Phase 5: Stable lane-based cell slots ───────────────────────────────────────
	// Replace the old `cells: Map<number, CellSlot>` with three fixed-length arrays —
	// one per pin lane. During normal scroll none of these change length, so zero
	// cell DOM append/remove occurs.
	//
	// Indices:
	//   leftCells[i]   ↔  columns[i]                   (i in 0..pinLeftCount-1)
	//   centerCells[i] ↔  columns[centerColStart + i]   (i in 0..centerCells.length-1)
	//   rightCells[i]  ↔  columns[pinRightStart + i]    (i in 0..rightCells.length-1)

	public readonly leftCells: CellSlot<TRowData>[] = [];
	public readonly centerCells: CellSlot<TRowData>[] = [];
	public readonly rightCells: CellSlot<TRowData>[] = [];

	// Column-layout metadata updated each frame — needed for getCellForCol() lookups.
	public centerColStart = 0;
	public pinLeftCount = 0;
	public pinRightStart = Number.MAX_SAFE_INTEGER;

	constructor(id: string, element: HTMLDivElement) {
		this.id = id;
		this.element = element;
	}

	// ── Lookup ───────────────────────────────────────────────────────────────────────

	/**
	 * Return the CellSlot for a given column index, or undefined if the column is
	 * outside every active lane.
	 */
	public getCellForCol(colIndex: number): CellSlot<TRowData> | undefined {
		if (colIndex < this.pinLeftCount) return this.leftCells[colIndex];
		if (colIndex >= this.pinRightStart) {
			const i = colIndex - this.pinRightStart;
			return i < this.rightCells.length ? this.rightCells[i] : undefined;
		}
		const i = colIndex - this.centerColStart;
		if (i < 0 || i >= this.centerCells.length) return undefined;
		return this.centerCells[i];
	}

	// ── Lane resize helpers ──────────────────────────────────────────────────────────

	/**
	 * Ensure the left lane has exactly n CellSlots, all children of `container`.
	 * `initFn` is called on each newly created element.
	 * `releaseFn` is called before removing any existing slot (portal cleanup etc.).
	 */
	public ensureLeftCells(
		n: number,
		container: HTMLDivElement | null,
		initFn: (el: HTMLDivElement) => void,
		releaseFn: (cell: CellSlot<TRowData>) => void
	): void {
		if (!container) {
			n = 0; // no container → no left cells
		}
		while (this.leftCells.length < n) {
			const el = document.createElement('div');
			initFn(el);
			container!.appendChild(el);
			this.leftCells.push(CellSlot.fromElement<TRowData>(el));
		}
		while (this.leftCells.length > n) {
			const cell = this.leftCells.pop()!;
			releaseFn(cell);
			if (cell.element.parentNode) cell.element.remove();
		}
	}

	/**
	 * Ensure the center lane has exactly n CellSlots, all direct children of `element`.
	 */
	public ensureCenterCells(n: number, initFn: (el: HTMLDivElement) => void, releaseFn: (cell: CellSlot<TRowData>) => void): void {
		while (this.centerCells.length < n) {
			const el = document.createElement('div');
			initFn(el);
			this.element.appendChild(el);
			this.centerCells.push(CellSlot.fromElement<TRowData>(el));
		}
		while (this.centerCells.length > n) {
			const cell = this.centerCells.pop()!;
			releaseFn(cell);
			if (cell.element.parentNode) cell.element.remove();
		}
	}

	/**
	 * Ensure the right lane has exactly n CellSlots, all children of `container`.
	 */
	public ensureRightCells(
		n: number,
		container: HTMLDivElement | null,
		initFn: (el: HTMLDivElement) => void,
		releaseFn: (cell: CellSlot<TRowData>) => void
	): void {
		if (!container) {
			n = 0;
		}
		while (this.rightCells.length < n) {
			const el = document.createElement('div');
			initFn(el);
			container!.appendChild(el);
			this.rightCells.push(CellSlot.fromElement<TRowData>(el));
		}
		while (this.rightCells.length > n) {
			const cell = this.rightCells.pop()!;
			releaseFn(cell);
			if (cell.element.parentNode) cell.element.remove();
		}
	}

	/** Iterate every CellSlot across all three lanes. */
	public forEachCell(fn: (cell: CellSlot<TRowData>) => void): void {
		for (const c of this.leftCells) fn(c);
		for (const c of this.centerCells) fn(c);
		for (const c of this.rightCells) fn(c);
	}

	/** Total live cell count across all lanes. */
	public get cellCount(): number {
		return this.leftCells.length + this.centerCells.length + this.rightCells.length;
	}

	/**
	 * Backward-compat shim: builds a Map<colIndex, CellSlot> on-demand.
	 * Used by legacy tests and external code that still references slot.cells.
	 * O(n) — don't call in hot paths.
	 * @deprecated Use getCellForCol() or lane arrays directly.
	 */
	public get cells(): {
		size: number;
		get(key: number): CellSlot<TRowData> | undefined;
		has(key: number): boolean;
		entries(): IterableIterator<[number, CellSlot<TRowData>]>;
		values(): IterableIterator<CellSlot<TRowData>>;
		keys(): IterableIterator<number>;
		forEach(fn: (value: CellSlot<TRowData>, key: number) => void): void;
	} {
		const map = new Map<number, CellSlot<TRowData>>();
		for (let i = 0; i < this.leftCells.length; i++) map.set(i, this.leftCells[i]);
		const cs = this.centerColStart;
		for (let i = 0; i < this.centerCells.length; i++) map.set(cs + i, this.centerCells[i]);
		for (let i = 0; i < this.rightCells.length; i++) map.set(this.pinRightStart + i, this.rightCells[i]);
		return map;
	}

	// ── Row position / identity ──────────────────────────────────────────────────────

	public update(
		visualIndex: number,
		visualRowId: string,
		rowKind: 'data' | 'group' | 'detail' | 'loading' | 'footer',
		rowTop: number,
		rowHeight: number,
		className: string
	): boolean {
		let domUpdated = false;

		this.visualIndex = visualIndex;
		this.visualRowId = visualRowId;
		this.rowKind = rowKind;
		this.rowTop = rowTop;
		this.rowHeight = rowHeight;

		if (this.lastTop !== rowTop) {
			this.lastTop = rowTop;
			this.element.style.top = toPx(rowTop);
			domUpdated = true;
		}
		if (this.lastHeight !== rowHeight) {
			this.lastHeight = rowHeight;
			this.element.style.height = toPx(rowHeight);
			domUpdated = true;
		}

		if (this.lastVisualIndex !== visualIndex) {
			this.lastVisualIndex = visualIndex;
			this.element.dataset.rowIndex = String(visualIndex);
			domUpdated = true;
		}
		if (this.lastVisualRowId !== visualRowId) {
			this.lastVisualRowId = visualRowId;
			this.element.dataset.rowId = visualRowId;
			domUpdated = true;
		}
		if (this.lastClassName !== className) {
			this.lastClassName = className;
			this.element.className = className;
			domUpdated = true;
		}

		return domUpdated;
	}

	public updatePosition(rowTop: number): void {
		this.rowTop = rowTop;
		if (this.lastTop !== rowTop) {
			this.lastTop = rowTop;
			this.element.style.top = toPx(rowTop);
		}
	}

	/**
	 * Hot unbind — clears row identity but leaves DOM elements and cell slots mounted.
	 * Used when a slot is temporarily hidden (e.g. row count drops below pool size
	 * mid-frame before ensureSlotCount shrinks the pool).
	 */
	public unbindHot(): void {
		this.visualIndex = -1;
		this.visualRowId = '';
		this.rowKind = '';
		this.rowTop = -1;
		this.rowHeight = -1;
		this.keepAlive = false;
		// Cell slots remain mounted — they will be rebound on next renderViewport.
	}

	/**
	 * Cold destroy — full DOM reset. Called when the pool shrinks.
	 * Releases all cell content and removes the element from the DOM after the call.
	 */
	public destroyCold(): void {
		this.visualIndex = -1;
		this.visualRowId = '';
		this.rowKind = '';
		this.rowTop = -1;
		this.rowHeight = -1;
		this.keepAlive = false;
		this.lastTop = -1;
		this.lastHeight = -1;
		this.lastClassName = '';
		this.centerColStart = 0;
		this.pinLeftCount = 0;
		this.pinRightStart = Number.MAX_SAFE_INTEGER;

		// Unbind all cell slots (element will be removed by pool)
		for (const cell of this.leftCells) cell.unbindCold();
		this.leftCells.length = 0;
		for (const cell of this.centerCells) cell.unbindCold();
		this.centerCells.length = 0;
		for (const cell of this.rightCells) cell.unbindCold();
		this.rightCells.length = 0;

		this.element.className = '';
		this.element.removeAttribute('style');
		delete this.element.dataset.rowIndex;
		delete this.element.dataset.rowId;
		delete this.element.dataset.rowKey;
		this.element.textContent = '';
		this.pinLeftContainer = null;
		this.pinRightContainer = null;
		this.pinLeftContainerWidth = -1;
		this.pinRightContainerWidth = -1;
		this.pinLeftContainerTransform = '';
		this.pinRightContainerLeft = -1;
		this.pinRightContainerTransform = '';
	}
}

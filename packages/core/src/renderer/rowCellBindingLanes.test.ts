// @vitest-environment jsdom
/**
 * Behavioral verification tests for Plan 118: Stable CellView Ownership.
 *
 * These tests document and enforce the core invariants of the stable ownership model:
 *  1. One rendered column has at most one CellSlot per RowSlot (no duplicates).
 *  2. Lane changes relocate a CellSlot; they do not destroy or recreate it.
 *  3. React/portal identity (cellInstanceId) survives pinning, unpinning, and lane moves.
 *  4. Structural acquire/release only occurs when columns genuinely enter/exit.
 *  5. reconcileCellTopologyForScroll never calls releaseFn and keeps cellsByColumnId authoritative.
 */
import { describe, expect, it, vi } from 'vitest';
import { RowSlot } from './rowSlot.js';
import { CellSlot } from './cellSlot.js';
import { reconcileTopology, reconcileCellTopologyForScroll } from './rowCellBindingLanes.js';
import type { ColumnDef, CompiledGridPlan } from '../columnDef.js';
import { compileColumnTopology, type CompiledColumnTopology } from './columnTopology.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCol(field: string): ColumnDef<unknown> {
	return { field } as ColumnDef<unknown>;
}

function makeRowSlot(id = 'slot-1'): RowSlot<unknown> {
	const el = document.createElement('div');
	return new RowSlot(id, el);
}

function makeContainer(): HTMLDivElement {
	return document.createElement('div');
}

const initCell = (el: HTMLDivElement): void => {
	el.className = 'og-cell';
};

/** Builds a CompiledColumnTopology from simple lane-membership parameters for testing. */
function makeTopology(cols: ColumnDef<unknown>[], pinLeftCount: number, pinRightCount: number, pinRightStart: number): CompiledColumnTopology {
	const colWidth = 100;
	const colCount = cols.length;
	const colLefts = cols.map((_, i) => i * colWidth);
	const colWidths = cols.map(() => colWidth);
	const pinLeftWidth = pinLeftCount * colWidth;
	const pinRightBaseLeft = pinRightStart * colWidth;
	const pinRightWidth = pinRightCount * colWidth;
	const totalWidth = colCount * colWidth;
	return compileColumnTopology({
		displayedColumns: cols,
		colLefts,
		colWidths,
		pinLeftCount,
		pinRightStart,
		pinRightCount,
		pinLeftWidth,
		pinRightWidth,
		pinRightBaseLeft,
		totalWidth,
		version: 1,
	} as unknown as CompiledGridPlan<unknown>);
}

// ── cellInstanceId invariants ──────────────────────────────────────────────────

// ── WS2: columnId set at construction time ────────────────────────────────────

describe('reconcileTopology — WS2 columnId ownership', () => {
	it('sets columnId on each cell at construction time', () => {
		const slot = makeRowSlot();
		const aCols = [makeCol('a'), makeCol('b'), makeCol('c')];
		reconcileTopology(slot, makeTopology(aCols, 0, 0, 3), null, 0, 3, null, aCols, initCell, vi.fn());

		expect(slot.cellsByColumnId.get('a')!.columnId).toBe('a');
		expect(slot.cellsByColumnId.get('b')!.columnId).toBe('b');
		expect(slot.cellsByColumnId.get('c')!.columnId).toBe('c');
	});

	it('columnId survives lane relocation — same cell, same id', () => {
		const slot = makeRowSlot();
		const cols = [makeCol('name'), makeCol('price'), makeCol('qty')];
		reconcileTopology(slot, makeTopology(cols, 0, 0, 3), null, 0, 3, null, cols, initCell, vi.fn());

		const cell = slot.cellsByColumnId.get('name')!;
		expect(cell.columnId).toBe('name');

		// Pin name to left
		const left = makeContainer();
		slot.element.appendChild(left);
		reconcileTopology(slot, makeTopology(cols, 1, 0, 3), left, 1, 2, null, cols, initCell, vi.fn());

		// Same cell — columnId unchanged
		expect(cell.columnId).toBe('name');
		expect(slot.cellsByColumnId.get('name')).toBe(cell);
	});

	it('columnId is not set for pre-existing cells (idempotent)', () => {
		const slot = makeRowSlot();
		const xyCols = [makeCol('x'), makeCol('y')];
		reconcileTopology(slot, makeTopology(xyCols, 0, 0, 2), null, 0, 2, null, xyCols, initCell, vi.fn());

		// Second reconcile — cells already exist, columnId should still be correct
		reconcileTopology(slot, makeTopology(xyCols, 0, 0, 2), null, 0, 2, null, xyCols, initCell, vi.fn());

		expect(slot.cellsByColumnId.get('x')!.columnId).toBe('x');
		expect(slot.cellsByColumnId.get('y')!.columnId).toBe('y');
	});
});

describe('CellSlot.cellInstanceId', () => {
	it('is unique across distinct CellSlot constructions', () => {
		const a = new CellSlot(document.createElement('div'));
		const b = new CellSlot(document.createElement('div'));
		expect(a.cellInstanceId).not.toBe(b.cellInstanceId);
	});

	it('is stable across unbindHot() / unbindCold() / reset()', () => {
		const cell = new CellSlot(document.createElement('div'));
		const id = cell.cellInstanceId;

		cell.unbindHot();
		expect(cell.cellInstanceId).toBe(id);

		cell.unbindCold();
		expect(cell.cellInstanceId).toBe(id);

		cell.reset();
		expect(cell.cellInstanceId).toBe(id);
	});

	it('fromElement() returns the same instance (same cellInstanceId) for the same element', () => {
		const el = document.createElement('div');
		const first = CellSlot.fromElement(el);
		const second = CellSlot.fromElement(el);
		expect(first).toBe(second);
		expect(first.cellInstanceId).toBe(second.cellInstanceId);
	});

	it('fromElement() on a fresh element produces a new cellInstanceId', () => {
		const a = CellSlot.fromElement(document.createElement('div'));
		const b = CellSlot.fromElement(document.createElement('div'));
		expect(a.cellInstanceId).not.toBe(b.cellInstanceId);
	});
});

// ── reconcileTopology — core ownership invariants ────────────────────────────

describe('reconcileTopology — Plan 118 core invariants', () => {
	const columns = [makeCol('name'), makeCol('price'), makeCol('qty')];

	function run(
		slot: RowSlot<unknown>,
		opts: {
			pinLeft?: number;
			pinLeftContainer?: HTMLDivElement | null;
			centerColStart?: number;
			centerColCount?: number;
			pinRight?: number;
			pinRightStart?: number;
			pinRightContainer?: HTMLDivElement | null;
			cols?: ColumnDef<unknown>[];
			releaseFn?: (cell: CellSlot<unknown>) => void;
		} = {}
	): void {
		const cols = opts.cols ?? columns;
		const pinLeft = opts.pinLeft ?? 0;
		const pinRight = opts.pinRight ?? 0;
		const colCount = cols.length;
		const pinRightStart = opts.pinRightStart ?? colCount - pinRight;
		const topology = makeTopology(cols, pinLeft, pinRight, pinRightStart);

		reconcileTopology(
			slot,
			topology,
			opts.pinLeftContainer ?? null,
			opts.centerColStart ?? 0,
			opts.centerColCount ?? colCount,
			opts.pinRightContainer ?? null,
			cols,
			initCell,
			opts.releaseFn ?? vi.fn()
		);
	}

	// ── Invariant 1: one cell per column ──────────────────────────────────────

	it('creates exactly one CellSlot per column in the topology', () => {
		const slot = makeRowSlot();
		run(slot, { centerColCount: 3 });

		expect(slot.cellsByColumnId.size).toBe(3);
		expect(slot.centerCells).toHaveLength(3);
		expect(slot.leftCells).toHaveLength(0);
		expect(slot.rightCells).toHaveLength(0);
	});

	it('does not create duplicate cells after a second reconciliation with unchanged topology', () => {
		const slot = makeRowSlot();
		run(slot, { centerColCount: 3 });
		const idsAfterFirst = [...slot.cellsByColumnId.values()].map((c) => c.cellInstanceId);

		run(slot, { centerColCount: 3 });
		const idsAfterSecond = [...slot.cellsByColumnId.values()].map((c) => c.cellInstanceId);

		expect(idsAfterSecond).toEqual(idsAfterFirst);
		expect(slot.cellsByColumnId.size).toBe(3);
	});

	// ── Invariant 2: lane change relocates, does not recreate ─────────────────

	it('pin-left: cell for column 0 survives lane move — same cellInstanceId', () => {
		const slot = makeRowSlot();
		// Initial: all 3 center
		run(slot, { centerColCount: 3 });
		const originalId = slot.cellsByColumnId.get('name')!.cellInstanceId;

		// Pin column 0 to left
		const leftContainer = makeContainer();
		slot.element.appendChild(leftContainer);
		run(slot, {
			pinLeft: 1,
			pinLeftContainer: leftContainer,
			centerColStart: 1,
			centerColCount: 2,
		});

		const cell = slot.cellsByColumnId.get('name')!;
		expect(cell.cellInstanceId).toBe(originalId);
		expect(slot.leftCells[0]).toBe(cell);
		expect(slot.centerCells).toHaveLength(2);
	});

	it('unpin: cell returns to center — same cellInstanceId, no recreate', () => {
		const slot = makeRowSlot();
		const leftContainer = makeContainer();
		slot.element.appendChild(leftContainer);

		// Pin
		run(slot, {
			pinLeft: 1,
			pinLeftContainer: leftContainer,
			centerColStart: 1,
			centerColCount: 2,
		});
		const pinnedId = slot.cellsByColumnId.get('name')!.cellInstanceId;

		// Unpin
		run(slot, { centerColCount: 3 });

		const cell = slot.cellsByColumnId.get('name')!;
		expect(cell.cellInstanceId).toBe(pinnedId);
		expect(slot.leftCells).toHaveLength(0);
		expect(slot.centerCells[0]).toBe(cell);
	});

	it('center → left → right → center: cellInstanceId stable throughout', () => {
		const slot = makeRowSlot();
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];

		// All center
		reconcileTopology(slot, makeTopology(cols, 0, 0, 3), null, 0, 3, null, cols, initCell, vi.fn());
		const idA = slot.cellsByColumnId.get('a')!.cellInstanceId;

		// Pin 'a' left
		const left = makeContainer();
		slot.element.appendChild(left);
		reconcileTopology(slot, makeTopology(cols, 1, 0, 3), left, 1, 2, null, cols, initCell, vi.fn());
		expect(slot.cellsByColumnId.get('a')!.cellInstanceId).toBe(idA);

		// Now 'a' to right (simulate by making it the last column with pin-right)
		const right = makeContainer();
		slot.element.appendChild(right);
		const colsReordered = [makeCol('b'), makeCol('c'), makeCol('a')];
		reconcileTopology(slot, makeTopology(colsReordered, 0, 1, 2), null, 0, 2, right, colsReordered, initCell, vi.fn());
		expect(slot.cellsByColumnId.get('a')!.cellInstanceId).toBe(idA);

		// Back to center
		reconcileTopology(slot, makeTopology(cols, 0, 0, 3), null, 0, 3, null, cols, initCell, vi.fn());
		expect(slot.cellsByColumnId.get('a')!.cellInstanceId).toBe(idA);
	});

	// ── Invariant 3: relocation moves DOM element, preserves portal host ──────

	it('pin-left: DOM element of relocated cell is a child of pinLeftContainer', () => {
		const slot = makeRowSlot();
		const leftContainer = makeContainer();
		slot.element.appendChild(leftContainer);

		run(slot, { centerColCount: 3 });
		// Initially center
		const cell = slot.cellsByColumnId.get('name')!;
		expect(cell.element.parentNode).toBe(slot.element);

		// Pin to left
		run(slot, {
			pinLeft: 1,
			pinLeftContainer: leftContainer,
			centerColStart: 1,
			centerColCount: 2,
		});
		expect(cell.element.parentNode).toBe(leftContainer);
	});

	it('portalHostElement (if created) survives lane relocation intact', () => {
		const slot = makeRowSlot();
		const leftContainer = makeContainer();
		slot.element.appendChild(leftContainer);

		run(slot, { centerColCount: 3 });
		const cell = slot.cellsByColumnId.get('name')!;
		const portalHost = cell.getOrCreatePortalHost();

		// Pin to left
		run(slot, {
			pinLeft: 1,
			pinLeftContainer: leftContainer,
			centerColStart: 1,
			centerColCount: 2,
		});

		// Same portal host element — not recreated
		expect(cell.portalHostElement).toBe(portalHost);
		// Portal host is still inside the cell element, even though cell moved containers
		expect(cell.element.contains(portalHost)).toBe(true);
	});

	// ── Invariant 4: structural release only when column truly exits ──────────

	it('releaseFn is not called when a column merely changes lanes', () => {
		const slot = makeRowSlot();
		const leftContainer = makeContainer();
		slot.element.appendChild(leftContainer);
		const releaseFn = vi.fn();

		run(slot, { centerColCount: 3 });
		run(slot, {
			pinLeft: 1,
			pinLeftContainer: leftContainer,
			centerColStart: 1,
			centerColCount: 2,
			releaseFn,
		});

		expect(releaseFn).not.toHaveBeenCalled();
	});

	it('releaseFn is called exactly once when a column exits the topology', () => {
		const slot = makeRowSlot();
		const releaseFn = vi.fn();

		run(slot, { centerColCount: 3 }); // [name, price, qty]
		const qtyCell = slot.cellsByColumnId.get('qty')!;
		run(slot, { centerColCount: 2, releaseFn }); // [name, price] only — qty exits

		expect(releaseFn).toHaveBeenCalledTimes(1);
		expect(releaseFn.mock.calls[0][0]).toBe(qtyCell);
		expect(slot.cellsByColumnId.has('qty')).toBe(false);
	});

	it('releaseFn is not called when pinning an existing column', () => {
		const slot = makeRowSlot();
		const leftContainer = makeContainer();
		slot.element.appendChild(leftContainer);
		const releaseFn = vi.fn();

		// First paint establishes 3 center cells
		run(slot, { centerColCount: 3 });
		// Second paint pins 'name' to left — no release should fire
		run(slot, {
			pinLeft: 1,
			pinLeftContainer: leftContainer,
			centerColStart: 1,
			centerColCount: 2,
			releaseFn,
		});

		expect(releaseFn).not.toHaveBeenCalled();
	});

	// ── Invariant 5: cellsByColumnId is the lifecycle owner ──────────────────

	it('lane arrays are derived views — cellsByColumnId is the source of truth', () => {
		const slot = makeRowSlot();
		const leftContainer = makeContainer();
		slot.element.appendChild(leftContainer);

		run(slot, { centerColCount: 3 });
		const nameCellFromMap = slot.cellsByColumnId.get('name')!;

		// Pin name to left
		run(slot, {
			pinLeft: 1,
			pinLeftContainer: leftContainer,
			centerColStart: 1,
			centerColCount: 2,
		});

		// Map still has the same cell
		expect(slot.cellsByColumnId.get('name')).toBe(nameCellFromMap);
		// Lane array also has the same cell
		expect(slot.leftCells[0]).toBe(nameCellFromMap);
	});

	// ── reconcileCellTopologyForScroll ────────────────────────────────────────

	describe('reconcileCellTopologyForScroll', () => {
		const cols5 = [makeCol('a'), makeCol('b'), makeCol('c'), makeCol('d'), makeCol('e')];

		it('never calls releaseFn — cells leaving the window stay in map but detach from DOM', () => {
			const slot = makeRowSlot();
			const topo = makeTopology(cols5, 0, 0, 5);
			// Full paint: establish 3 center cells [0,1,2]
			reconcileTopology(slot, topo, null, 0, 3, null, cols5, initCell, vi.fn());

			const cellA = slot.cellsByColumnId.get('a')!;
			const cellB = slot.cellsByColumnId.get('b')!;

			// Scroll to [2,3,4] — cols [0,1] exit the window, col [4] enters
			reconcileCellTopologyForScroll(slot, topo, null, 2, 3, null, cols5, initCell);

			// Exited columns stay in cellsByColumnId (lifecycle ownership preserved)
			expect(slot.cellsByColumnId.has('a')).toBe(true);
			expect(slot.cellsByColumnId.has('b')).toBe(true);
			// Their DOM elements are detached (no DOM bloat during scroll)
			expect(cellA.element.parentNode).toBeNull();
			expect(cellB.element.parentNode).toBeNull();
			// New column entered the window and was created
			expect(slot.cellsByColumnId.has('e')).toBe(true);
		});

		it('reuses existing cell instances for columns scrolling back into view', () => {
			const slot = makeRowSlot();
			const topo = makeTopology(cols5, 0, 0, 5);
			reconcileTopology(slot, topo, null, 0, 3, null, cols5, initCell, vi.fn());

			const instanceA = slot.cellsByColumnId.get('a')!;
			const instanceB = slot.cellsByColumnId.get('b')!;

			// Scroll forward past a and b
			reconcileCellTopologyForScroll(slot, topo, null, 2, 3, null, cols5, initCell);
			// Scroll back to include a and b
			reconcileCellTopologyForScroll(slot, topo, null, 0, 3, null, cols5, initCell);

			// Same instances reused — no new allocations
			expect(slot.cellsByColumnId.get('a')).toBe(instanceA);
			expect(slot.cellsByColumnId.get('b')).toBe(instanceB);
		});

		it('cellsByColumnId stays authoritative — lane array is a derived view', () => {
			const slot = makeRowSlot();
			const topo = makeTopology(cols5, 0, 0, 5);
			reconcileTopology(slot, topo, null, 0, 3, null, cols5, initCell, vi.fn());

			reconcileCellTopologyForScroll(slot, topo, null, 1, 3, null, cols5, initCell);

			// centerCells is the current window [b,c,d]
			expect(slot.centerCells).toHaveLength(3);
			expect(slot.centerCells[0]).toBe(slot.cellsByColumnId.get('b'));
			expect(slot.centerCells[1]).toBe(slot.cellsByColumnId.get('c'));
			expect(slot.centerCells[2]).toBe(slot.cellsByColumnId.get('d'));
		});

		it('pinned cells are always included regardless of center window', () => {
			const cols4 = [makeCol('pin'), makeCol('a'), makeCol('b'), makeCol('c')];
			const slot = makeRowSlot();
			const left = makeContainer();
			slot.element.appendChild(left);
			const topo = makeTopology(cols4, 1, 0, 4);
			reconcileTopology(slot, topo, left, 1, 2, null, cols4, initCell, vi.fn());

			const pinCell = slot.cellsByColumnId.get('pin')!;

			// Scroll center window
			reconcileCellTopologyForScroll(slot, topo, left, 2, 1, null, cols4, initCell);

			// Pinned cell survives in both map and leftCells
			expect(slot.cellsByColumnId.get('pin')).toBe(pinCell);
			expect(slot.leftCells[0]).toBe(pinCell);
		});
	});

	// ── destroyCold with cellsByColumnId ──────────────────────────────────────

	describe('RowSlot.destroyCold() with stable ownership', () => {
		it('unbinds cells from both map and lane arrays via defensive union', () => {
			const slot = makeRowSlot();
			const leftContainer = makeContainer();
			slot.element.appendChild(leftContainer);

			run(slot, { centerColCount: 3 });

			// Add a cell to the lane that isn't in the map (external caller edge case)
			const driftCell = new CellSlot(document.createElement('div'));
			driftCell.colField = 'drift';
			slot.centerCells.push(driftCell);
			// cellsByColumnId does NOT contain driftCell

			const unbindSpy = vi.spyOn(driftCell, 'unbindCold');

			slot.destroyCold();

			// Even the drift cell (not in map) must be unbound
			expect(unbindSpy).toHaveBeenCalled();
			expect(slot.cellsByColumnId.size).toBe(0);
			expect(slot.leftCells).toHaveLength(0);
			expect(slot.centerCells).toHaveLength(0);
			expect(slot.rightCells).toHaveLength(0);
		});
	});
});

// ── Horizontal scroll topology stability (Plan 119) ──────────────────────────

describe('reconcileCellTopologyForScroll — horizontal scroll topology stability', () => {
	it('left and right pinned cells are unchanged when center window shifts', () => {
		const cols = [makeCol('pin-l'), makeCol('a'), makeCol('b'), makeCol('c'), makeCol('pin-r')];
		const slot = makeRowSlot();
		const left = makeContainer();
		const right = makeContainer();
		slot.element.appendChild(left);
		slot.element.appendChild(right);

		// pinRightStart = 4 (last column)
		const topo = makeTopology(cols, 1, 1, 4);
		reconcileTopology(slot, topo, left, 1, 3, right, cols, initCell, vi.fn());

		const leftCell = slot.leftCells[0];
		const rightCell = slot.rightCells[0];

		// Scroll center window forward
		reconcileCellTopologyForScroll(slot, topo, left, 2, 2, right, cols, initCell);

		expect(slot.leftCells[0]).toBe(leftCell);
		expect(slot.rightCells[0]).toBe(rightCell);
		expect(slot.leftCells[0].columnId).toBe('pin-l');
		expect(slot.rightCells[0].columnId).toBe('pin-r');
	});

	it('center cells update to reflect the new window; out-of-window cells are detached but retained in map', () => {
		const cols5 = [makeCol('a'), makeCol('b'), makeCol('c'), makeCol('d'), makeCol('e')];
		const slot = makeRowSlot();
		const topo = makeTopology(cols5, 0, 0, 5);
		reconcileTopology(slot, topo, null, 0, 3, null, cols5, initCell, vi.fn());

		// Cells a,b,c are in the window
		const cellA = slot.cellsByColumnId.get('a')!;
		const cellC = slot.cellsByColumnId.get('c')!;

		// Scroll forward: window becomes [c, d, e]
		reconcileCellTopologyForScroll(slot, topo, null, 2, 3, null, cols5, initCell);

		// centerCells reflects new window exactly
		expect(slot.centerCells).toHaveLength(3);
		expect(slot.centerCells[0]).toBe(cellC);
		expect(slot.centerCells[1]).toBe(slot.cellsByColumnId.get('d'));
		expect(slot.centerCells[2]).toBe(slot.cellsByColumnId.get('e'));

		// Out-of-window cell 'a' is still owned
		expect(slot.cellsByColumnId.get('a')).toBe(cellA);
		// But detached from DOM (no parent)
		expect(cellA.element.parentNode).toBeNull();
	});

	it('forward then backward scroll returns to original center window with same cell instances', () => {
		const cols5 = [makeCol('a'), makeCol('b'), makeCol('c'), makeCol('d'), makeCol('e')];
		const slot = makeRowSlot();
		const topo = makeTopology(cols5, 0, 0, 5);
		reconcileTopology(slot, topo, null, 0, 3, null, cols5, initCell, vi.fn());

		const snapBefore = slot.centerCells.map((c) => c.cellInstanceId);

		// Scroll forward past a and b
		reconcileCellTopologyForScroll(slot, topo, null, 2, 3, null, cols5, initCell);
		// Scroll back to original window
		reconcileCellTopologyForScroll(slot, topo, null, 0, 3, null, cols5, initCell);

		const snapAfter = slot.centerCells.map((c) => c.cellInstanceId);
		expect(snapAfter).toEqual(snapBefore);
	});
});

// ── Pinning one column never blanks unrelated cells ──────────────────────────

describe('reconcileTopology — unrelated column stability', () => {
	it('cells for unrelated columns retain same instance after a single-column pin', () => {
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		const slot = makeRowSlot();

		reconcileTopology(slot, makeTopology(cols, 0, 0, 3), null, 0, 3, null, cols, initCell, vi.fn());
		const idB = slot.cellsByColumnId.get('b')!.cellInstanceId;
		const idC = slot.cellsByColumnId.get('c')!.cellInstanceId;

		// Pin 'a' — 'b' and 'c' should be unaffected
		const left = makeContainer();
		slot.element.appendChild(left);
		reconcileTopology(slot, makeTopology(cols, 1, 0, 3), left, 1, 2, null, cols, initCell, vi.fn());

		expect(slot.cellsByColumnId.get('b')!.cellInstanceId).toBe(idB);
		expect(slot.cellsByColumnId.get('c')!.cellInstanceId).toBe(idC);
	});
});

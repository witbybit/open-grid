// @vitest-environment jsdom
/**
 * Behavioral verification tests for Plan 118: Stable CellView Ownership.
 *
 * These tests document and enforce the core invariants of the stable ownership model:
 *  1. One rendered column has at most one CellSlot per RowSlot (no duplicates).
 *  2. Lane changes relocate a CellSlot; they do not destroy or recreate it.
 *  3. React/portal identity (cellInstanceId) survives pinning, unpinning, and lane moves.
 *  4. Structural acquire/release only occurs when columns genuinely enter/exit.
 *  5. syncCellsByColumnId correctly repairs map drift after scroll-time ensure* usage.
 */
import { describe, expect, it, vi } from 'vitest';
import { RowSlot } from './rowSlot.js';
import { CellSlot } from './cellSlot.js';
import { reconcileTopology, syncCellsByColumnId } from './rowCellBindingLanes.js';
import type { ColumnDef } from '../columnDef.js';

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

// ── cellInstanceId invariants ──────────────────────────────────────────────────

// ── WS2: columnId set at construction time ────────────────────────────────────

describe('reconcileTopology — WS2 columnId ownership', () => {
	it('sets columnId on each cell at construction time', () => {
		const slot = makeRowSlot();
		reconcileTopology(slot, 0, null, 0, 3, 0, 3, null, [makeCol('a'), makeCol('b'), makeCol('c')], initCell, vi.fn());

		expect(slot.cellsByColumnId.get('a')!.columnId).toBe('a');
		expect(slot.cellsByColumnId.get('b')!.columnId).toBe('b');
		expect(slot.cellsByColumnId.get('c')!.columnId).toBe('c');
	});

	it('columnId survives lane relocation — same cell, same id', () => {
		const slot = makeRowSlot();
		const cols = [makeCol('name'), makeCol('price'), makeCol('qty')];
		reconcileTopology(slot, 0, null, 0, 3, 0, 3, null, cols, initCell, vi.fn());

		const cell = slot.cellsByColumnId.get('name')!;
		expect(cell.columnId).toBe('name');

		// Pin name to left
		const left = makeContainer();
		slot.element.appendChild(left);
		reconcileTopology(slot, 1, left, 1, 2, 0, 3, null, cols, initCell, vi.fn());

		// Same cell — columnId unchanged
		expect(cell.columnId).toBe('name');
		expect(slot.cellsByColumnId.get('name')).toBe(cell);
	});

	it('columnId is not set for pre-existing cells (idempotent)', () => {
		const slot = makeRowSlot();
		reconcileTopology(slot, 0, null, 0, 2, 0, 2, null, [makeCol('x'), makeCol('y')], initCell, vi.fn());

		// Second reconcile — cells already exist, columnId should still be correct
		reconcileTopology(slot, 0, null, 0, 2, 0, 2, null, [makeCol('x'), makeCol('y')], initCell, vi.fn());

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
		reconcileTopology(
			slot,
			opts.pinLeft ?? 0,
			opts.pinLeftContainer ?? null,
			opts.centerColStart ?? 0,
			opts.centerColCount ?? (opts.cols ?? columns).length,
			opts.pinRight ?? 0,
			opts.pinRightStart ?? (opts.cols ?? columns).length,
			opts.pinRightContainer ?? null,
			opts.cols ?? columns,
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
		reconcileTopology(slot, 0, null, 0, 3, 0, 3, null, cols, initCell, vi.fn());
		const idA = slot.cellsByColumnId.get('a')!.cellInstanceId;

		// Pin 'a' left
		const left = makeContainer();
		slot.element.appendChild(left);
		reconcileTopology(slot, 1, left, 1, 2, 0, 3, null, cols, initCell, vi.fn());
		expect(slot.cellsByColumnId.get('a')!.cellInstanceId).toBe(idA);

		// Now 'a' to right (simulate by making it the last column with pin-right)
		const right = makeContainer();
		slot.element.appendChild(right);
		const colsReordered = [makeCol('b'), makeCol('c'), makeCol('a')];
		reconcileTopology(slot, 0, null, 0, 2, 1, 2, right, colsReordered, initCell, vi.fn());
		expect(slot.cellsByColumnId.get('a')!.cellInstanceId).toBe(idA);

		// Back to center
		reconcileTopology(slot, 0, null, 0, 3, 0, 3, null, cols, initCell, vi.fn());
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

	// ── syncCellsByColumnId ────────────────────────────────────────────────────

	describe('syncCellsByColumnId', () => {
		// Helper: simulate what the bind loop does — sets colField on each cell.
		// reconcileTopology keys the map by column field but does NOT set cell.colField;
		// that is the bind loop's job (via cellSlot.update()). syncCellsByColumnId reads
		// cell.colField, so tests must populate it first to match production conditions.
		function simulateBindLoop(slot: RowSlot<unknown>): void {
			for (const [field, cell] of slot.cellsByColumnId) {
				cell.colField = field;
			}
		}

		it('rebuilds cellsByColumnId from lane arrays, repairing scroll-time drift', () => {
			const slot = makeRowSlot();
			run(slot, { centerColCount: 3 });
			simulateBindLoop(slot);

			// Simulate scroll drift: the map has stale entries but lane arrays are current
			const nameCellFromLane = slot.centerCells[0]; // cells[0] = 'name' column
			expect(nameCellFromLane.colField).toBe('name');
			slot.cellsByColumnId.clear(); // drift: map emptied, lane arrays unchanged

			syncCellsByColumnId(slot);

			expect(slot.cellsByColumnId.get('name')).toBe(nameCellFromLane);
			expect(slot.cellsByColumnId.size).toBe(3);
		});

		it('uses the cell colField property, not lane position, for the key', () => {
			const slot = makeRowSlot();
			run(slot, { centerColCount: 3 });

			// Set colField on only one cell to verify key-by-field, not key-by-index
			const nameCell = slot.centerCells[0];
			nameCell.colField = 'name';
			// centerCells[1] and [2] have colField = '' — should be skipped

			slot.cellsByColumnId.clear();
			syncCellsByColumnId(slot);

			expect(slot.cellsByColumnId.get('name')).toBe(nameCell);
			expect(slot.cellsByColumnId.size).toBe(1);
		});

		it('skips cells with empty colField (unbound cells)', () => {
			const slot = makeRowSlot();
			run(slot, { centerColCount: 3 });
			simulateBindLoop(slot); // all get colField set

			// Unset one cell's colField to simulate an unbound cell in the lane
			slot.centerCells[0].colField = '';

			slot.cellsByColumnId.clear();
			syncCellsByColumnId(slot);

			// Only the two cells with non-empty colField are indexed
			expect(slot.cellsByColumnId.size).toBe(2);
		});
	});

	// ── destroyCold with cellsByColumnId ──────────────────────────────────────

	describe('RowSlot.destroyCold() with stable ownership', () => {
		it('unbinds cells from both map and lane arrays via union (handles scroll drift)', () => {
			const slot = makeRowSlot();
			const leftContainer = makeContainer();
			slot.element.appendChild(leftContainer);

			run(slot, { centerColCount: 3 });

			// Simulate scroll drift: add a cell to a lane that isn't in the map
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

// ── Pinning one column never blanks unrelated cells ──────────────────────────

describe('reconcileTopology — unrelated column stability', () => {
	it('cells for unrelated columns retain same instance after a single-column pin', () => {
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		const slot = makeRowSlot();

		reconcileTopology(slot, 0, null, 0, 3, 0, 3, null, cols, initCell, vi.fn());
		const idB = slot.cellsByColumnId.get('b')!.cellInstanceId;
		const idC = slot.cellsByColumnId.get('c')!.cellInstanceId;

		// Pin 'a' — 'b' and 'c' should be unaffected
		const left = makeContainer();
		slot.element.appendChild(left);
		reconcileTopology(slot, 1, left, 1, 2, 0, 3, null, cols, initCell, vi.fn());

		expect(slot.cellsByColumnId.get('b')!.cellInstanceId).toBe(idB);
		expect(slot.cellsByColumnId.get('c')!.cellInstanceId).toBe(idC);
	});
});

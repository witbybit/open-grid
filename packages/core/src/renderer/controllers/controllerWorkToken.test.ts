// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { captureControllerWorkToken, isControllerWorkStillValid } from './controllerWorkToken.js';
import { createCellCtrl } from './CellCtrl.js';
import { CellSlot } from '../cellSlot.js';

describe('ControllerWorkToken', () => {
	it('is valid immediately after capture, against the same CellCtrl', () => {
		const cellCtrl = createCellCtrl('r1', 'coli1' as any, 'price');
		cellCtrl.attachedSlotInstanceId = 'ci1';
		cellCtrl.attachedRowBindingGeneration = 0;

		const token = captureControllerWorkToken(cellCtrl, 5);
		expect(token.frame).toBe(5);
		expect(isControllerWorkStillValid(token, cellCtrl)).toBe(true);
	});

	it('is invalid when the row id no longer matches (a different logical row now owns this CellCtrl reference)', () => {
		const cellCtrl = createCellCtrl('r1', 'coli1' as any, 'price');
		const token = captureControllerWorkToken(cellCtrl);
		const rebound = createCellCtrl('r2', 'coli1' as any, 'price');
		expect(isControllerWorkStillValid(token, rebound)).toBe(false);
	});

	it('is invalid when the column instance changed (semantic replacement — new column at same field)', () => {
		const cellCtrl = createCellCtrl('r1', 'coli1' as any, 'price');
		const token = captureControllerWorkToken(cellCtrl);
		const replaced = createCellCtrl('r1', 'coli2' as any, 'price');
		expect(isControllerWorkStillValid(token, replaced)).toBe(false);
	});

	it('is invalid when currentCellCtrl is undefined (controller no longer exists)', () => {
		const cellCtrl = createCellCtrl('r1', 'coli1' as any, 'price');
		const token = captureControllerWorkToken(cellCtrl);
		expect(isControllerWorkStillValid(token, undefined)).toBe(false);
	});

	it('is invalid after a row rebind bumps rowBindingGeneration, even though rowId/columnInstanceId are unchanged strings', () => {
		// Simulates: async work captures a token, then the physical CellSlot is recycled to a
		// different row before the work resolves, then (coincidentally or via row-id reuse) a
		// CellCtrl with the same rowId/columnInstanceId is attached again — the generation mismatch
		// must still catch this, since attachedSlotInstanceId/attachedRowBindingGeneration are what
		// actually reflect "is this still the same physical binding", not the logical ids alone.
		const cellCtrl = createCellCtrl('r1', 'coli1' as any, 'price');
		cellCtrl.attachedSlotInstanceId = 'ci1';
		cellCtrl.attachedRowBindingGeneration = 0;
		const token = captureControllerWorkToken(cellCtrl);

		// Simulate the slot being hot-unbound (row rebind) and then this exact CellCtrl re-attached
		// to the recycled slot at its new generation.
		cellCtrl.attachedRowBindingGeneration = 1;
		expect(isControllerWorkStillValid(token, cellCtrl)).toBe(false);
	});

	it('consistency: agrees with the same generation-counter mechanism CellSlot/portalMountManager.ts use directly', () => {
		// Build a real CellSlot and drive its rowBindingGeneration the same way unbindHot() does,
		// proving ControllerWorkToken's validity check tracks the identical signal
		// portalMountManager.ts's isSamePhysicalIdentity (rowSlotId + slotGeneration +
		// cellRowBindingGeneration) already relies on — not a second, independently-drifting guard.
		const cellSlot = new CellSlot(document.createElement('div'));
		const cellCtrl = createCellCtrl('r1', 'coli1' as any, 'price');
		cellCtrl.attachedSlotInstanceId = cellSlot.cellInstanceId;
		cellCtrl.attachedRowBindingGeneration = cellSlot.rowBindingGeneration;
		const token = captureControllerWorkToken(cellCtrl);

		expect(isControllerWorkStillValid(token, cellCtrl)).toBe(true);

		// Row rebind: same physical slot, recycled to a different row.
		cellSlot.unbindHot();
		expect(cellSlot.rowBindingGeneration).toBe(1);

		// The binder's next attachCellCtrl() call would update attachedRowBindingGeneration to the
		// slot's new generation before any new work is scheduled — simulate that update here and
		// confirm the OLD token (captured before the rebind) is now correctly rejected.
		cellCtrl.attachedRowBindingGeneration = cellSlot.rowBindingGeneration;
		expect(isControllerWorkStillValid(token, cellCtrl)).toBe(false);
	});
});

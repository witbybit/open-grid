import type { ColumnInstanceId } from '../../columnDef.js';
import type { CellCtrl } from './CellCtrl.js';

/**
 * Captured identity for a CellCtrl at the moment some deferred/async work is scheduled against it —
 * a live-mount frame-budget deferral, a fidelity repair, an html-snapshot capture, a portal commit
 * callback. Built on the SAME generation-counter mechanism CellSlot/portalMountManager.ts already
 * use (`rowBindingGeneration` / `isSamePhysicalIdentity`) — this is not a second, parallel
 * stale-guard, it is that mechanism exposed at the controller level so callers who only have a
 * CellCtrl (not a raw CellSlot/portalMountManager identity record) can still validate later.
 */
export interface ControllerWorkToken {
	/** ViewportPlan.frame at capture time, if known — a monotonic per-frame sequence number. -1 when
	 *  captured outside a render frame (e.g. from a test or a non-render-loop caller). */
	readonly frame: number;
	readonly rowId: string;
	readonly columnInstanceId: ColumnInstanceId;
	/** CellSlot.cellInstanceId this CellCtrl was attached to at capture time. */
	readonly attachedSlotInstanceId: string | undefined;
	/** CellSlot.rowBindingGeneration at capture time — bumped by CellSlot.unbindHot() whenever the
	 *  physical slot is recycled to a different row. If this no longer matches when the work is
	 *  ready to apply, the slot has moved on and the work must be discarded. */
	readonly attachedRowBindingGeneration: number;
}

export function captureControllerWorkToken(cellCtrl: CellCtrl, frame: number = -1): ControllerWorkToken {
	return {
		frame,
		rowId: cellCtrl.rowId,
		columnInstanceId: cellCtrl.columnInstanceId,
		attachedSlotInstanceId: cellCtrl.attachedSlotInstanceId,
		attachedRowBindingGeneration: cellCtrl.attachedRowBindingGeneration,
	};
}

/**
 * True only if `currentCellCtrl` is still the same logical cell, still attached to the same
 * physical slot, at the same row-binding generation as when the token was captured. Any mismatch
 * means the row/cell has been recycled since the work was scheduled and the result must be
 * discarded rather than applied.
 */
export function isControllerWorkStillValid(token: ControllerWorkToken, currentCellCtrl: CellCtrl | undefined): boolean {
	if (!currentCellCtrl) return false;
	if (currentCellCtrl.rowId !== token.rowId) return false;
	if (currentCellCtrl.columnInstanceId !== token.columnInstanceId) return false;
	if (currentCellCtrl.attachedSlotInstanceId !== token.attachedSlotInstanceId) return false;
	if (currentCellCtrl.attachedRowBindingGeneration !== token.attachedRowBindingGeneration) return false;
	return true;
}

/**
 * Collision-safe renderer key helpers.
 *
 * Uses length-prefix encoding so that a row ID containing ":", "@", or any other
 * delimiter cannot collide with a different split of the same string.
 *
 * Example: createEditRendererKey("a:b", "c") ≠ createEditRendererKey("a", "b:c")
 *   "E3:a:b1:c"  vs  "E1:a3:b:c"  — guaranteed distinct.
 */

export type RendererKey = string;

function encodePart(value: string): string {
	return `${value.length}:${value}`;
}

/**
 * Editing-mode renderer key. Anchors the React instance to the logical cell (rowId + colField).
 * Use when isEditing = true so the editor tree is never reused across rows.
 */
export function createEditRendererKey(rowId: string, columnInstanceId: ColumnInstanceId): RendererKey {
	return `E${encodePart(rowId)}${encodePart(columnInstanceId)}`;
}

/**
 * Slot-bound renderer key. Anchors the React/DOM instance to a physical row slot + column.
 * Use for the recycle-pool and index-pool strategies (non-editing).
 */
export function createSlotRendererKey(slotId: string, columnInstanceId: ColumnInstanceId): RendererKey {
	return `S${encodePart(slotId)}${encodePart(columnInstanceId)}`;
}

/**
 * Cell-instance renderer key. Anchors the portal cellKey to the specific physical CellSlot
 * object (via its `cellInstanceId`). Unlike the slot key, this key becomes invalid if the
 * cell is ever destroyed — preventing stale deferred releases from targeting a new cell
 * created at the same row/column position. Use this as the `cellKey` in portal mount calls.
 */
export function createCellInstanceRendererKey(cellInstanceId: string, columnInstanceId: ColumnInstanceId): RendererKey {
	return `C${encodePart(cellInstanceId)}${encodePart(columnInstanceId)}`;
}

/**
 * Index-based renderer key. Fallback when no stable slot ID is available.
 */
export function createIndexRendererKey(rowIndex: number, colIndex: number, columnInstanceId: ColumnInstanceId): RendererKey {
	return `I${encodePart(columnInstanceId)}${encodePart(String(rowIndex))}${encodePart(String(colIndex))}`;
}

/**
 * DOM renderer slot-bound key (prefix "DS" disambiguates from React slot key).
 */
export function createDomSlotRendererKey(slotId: string, columnInstanceId: ColumnInstanceId): RendererKey {
	return `DS${encodePart(columnInstanceId)}${encodePart(slotId)}`;
}

/**
 * DOM renderer index-based key fallback.
 */
export function createDomIndexRendererKey(rowIndex: number, colIndex: number, columnInstanceId: ColumnInstanceId): RendererKey {
	return `DI${encodePart(columnInstanceId)}${encodePart(String(rowIndex))}${encodePart(String(colIndex))}`;
}

/**
 * General-purpose key builder when the strategy is determined at call-site.
 */
export function createRendererKey(params: {
	strategy: 'edit' | 'slot' | 'index' | 'dom-slot' | 'dom-index' | 'cell-instance';
	rowId?: string;
	columnInstanceId: ColumnInstanceId;
	slotId?: string;
	cellInstanceId?: string;
	rowIndex?: number;
	colIndex?: number;
}): RendererKey {
	switch (params.strategy) {
		case 'edit':
			return createEditRendererKey(params.rowId ?? '', params.columnInstanceId);
		case 'slot':
			return createSlotRendererKey(params.slotId ?? '', params.columnInstanceId);
		case 'cell-instance':
			return createCellInstanceRendererKey(params.cellInstanceId ?? '', params.columnInstanceId);
		case 'index':
			return createIndexRendererKey(params.rowIndex ?? 0, params.colIndex ?? 0, params.columnInstanceId);
		case 'dom-slot':
			return createDomSlotRendererKey(params.slotId ?? '', params.columnInstanceId);
		case 'dom-index':
			return createDomIndexRendererKey(params.rowIndex ?? 0, params.colIndex ?? 0, params.columnInstanceId);
	}
}
import type { ColumnInstanceId } from '../columnDef.js';

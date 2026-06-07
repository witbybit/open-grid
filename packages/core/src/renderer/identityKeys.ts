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
export function createEditRendererKey(rowId: string, colField: string): RendererKey {
	return `E${encodePart(rowId)}${encodePart(colField)}`;
}

/**
 * Slot-bound renderer key. Anchors the React/DOM instance to a physical row slot + column.
 * Use for the recycle-pool and index-pool strategies (non-editing).
 */
export function createSlotRendererKey(slotId: string, colField: string): RendererKey {
	return `S${encodePart(slotId)}${encodePart(colField)}`;
}

/**
 * Index-based renderer key. Fallback when no stable slot ID is available.
 */
export function createIndexRendererKey(rowIndex: number, colIndex: number, colField: string): RendererKey {
	return `I${encodePart(colField)}${encodePart(String(rowIndex))}${encodePart(String(colIndex))}`;
}

/**
 * DOM renderer slot-bound key (prefix "DS" disambiguates from React slot key).
 */
export function createDomSlotRendererKey(slotId: string, colField: string): RendererKey {
	return `DS${encodePart(colField)}${encodePart(slotId)}`;
}

/**
 * DOM renderer index-based key fallback.
 */
export function createDomIndexRendererKey(rowIndex: number, colIndex: number, colField: string): RendererKey {
	return `DI${encodePart(colField)}${encodePart(String(rowIndex))}${encodePart(String(colIndex))}`;
}

/**
 * General-purpose key builder when the strategy is determined at call-site.
 */
export function createRendererKey(params: {
	strategy: 'edit' | 'slot' | 'index' | 'dom-slot' | 'dom-index';
	rowId?: string;
	colField: string;
	slotId?: string;
	rowIndex?: number;
	colIndex?: number;
}): RendererKey {
	switch (params.strategy) {
		case 'edit':
			return createEditRendererKey(params.rowId ?? '', params.colField);
		case 'slot':
			return createSlotRendererKey(params.slotId ?? '', params.colField);
		case 'index':
			return createIndexRendererKey(params.rowIndex ?? 0, params.colIndex ?? 0, params.colField);
		case 'dom-slot':
			return createDomSlotRendererKey(params.slotId ?? '', params.colField);
		case 'dom-index':
			return createDomIndexRendererKey(params.rowIndex ?? 0, params.colIndex ?? 0, params.colField);
	}
}

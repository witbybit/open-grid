import type { ColumnInstanceId } from '../../columnDef.js';
import type { CellContentMode } from '../cellSlot.js';
import type { VisualFreshness } from '../visualFreshness.js';

export type CellControllerKey = string & { readonly __brand: 'CellControllerKey' };

export function createCellControllerKey(rowId: string, columnInstanceId: ColumnInstanceId): CellControllerKey {
	return `${rowId}::${columnInstanceId}` as CellControllerKey;
}

/**
 * Semantic identity + freshness for one logical (rowId, columnInstanceId) cell — independent of
 * which physical CellSlot currently renders it. Owns the bookkeeping the binder/resolver pipeline
 * needs to reason about identity and staleness; owns none of the DOM.
 *
 * Deliberately does NOT replace resolveScrollCellPresentation's decision tree (see
 * scrollCellPresentation.ts) — this is populated by an attach/reuse step that runs alongside the
 * existing resolver, not instead of it. `lastResolvedFreshness`/`lastResolvedContentMode` reuse the
 * existing VisualFreshness model and CellContentMode union rather than inventing new ones.
 */
export interface CellCtrl {
	readonly key: CellControllerKey;
	readonly rowId: string;
	readonly columnInstanceId: ColumnInstanceId;
	/** Convenience denormalization — avoids a ColumnModel lookup on every hot-path read. */
	readonly field: string;

	/** Freshness this controller's presentation was last resolved against. Compared via
	 *  isVisualFresh (visualFreshness.ts) — no new freshness model invented. */
	lastResolvedFreshness: VisualFreshness | undefined;

	/** Which physical CellSlot (by CellSlot.cellInstanceId) is currently rendering this logical
	 *  cell. Undefined when virtualized out. Read-only pointer — CellCtrl does not own CellSlot
	 *  lifecycle (RowSlot/RowSlotPool do); this exists so a re-attach can find its own prior state. */
	attachedSlotInstanceId: string | undefined;

	/** Mirrors CellSlot.rowBindingGeneration at last attach — reuses the existing generation-counter
	 *  stale-guard (see cellSlot.ts, portalMountManager.ts's isSamePhysicalIdentity) rather than
	 *  inventing a second one. A deferred async op capturing this value can compare it later to
	 *  detect the slot was recycled to a different row in between. */
	attachedRowBindingGeneration: number;

	/** Last resolved ScrollCellPresentation's effective content mode — for controller-reuse tests
	 *  and telemetry. Not a cache of the full presentation object; that stays cheap to recompute. */
	lastResolvedContentMode: CellContentMode | undefined;

	/** Mirrors the same ctx.activeEdit / ctx.focusedCell checks the binder already performs —
	 *  denormalized here so vertical row retention and future dispatch logic don't need the full
	 *  ScrollRenderContext threaded through them. */
	isEditing: boolean;
	isFocused: boolean;
}

export function createCellCtrl(rowId: string, columnInstanceId: ColumnInstanceId, field: string): CellCtrl {
	return {
		key: createCellControllerKey(rowId, columnInstanceId),
		rowId,
		columnInstanceId,
		field,
		lastResolvedFreshness: undefined,
		attachedSlotInstanceId: undefined,
		attachedRowBindingGeneration: -1,
		lastResolvedContentMode: undefined,
		isEditing: false,
		isFocused: false,
	};
}

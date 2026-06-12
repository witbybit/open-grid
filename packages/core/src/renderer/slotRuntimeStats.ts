/**
 * Phase 10 — Runtime stats for the slot-based viewport virtualization model.
 *
 * All counters reflect actual operations. No fake zeros — if a counter is 0
 * it means the corresponding operation truly did not happen in that frame.
 */
export interface SlotRuntimeStats {
	// ── Slot counts ───────────────────────────────────────────────────────────────
	rowSlotCount: number;
	cellSlotCount: number;

	// ── Per-scroll-frame binding work ─────────────────────────────────────────────
	rowSlotBindsDuringScroll: number;
	cellSlotBindsDuringScroll: number;

	// ── DOM structural changes (should be 0 during steady-state scroll) ───────────
	rowDomAppendsDuringScroll: number;
	rowDomRemovesDuringScroll: number;
	cellDomAppendsDuringScroll: number;
	cellDomRemovesDuringScroll: number;

	// ── Bailouts ──────────────────────────────────────────────────────────────────
	sameWindowBailouts: number;

	// ── Mode switches ─────────────────────────────────────────────────────────────
	fullWidthModeSwitchesDuringScroll: number;

	// ── Custom renderer lifecycle during scroll ───────────────────────────────────
	customRebindsDuringScroll: number;
	customWarmMovesDeferredDuringScroll: number;
	customWarmMovesFlushedAfterScroll: number;
	customColdMountsDuringScroll: number;

	// ── Legacy counters (backward compat) ─────────────────────────────────────────
	rowSlotAppendsTotal: number;
	rowSlotRemovesTotal: number;
	cellAppendsTotal: number;
	cellRemovesTotal: number;
	fullRebindFrames: number;
	enteredOnlyFrames: number;
}

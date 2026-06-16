# Plan 047: Enterprise header-drag column reorder polish

## Status

- **Priority**: P2 (UX polish)
- **Effort**: S (landed subset); live column-shifting deferred
- **Risk**: LOW (CSS + small controller logic)
- **Planned at**: 2026-06-14
- **Status**: **DONE (2026-06-14)** — drop-indicator glide + ghost entrance, **plus live column-shifting + seamless on-drop settle**. See "Live column shifting" below.

## Goal

Make drag-to-reorder feel enterprise-grade: smooth drop indicator, fluid drag ghost, and (future) live column shifting + on-drop settle.

## What landed (`columnInteractionController.ts`, `styles.ts`)

- **Drop indicator glides** between insertion points instead of jumping: CSS `transition: transform … + opacity` enabled via an `og-indicator-ready` class. The controller positions the **first** placement instantly (transition suppressed + reflow) so it never flies in from the left edge, then enables the glide + fades it in. `indicatorShown` flag, reset in `removeColumnDropIndicator`.
- **Drag ghost fades in** on pickup (`@keyframes og-drag-ghost-in`, opacity only — position stays JS/transform-driven so the entrance doesn't fight it).
- Existing lifted-cell spring + dimmed non-dragging columns retained.

## Live column shifting + seamless on-drop settle (DONE 2026-06-14)

AG-Grid-style: during a header drag, every center-lane column between the dragged
column's origin and the current insertion point slides aside to open the gap; header
and body move in lockstep, gliding via CSS transitions. The drop is **seamless with no
FLIP pass** — see the trick below.

### Mechanism

- **`computeColumnReorderShifts(colWidths, fromIndex, gapIndex, pinLeft, pinRight)`**
  (pure, exported from `columnInteractionController.ts`, unit-tested in
  `columnReorderShifts.test.ts`) returns, per displayed column, the delta from its
  CURRENT left to the left it will occupy AFTER the move (prefix-sum of the reordered
  widths). Only center-lane columns shift; if the dragged column or target is pinned it
  returns all-zeros (reorder still happens on drop, just no live preview).
- **The seamless-drop trick**: the previewed offset is _exactly_ the post-`moveColumn`
  position. The controller nulls the shifts in `cleanup()` BEFORE calling `moveColumn`,
  so the reorder repaint writes `left = newLeft, transform = 0` — the same pixel the
  cell already occupied during the preview. Nothing jumps; no capture/inverse FLIP.
- **Header**: `getColumnShift(cell.colStart)` is folded into the leaf-cell positioning
  transform in `headerRenderer.ts`. The existing `.og-header-cell-movable { transition:
transform }` makes it glide + settle.
- **Body**: threaded through the bind path — `RowCellBinderDeps.getColumnShift` →
  `bindCellFull` → `cellSlot.update(..., dragShift)` writes `transform: translateX(shift)`
  composed on top of the cell's `left`. Wired RenderEngine → `rowRenderer.columnShiftSource`
  → bridge deps. Guarded by `cellSlot.lastShift` so steady-state binds never touch
  transform (the scroll bind path is untouched — no drag co-occurs with scroll).
- **Repaint trigger**: the controller's `schedulePaint` is wired to `scheduleFullPaint`
  (was header-only) so header + body re-bind with new shifts; bounded to discrete
  insertion-index changes, not per pixel.
- **CSS** (`styles.ts`): `.og-col-reordering .og-cell { transition: transform }` for the
  body glide; the non-dragging header dim lightened (0.38 → 0.55) so the parting stays
  visible. Both transitions are scoped to `.og-col-reordering`, which never tags a
  scroll/resize frame.

### Verification note

core 590/590 (8 new shift-math tests) + react 70/70, core/react/demo builds clean. The
drag machinery (reordering class, ghost, gliding indicator, shift computation) was
confirmed live in-browser; the final RAF-driven repaint could not be visually exercised
because the preview tab runs hidden (RAF paused). Eyeball the glide/settle in a
foreground browser.

## Notes

- Indicator/ghost are recreated per drag (`cleanup()` removes both), so the first-placement guard is per-drag.

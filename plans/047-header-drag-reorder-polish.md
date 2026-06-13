# Plan 047: Enterprise header-drag column reorder polish

## Status

- **Priority**: P2 (UX polish)
- **Effort**: S (landed subset); live column-shifting deferred
- **Risk**: LOW (CSS + small controller logic)
- **Planned at**: 2026-06-14
- **Status**: **PARTIAL — drop-indicator glide + ghost entrance DONE (2026-06-14)**. core 582/582, react 85/85, demo build clean.

## Goal

Make drag-to-reorder feel enterprise-grade: smooth drop indicator, fluid drag ghost, and (future) live column shifting + on-drop settle.

## What landed (`columnInteractionController.ts`, `styles.ts`)

- **Drop indicator glides** between insertion points instead of jumping: CSS `transition: transform … + opacity` enabled via an `og-indicator-ready` class. The controller positions the **first** placement instantly (transition suppressed + reflow) so it never flies in from the left edge, then enables the glide + fades it in. `indicatorShown` flag, reset in `removeColumnDropIndicator`.
- **Drag ghost fades in** on pickup (`@keyframes og-drag-ghost-in`, opacity only — position stays JS/transform-driven so the entrance doesn't fight it).
- Existing lifted-cell spring + dimmed non-dragging columns retained.

## Deferred (larger, higher-risk follow-ups)

- **Live column shifting**: columns sliding aside under the cursor to preview the drop (AG-Grid style). Needs per-column translateX across all rows during the drag (FLIP-like, reparent-on-drop), touching the drag-time render path — its own focused effort.
- **On-drop settle (FLIP)**: animate the moved column into place after `moveColumn` instead of snapping. Header cells are positioned by `left` (not transform), so a clean settle needs a FLIP pass; deferred to avoid transitioning `left` on every scroll/resize.

## Notes

- Indicator/ghost are recreated per drag (`cleanup()` removes both), so the first-placement guard is per-drag.

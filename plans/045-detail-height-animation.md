# Plan 045: Detail / full-width row height animation

## Status

- **Priority**: P2 (animation polish; completes Plan 043 Phase 3)
- **Effort**: S
- **Risk**: LOW (extends the existing WAAPI transition controller; gated off the hot path)
- **Depends on**: Plan 043 (LayoutTransitionController enter/exit + exit ghosts)
- **Planned at**: 2026-06-14
- **Status**: **DONE (2026-06-14, branch rendering-architecture-v2-wip-3)**. core 582/582, react 85/85, demo build clean.

## Goal

Master-detail (and any full-width `detail`) rows grow/shrink their height on expand/collapse instead of popping in/out, kept in sync with the rows below (which slide via the existing MOVE animation).

## What landed

- `LayoutTransitionController` snapshot entries now carry `{ top, height, kind, clone }` (read from `slot.lastHeight` / `slot.rowKind` at capture).
- **Enter (expand)**: a `detail` row animates `height: 0 → finalHeight` (+ opacity) with `overflow: hidden` during the grow, restored on settle. Because the rows below slide down by the same amount over the same duration, the detail's growing bottom edge stays glued to them.
- **Exit (collapse)**: a `detail` row's exit **ghost** (Plan 043 clone) animates `height: finalHeight → 0` (+ fade) with `overflow: hidden`, mirroring the grow.
- Non-detail rows keep the plain opacity fade/move. Feature-detected (jsdom/SSR/reduced-motion → instant). `cancel()` (scroll) still tears everything down.
- `run()` gained an `onSettle` callback (used to restore overflow).
- Tests: 2 cases in `layoutTransitionController.test.ts` (enter grow 0→h; exit ghost shrink h→0).

## Notes

- Group rows are header-height, so they keep the fade (no height animation needed). Only `kind === 'detail'` height-animates.
- Animating `height` reflows only that one row's box (rows are absolutely positioned via translateY), and only on a discrete toggle — no hot-path impact.

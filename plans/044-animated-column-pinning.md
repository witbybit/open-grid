# Plan 044: Animated column pinning (reparent FLIP via LayoutTransitionController)

> **Executor instructions**: Builds on Plan 039 Phase 4a (unified `columns.lanes` geometry) and the WAAPI `LayoutTransitionController`. Pin/unpin is a discrete user action — animate only on that, never on scroll. Do not reintroduce a second per-cell coordinate system; the lane geometry from the plan is the single source.
>
> Part of Plan 040 (north-star).

## Status

- **Priority**: P2 (animation polish; pinning correctness already done in 039 Phase 4a)
- **Effort**: M–L
- **Risk**: MEDIUM–HIGH (DOM reparent × `position: sticky` interaction, hot-path-adjacent rebind)
- **Depends on**: Plan 039 Phase 4a (`columns.lanes`), Phase 2 (`LayoutTransitionController`)
- **Category**: rendering, animation
- **Planned at**: 2026-06-14

## Problem

Pinning/unpinning a column is instant: the column's header + body cells reparent between the center lane and a pinned lane and the lane widths jump. Plan 039 Phase 4a made header + body share one lane geometry (`columns.lanes`) — the correctness fix — but pin/unpin still does not animate. `position: sticky` cannot be transitioned, so the move must be driven explicitly.

## Target architecture

### A. Horizontal transition through the existing controller

Generalize the transition pattern (used for vertical row move/enter/exit) to a **horizontal** column move:

1. On pin/unpin (a `columns`/`pinnedColumns` discrete state change), capture each affected header cell's and visible body cell's pre-reparent screen-x (FLIP "first").
2. Apply the new layout: cells reparent into their new lane; lane widths update from the new `columns.lanes`.
3. WAAPI-animate each affected cell `translateX(oldX − newX) → 0` (FLIP "invert→play"); animate the pinned-lane widths (`pinLeftWidth`/`pinRightWidth`) over the same duration.
4. `onfinish`/`cancel` → drop the transient transform; force-cancel on scroll start (same gate as all transitions). Reduced-motion/jsdom → instant.

Keep this in `LayoutTransitionController` as a `beginColumnPin(...)` primitive so there is one animation owner and one gate.

### B. Sticky-reparent safety

Body pin lanes use `position: sticky`. Animating a transform on a cell that is simultaneously reparenting into a sticky lane can fight the compositor. **Mitigation (STOP fallback)**: if the live reparent + sticky interaction is glitchy, animate on a temporary **absolutely-positioned clone** of the affected cells over the grid, swap to the real (now-sticky) cells on finish. The clone path is the robust fallback the plan pre-authorizes.

### C. Lane geometry is the only source

All start/end x-positions and lane widths come from `columns.lanes` (Plan 039 Phase 4a) — header and body interpolate the **same** numbers, so they cannot tear mid-animation. No new per-cell offset math.

## Execution phases

### Phase 0 — characterization

Lock current instant pin/unpin correctness (header+body aligned via `columns.lanes`). Verify green.

### Phase 1 — lane-width transition

Animate just the pinned-lane widths + header pin-layer widths on pin count change (no cell reparent yet) — the cheapest visible motion, validates the gate + geometry source.

### Phase 2 — cell reparent FLIP (live)

Capture screen-x, reparent, `beginColumnPin` translateX→0 for header + visible body cells. Try the live (in-place) reparent first.

### Phase 3 — clone fallback if needed

If Phase 2 glitches against sticky, switch to the absolute-clone-and-swap path (B). Pick one approach, document why.

### Phase 4 — guard + demo

Guard: no animation/transform set on a scroll frame; pin geometry still single-sourced from `columns.lanes`. Demo page pins/unpins left + right columns smoothly.

## Verification

```sh
corepack pnpm --filter @open-grid/core exec vitest run src/renderer/layoutTransitionController.test.ts src/renderer/headerRenderer.test.ts src/renderer/layoutPlan.test.ts
corepack pnpm --filter @open-grid/core test
corepack pnpm --filter @open-grid/react test
corepack pnpm --filter demo-app build
```

## Scope

In: `renderer/layoutTransitionController.ts`, `renderer/headerRenderer.ts`, body pin-lane binding (`rowCellBindingLanes.ts`), the pin-change invalidation hook (`RenderInvalidationCoordinator.ts`), `styles.ts`. Out: row lifecycle (043), pagination (041).

## Review checklist — reject if it:

- Sets an animation/transform on a scroll or data-tick frame.
- Recomputes pin x-positions/widths independently instead of reading `columns.lanes`.
- Reintroduces divergent header vs body pin geometry.
- Adds a second animation mechanism instead of extending `LayoutTransitionController`.

## STOP conditions

- Live reparent + `position: sticky` produce visible glitches mid-animation → use the absolute-clone-and-swap fallback (B); do not fight the compositor.
- Per-cell capture on wide grids costs measurable rebind time → cap animated cells to the visible window (pinned + center buffer) and `log()`/document the cap; never animate offscreen cells.

# Plan 043: Row lifecycle animation — slot exit pool + detail-row height

> **Executor instructions**: This completes Plan 039 Phase 3. It is hot-path-adjacent (touches the slot pool + portal release) — keep all exit work behind the discrete-change transition gate; never retain or animate slots on a scroll/data-tick frame. Build on the existing WAAPI `LayoutTransitionController`; do not introduce a second animation mechanism.
>
> Part of Plan 040 (north-star).

## Status

- **Priority**: P2 (animation polish; completes expand/collapse)
- **Effort**: M
- **Risk**: MEDIUM–HIGH (slot pool + full-width portal lifecycle)
- **Depends on**: Plan 039 Phase 2 (`LayoutTransitionController` move+enter), Phase 3 (expand/collapse arming)
- **Category**: rendering, animation
- **Planned at**: 2026-06-14
- **Status**: **Phases 1–2 DONE (2026-06-14, branch rendering-architecture-v2-wip-3)**; Phase 3 (detail/group height animation) deferred. core 580/580, react 85/85, demo build clean.
    - **Approach chosen — clone-ghost (not a slot-pool exit lane).** Touching the slot recycle path was avoided entirely. At `captureSnapshot` the controller deep-clones each visible row (cheap, discrete-action only); at `beginAnimation` it fades out (WAAPI opacity 1→0) the clones of rows that left, into a dedicated `.og-layer-exiting` overlay. This sidesteps the Phase-2 STOP risk: full-width/portal rows fade as static ghosts too, with no portal-manager changes.
    - **True-exit gate**: a captured row ghosts only if it's no longer rendered AND no longer in the model (`isRowIdLive` → `RowModel.getVisualIndexById(visualRowId) >= 0`). Rows that merely scrolled out of the window are not faded. Pagination/sort don't trigger exits (capture is wired to sort+expansion; collapse is the producer).
    - **Files**: `layoutTransitionController.ts` (clone snapshot + `playExits` + ghost teardown in `cancel`), `LayoutTransitionOptions` ({getExitLayer, isRowIdLive}); `layerRegistry.ts` (`exiting` static overlay layer, child of `rows`); `styles.ts` (`.og-layer-exiting`); `renderEngine.ts` wires the options. Guard test updated for the static overlay.
    - **Hot-path**: ghosts only exist during a discrete fade; `cancel()` (scroll start) removes them all — none survive a scroll frame. Stable-slot DOM invariant preserved (the overlay is a non-slot sibling; tests count slot children via `slotDomCount`).
    - Tests: 4 exit cases in `layoutTransitionController.test.ts` (fade on true exit; no fade on scroll-out; cancel removes ghosts; no-op without exit layer).
    - **Deferred — Phase 3**: detail-row/group height grow/shrink animation (needs an inner content wrapper). Separate, lower-priority polish.

## Problem

Expand/collapse currently animates **move** (displaced rows slide) and **enter** (revealed rows fade), but not **exit**: on collapse, the removed rows vanish instantly while the rows below slide up, because `RowSlotPool.ensureSlotCount` recycles a removed slot's DOM immediately (`renderer/rowSlotPool.ts:66-72`). Master-detail rows also pop in/out at full height instead of growing/shrinking. The transition system is half-complete.

## Target architecture

### A. Slot exit-retention lane

Generalize the slot pool so a removed-but-animating row's element persists until its exit animation finishes, then is released — without re-entering the active pool or scroll recycling.

- Add an **exit lane**: a small holding set (`renderer/rowExitLane.ts` or a field on the pool) of `{ element, lastTop, portalKey? }` captured at the moment a discrete change removes visible rows _with a transition armed_.
- The paint coordinator, when `pendingTransition` is set and the new render window drops rows that were present, moves those slots' elements into the exit lane (kept positioned at their old `translateY`), hands them to `LayoutTransitionController.beginExit(...)`, and releases them (DOM + portal) on `animation.finished` / `cancel()`.
- **Hard invariants**: exit-lane elements never re-enter the active pool; never participate in scroll recycling; are force-released on `cancel()` (scroll start) so none survive into a scroll frame. Exit lane is empty during steady-state scroll (assert in a perf characterization test).

### B. `LayoutTransitionController.beginExit`

Add an exit primitive alongside move/enter: WAAPI `opacity 1→0` (+ optional small `translateY`), `onfinish`/`oncancel` → release callback. Capture set already exists (`captureSnapshot` records pre-change rowIds+tops); the controller can compute the exit set as `snapshot rowIds − new rendered rowIds`. Feature-detected (reduced-motion/jsdom → release immediately, no animation).

### C. Detail-row (and group) height animation

Master-detail/group rows change the displayed height on toggle. Animate the **row's height**, not just opacity:

- Wrap full-width row content in an inner element so the row's outer height can animate (`0 → h` on enter, `h → 0` on exit) via WAAPI while the displaced rows below `move` in lockstep. Document this inner wrapper as the one justified extra element (per Plan 039 target architecture).
- Container total height is set to the final value instantly (scrollbar correctness); rows animate into place. The growing/shrinking detail row uses height/clip animation so it doesn't fight the `translateY` positioning.

## Execution phases

### Phase 0 — characterization

Lock current move+enter behavior; add a test asserting the exit lane is empty during scroll. Verify green.

### Phase 1 — exit lane + `beginExit` (opacity)

Add the exit-retention lane + `beginExit`; collapsed/filtered-out **data** rows fade out then release. Unit tests for the controller exit set; integration test that a collapsed group's child rows persist for the animation then are released (slot count returns to steady state).

### Phase 2 — full-width portal exit

Extend to group/detail full-width rows (portal-backed). This is the **STOP-risk** area (Plan 039 STOP #1): if the portal manager cannot keep a portal mounted on an exiting element without key collisions, ship Phase 1 (data-row exit) only and record the portal limitation.

### Phase 3 — detail/group height animation

Inner wrapper + height/clip WAAPI on enter/exit; displaced rows `move` in lockstep. Demo page exercises master-detail + nested group collapse/expand.

## Verification

```sh
corepack pnpm --filter @open-grid/core exec vitest run src/renderer/layoutTransitionController.test.ts src/renderer/rowSlotPool.test.ts
corepack pnpm --filter @open-grid/core test
corepack pnpm --filter @open-grid/react test
corepack pnpm --filter demo-app build
```

## Scope

In: `renderer/layoutTransitionController.ts`, `renderer/rowSlotPool.ts` (+ exit lane), `renderer/renderPaintCoordinator.ts`, full-width/portal release path, `styles.ts`. Out: pinning animation (044), pagination (041).

## Review checklist — reject if it:

- Retains or animates any slot on a scroll/data-tick frame.
- Lets an exit-lane element re-enter the active pool or scroll recycling.
- Skips force-release on `cancel()` (scroll start) — exiting rows must not survive into a scroll frame.
- Adds a second animation mechanism instead of extending `LayoutTransitionController`.
- Animates detail height by fighting the `translateY` transform instead of an inner wrapper.

## STOP conditions

- Full-width portal exit needs a portal-manager rewrite larger than expected → ship data-row exit (Phase 1) only, flag portal exit as follow-up.
- Height animation visibly fights pinned-column sticky inside full-width rows → animate an inner content wrapper, keep the row element's transform untouched.

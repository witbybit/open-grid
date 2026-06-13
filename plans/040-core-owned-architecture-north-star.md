# Plan 040: North-Star — core-owned grid architecture, thin React adapter

> **This is the umbrella/vision plan.** It does not ship code directly; it states the target architecture and sequences plans 041–044 (and the open items in 039). Read this first; execute the child plans in the recommended order. Each child plan is independently shippable and test-gated.

## Status

- **Priority**: P0 (architecture direction)
- **Effort**: XL (spans plans 041–044)
- **Risk**: MEDIUM–HIGH per child plan (hot-path + data-layer sensitive)
- **Depends on**: Plans 009 (layout plan), 011 (feature controllers), 039 (layer registry, four-edge chrome, WAAPI transitions, pin-lane unification) — all landed/partly landed
- **Planned at**: 2026-06-14, branch `rendering-architecture-v2-wip-3`

## The thesis

> **Core owns structure, data-shaping, and chrome. The React package is a thin adapter that renders what core produces and forwards user intent — it never reshapes data, never owns a feature's source of truth, and never computes layout.**

Today this is violated in one concrete, high-signal place: **client pagination is implemented in the React layer** — `Grid.tsx` slices `pagedClientRows` from the raw `rows` array _before_ handing them to the core grid (`packages/react/src/Grid.tsx:98-114,138-145`), and the pagination/status-bar UI lives entirely in React (`pagination.tsx` 234 lines, `GridStatusBar.tsx` 52 lines). Meanwhile core (Plan 039 Phase 5) now renders its own pagination + status-bar chrome that drives page **state + events but does not slice rows**. So pagination has **two brains**: a React one that actually slices, and a core one that displays. That is the architectural smell to remove.

The same principle generalizes:

| Concern                | Source of truth should be                   | Today                                              |
| ---------------------- | ------------------------------------------- | -------------------------------------------------- |
| Visible/paged row set  | Core row pipeline                           | **React slices `rows` in `Grid.tsx`** ❌           |
| Pagination UI          | Core layer registry (`og-layer-pagination`) | Core ✅ (since 039) + **React duplicate** ❌       |
| Status bar             | Core layer registry (`og-layer-status-bar`) | Core ✅ (since 039) + **React `GridStatusBar`** ❌ |
| Layout/chrome geometry | `GridLayoutPlan`                            | Core ✅                                            |
| Row/cell animation     | `LayoutTransitionController`                | Core ✅ (move+enter); exit/pin pending             |
| Custom cell rendering  | React portals                               | React ✅ (correct — this is genuine view)          |

The end state: the React adapter's only data responsibility is passing the user's `rows`/`columns`/`datasource` straight through. Everything that decides _which rows exist, where they sit, and what chrome surrounds them_ is core.

## Architectural invariants this vision adds (enforce via guard tests)

1. **The React adapter never derives a different row array than the user passed.** No `.slice`, `.filter`, `.sort`, or page-windowing of `rows` in `packages/react`. (Guard: a test/grep gate in `architectureGuards`-style test asserting `Grid.tsx` does not slice rows.)
2. **Feature UI that is structural chrome lives in the core layer registry**, not as React components users must compose. (Pagination, status bar, and future find-bar/loading-bar are core layers.)
3. **One source of truth per feature.** Pagination state, page math, and slicing all live in core; React forwards intent (or nothing) and reads results via the public API/events.
4. **The public surface shrinks, not grows.** Removing React pagination/status-bar exports is a deliberate API simplification; any capability they provided that we want to keep (e.g. custom status-bar panels) is re-exposed as a _core config_, not a React component.

## Child plans & recommended sequence

Execute in this order. Each is its own file with full phases/verification/STOP conditions.

1. **Plan 041 — Client pagination as a core row-pipeline page-window.**
   Move slicing into core: a `PageModel` + a final page-window step in `RowPipeline` (post-flatten, pre-index-map) so `visualRows` and _all_ derived maps/meta/geometry are page-consistent. Makes the core pagination bar (039 Phase 5) actually paginate. Defines cross-page semantics for grouping/tree/detail explicitly. **This is the prerequisite for the React teardown** — core must own client slicing before React's slicing can be deleted.

2. **Plan 042 — Remove the React-layer pagination + status bar.**
   Delete `pagination.tsx`, `GridStatusBar.tsx`, the `Grid.tsx` slicing/wrapper logic, the `pagination` prop + `GridPaginationOptions`, and the index/types exports; migrate demos to the core bars. Re-expose status-bar panel customization as a core config so no capability is silently lost. Thins the adapter — the headline "better architecture" deliverable.

3. **Plan 043 — Row lifecycle animation: slot exit pool + detail height** (completes 039 Phase 3).
   Collapsed/filtered-out rows fade/slide out instead of vanishing; master-detail rows animate height. Adds an exit-retention lane so the slot pool can release on `animation.finished`.

4. **Plan 044 — Animated column pinning** (completes 039 Phase 4b).
   Pin/unpin animates via reparent-FLIP through the existing `LayoutTransitionController`, on top of the unified `columns.lanes` geometry from 039 Phase 4a.

## Why this order

- 041 before 042: you cannot delete React's slicing until core slices (else client pagination regresses). 041 is also the highest-value open item (completes a feature the user asked for) and the linchpin of the thesis.
- 042 right after: with core authoritative, the teardown is pure subtraction — the biggest architecture-clarity win for the least risk.
- 043 and 044 are animation polish on already-landed foundations (transition controller, lane geometry); independent of pagination, sequenced last and orderable either way.

## Cross-cutting test strategy

- **Pure-model tests first** (pipeline page-window, page math) — fast, deterministic, the contract.
- **Renderer characterization** — bars reflect core state; geometry/render-window stay consistent under a page window.
- **Adapter guard tests** — React does not reshape rows; removed exports stay removed.
- Every child plan keeps **core + react + demo** green (current baseline: core 555, react 100).

## Maintenance note

After this lands, any new feature decision starts with: _"Where is the source of truth?"_ If it decides which rows exist, where they sit, or what chrome surrounds them → **core** (pipeline / layout plan / layer registry). Only genuine view concerns (custom cell content via portals) belong in React.

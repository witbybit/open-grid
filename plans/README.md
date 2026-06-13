# Plans

| #   | Plan                                                                                            | Status   | Commit       |
| --- | ----------------------------------------------------------------------------------------------- | -------- | ------------ |
| 001 | [Row Multi-Select](./001-row-multiselect.md)                                                    | DONE     | 3d32692      |
| 002 | [ColumnType Registry](./002-column-type-registry.md)                                            | DONE     | 970c777      |
| 003 | [Row Pipeline Tests](./003-row-pipeline-tests.md)                                               | DONE     | 970c777      |
| 004 | [Declarative Style Rules](./004-declarative-style-rules.md)                                     | DONE     | 970c777      |
| 005 | [Row Selection Class Set](./005-row-selection-class-set.md)                                     | DONE     | 66c92c2      |
| 006 | [Aggregation Stage Streaming](./006-aggregation-stage-streaming.md)                             | DONE     | 66c92c2      |
| 007 | [Grouped Pipeline Filter Allocation](./007-grouped-pipeline-filter-allocation.md)               | DONE     | 66c92c2      |
| 008 | [Row Transaction Diff Optimization](./008-row-transaction-diff-optimization.md)                 | DONE     | 66c92c2      |
| 009 | [Rendering Layout Architecture](./009-rendering-layout-architecture.md)                         | TODO     | 78e8122      |
| 010 | [Core Architecture Hardening](./010-core-architecture-hardening.md)                             | DONE     | 53fe61f      |
| 011 | [Feature Boundary Architecture](./011-feature-boundary-architecture.md)                         | DONE     | 39c83e3      |
| 012 | [Data Mutation Kernel Hardening](./012-data-mutation-kernel-hardening.md)                       | DONE     | 39c83e3      |
| 013 | [Thin Engine Effects Boundary](./013-thin-engine-effects-boundary.md)                           | DONE     | 94c9453      |
| 014 | [Runtime Port Inversion](./014-runtime-port-inversion.md)                                       | DONE     | 94c9453      |
| 015 | [Internal Adapter Boundary](./015-internal-adapter-boundary.md)                                 | DONE     | 0f93724      |
| 016 | [Store Runtime Decomposition](./016-store-runtime-decomposition.md)                             | DONE     | 6b3ecc5      |
| 017 | [Row Model Runtime Boundary](./017-row-model-runtime-boundary.md)                               | DONE     | bb60b76      |
| 018 | [Runtime Fault Diagnostics Boundary](./018-runtime-fault-diagnostics-boundary.md)               | DONE     | 4ee5ea4      |
| 019 | [Render Engine Orchestration Boundary](./019-render-engine-orchestration-boundary.md)           | DONE     | 37a3494      |
| 020 | [Row Renderer Maintenance Boundary](./020-row-renderer-maintenance-boundary.md)                 | DONE     | e530b52      |
| 021 | [Row Cell Binding Lane Boundary](./021-row-cell-binding-lane-boundary.md)                       | DONE     | 15e4809      |
| 022 | [Row Cell Binder Boundary](./022-row-cell-binder-boundary.md)                                   | DONE     | 15e4809      |
| 023 | [Row Renderer Runtime Adapter Boundary](./023-row-renderer-runtime-adapter-boundary.md)         | DONE     | 05f3eed      |
| 024 | [Row Renderer Runtime Host Contract](./024-row-renderer-runtime-host-contract.md)               | DONE     | 9a1b82a      |
| 025 | [Render Engine Scroll Frame Coordinator](./025-render-engine-scroll-frame-coordinator.md)       | DONE     | 04b846d      |
| 026 | [Render Engine Paint Pipeline Coordinator](./026-render-paint-pipeline-coordinator.md)          | DONE     | 10ef28a      |
| 027 | [Render Engine Viewport/Layout Coordinator](./027-render-engine-viewport-layout-coordinator.md) | DONE     | 1015f23      |
| 028 | [Public React Surface Hardening](./028-public-react-surface-hardening.md)                       | REJECTED | e86e886      |
| 029 | [React Hook Lifecycle Contract Hardening](./029-react-hook-lifecycle-contract-hardening.md)     | DONE     | d79c342      |
| 030 | [Single Grid Entrypoint Migration](./030-single-grid-entrypoint-migration.md)                   | DONE     | 4fd7cff      |
| 031 | [Runtime Fault Surface Completion](./031-runtime-fault-surface-completion.md)                   | DONE     | 4d3b9fc      |
| 032 | [Single Grid Entrypoint Lockdown](./032-single-grid-entrypoint-lockdown.md)                     | DONE     | c5903df      |
| 033 | [Plan Reconciliation And Release Hardening](./033-plan-reconciliation-and-release-hardening.md) | DONE     | 54d4803      |
| 034 | [Server Grid Polish Foundation](./034-server-grid-polish-foundation.md)                         | DONE     | working tree |
| 035 | [Phase 6 Legacy Layout Cleanup](./035-phase6-legacy-layout-cleanup.md)                          | DONE     | working tree |
| 037 | [Coordinator Unit Tests](./037-coordinator-unit-tests.md)                                       | DONE     | working tree |
| 038 | [store.ts Line Budget](./038-store-ts-line-budget.md)                                           | DONE     | working tree |
| 039 | [Grid Layout Animation + Chrome Hardening](./039-grid-layout-animation-chrome-hardening.md)     | PARTIAL  | working tree |
| 040 | [Core-Owned Architecture North-Star](./040-core-owned-architecture-north-star.md)               | TODO     | working tree |
| 041 | [Core Client Pagination (pipeline window)](./041-core-client-pagination-pipeline-window.md)     | TODO     | working tree |
| 042 | [React Pagination + Status Bar Teardown](./042-react-pagination-statusbar-teardown.md)          | TODO     | working tree |
| 043 | [Row Lifecycle Exit Animation](./043-row-lifecycle-exit-animation.md)                           | TODO     | working tree |
| 044 | [Animated Column Pinning](./044-animated-column-pinning.md)                                     | TODO     | working tree |

## Execution order

1. `001-row-multiselect.md` - no dependencies
2. `003-row-pipeline-tests.md` - no dependencies; tests only, safe to run any time
3. `002-column-type-registry.md` - no dependencies
4. `004-declarative-style-rules.md` - no dependencies; demo update requires 002 landed first if demo uses `columnTypes`
5. `005-row-selection-class-set.md` - no dependencies; smallest/highest-confidence performance fix
6. `006-aggregation-stage-streaming.md` - no dependencies; larger grouped-grid allocation reduction
7. `007-grouped-pipeline-filter-allocation.md` - no dependencies; can land before or after 006
8. `008-row-transaction-diff-optimization.md` - no dependencies; row-update allocation reduction
9. `009-rendering-layout-architecture.md` - P0 umbrella plan; should precede deeper sticky grouping and column grouping feature work
10. `010-core-architecture-hardening.md` - implemented after 009; per-row versions, state split, renderer decomposition, editing lifecycle, and persistence API
11. `011-feature-boundary-architecture.md` - next P0 architecture plan; establishes feature controllers, mutation effects, and adapter boundaries so new features stop requiring cross-file patches
12. `012-data-mutation-kernel-hardening.md` - P0 correctness and architecture follow-up; fixes formula fill regression and makes cell data mutation a single owned pipeline
13. `013-thin-engine-effects-boundary.md` - P0 architecture lock-in; makes `GridEngine` a thin kernel, completes typed feature effect routing, and activates the skipped engine-size guard
14. `014-runtime-port-inversion.md` - P0 boundary hardening after 013; breaks the `GridStore -> GridEngine -> models -> rowModel` cycle so row/data/formula features stop requiring cross-file protocol patches
15. `015-internal-adapter-boundary.md` - P0 adapter-boundary hardening after 014; seals `@open-grid/core/internal` into an explicit host/adapter contract before deeper renderer decomposition
16. `016-store-runtime-decomposition.md` - P0 runtime hardening after 015; splits `InternalGridApi` by audience, removes plugin `GridStore` downcasts, and makes `GridStore` a true facade before pre-renderer cleanup continues
17. `017-row-model-runtime-boundary.md` - P0 runtime hardening after 016; removes concrete `GridStore` coupling from client/server row models so visual-row producers depend on explicit runtime ports before renderer work
18. `018-runtime-fault-diagnostics-boundary.md` - P0 runtime hardening after 017; normalizes fault capture across event/state/plugin/server paths so the core has one owned diagnostic surface before renderer refactors
19. `019-render-engine-orchestration-boundary.md` - P0 renderer hardening after 018; extracts invalidation wiring and gated paint scheduling so `RenderEngine` becomes a coordinator before deeper row-slot decomposition
20. `020-row-renderer-maintenance-boundary.md` - P0 renderer hardening after 019; extracts invalidation repaint and scroll-idle repair so `RowRenderer` is more focused before deeper slot and cell decomposition
21. `021-row-cell-binding-lane-boundary.md` - P0 renderer hardening after 020; routes left/center/right lane binding through a dedicated helper before extracting hotter per-cell binding logic
22. `022-row-cell-binder-boundary.md` - P0 renderer hardening after 021; routes the live cell-binding path through a dedicated binder before retiring leftover RowRenderer wrappers
23. `023-row-renderer-runtime-adapter-boundary.md` - P0 renderer hardening after 022; moves full-width orchestration and post-scroll coordination adapters into a dedicated runtime module so the shell is mostly viewport ownership plus delegation
24. `024-row-renderer-runtime-host-contract.md` - P1 renderer hardening after 023; stabilizes the runtime host surface so the adapter consumes real RowRenderer state without dragging the shell back into policy assembly
25. `025-render-engine-scroll-frame-coordinator.md` - P0 renderer hardening after 024; extracts scroll-frame orchestration and cheap-path fan-out so `RenderEngine` becomes a narrower composition root before deeper render-pipeline cuts
26. `026-render-paint-pipeline-coordinator.md` - P0 renderer hardening after 025; extracts paint lifecycle orchestration and full-paint fan-out so `RenderEngine` becomes a slimmer composition root before the next pipeline cut
27. `027-render-engine-viewport-layout-coordinator.md` - P0 renderer hardening after 026; extracts viewport/layout orchestration and scroll-into-view targeting so `RenderEngine` can step back further before deeper pipeline cuts
28. `028-public-react-surface-hardening.md` - P0 React/public API hardening after 027; splits the overloaded OpenGrid surface into explicit entrypoints and migrates the demo onto the recommended contract before the API hardens further
29. `029-react-hook-lifecycle-contract-hardening.md` - P0 React hook hardening after 028; separates initial-only lifecycle config from live updates so the hook contract becomes as explicit as the component surface
30. `030-single-grid-entrypoint-migration.md` - P1 React API consolidation after 029; replaces the remaining public grid variants with one discriminated-union `Grid` entrypoint and migrates the demo to it
31. `032-single-grid-entrypoint-lockdown.md` - P0 React/demo lockdown after 030; removes the remaining ownership helpers, showroom store layer, and demo core imports so `Grid` is the only public grid entrypoint

## Dependency graph

```text
001  (row multi-select)
003  (pipeline tests)     - independent
002  (column type registry)
004  (style rules)        - demo update loosely depends on 002 being done first
005  (row selection class Set)
006  (aggregation streaming)
007  (grouped filter allocation)
008  (row transaction diff)
009  (rendering layout architecture) - umbrella plan for grouping/sticky grouping/column grouping robustness
010  (core architecture hardening)   - follows 009
011  (feature boundary architecture) - follows 009/010
012  (data mutation kernel)         - follows 011; required before new edit/fill/formula/paste features
013  (thin engine effects boundary) - follows 012; required before the next feature wave so feature side effects and engine ownership are enforceable
014  (runtime port inversion)       - follows 013; required before deeper row-model, formula, and store-surface feature work so internal modules depend on ports instead of concrete engine/store reach-through
015  (internal adapter boundary)    - follows 014; required before renderer refactors so framework adapters depend on a narrow host contract instead of broad engine/store/renderer internals
016  (store runtime decomposition)  - follows 015; required before renderer refactors so plugins, store facades, and host/runtime contracts stop sharing one oversized internal surface
017  (row-model runtime boundary)   - follows 016; required before renderer refactors so visual-row producers stop depending on the concrete store facade
018  (runtime fault diagnostics)    - follows 017; required before renderer refactors so async/listener/plugin/server failures report through one core-owned path
019  (render-engine orchestration)  - follows 018; first renderer decomposition pass so render orchestration policy moves out of the main engine class before rowRenderer work
020  (row-renderer maintenance)     - follows 019; moves repaint and scroll-idle repair out of RowRenderer before row-slot and cell-binding decomposition
021  (row-cell binding lanes)       - follows 020; moves lane-level left/center/right binding orchestration out of the main renderer path before per-cell binder extraction
022  (row-cell binder)              - follows 021; moves live per-cell binding policy out of RowRenderer before wrapper cleanup and final slot-lifecycle narrowing
023  (row-renderer runtime adapter) - follows 022; moves runtime adapter construction for full-width orchestration and post-scroll coordination out of RowRenderer
024  (row-renderer runtime host)    - follows 023; aligns the runtime adapter with the existing RowRenderer host surface and keeps the shell from regrowing
025  (render-engine scroll coordinator) - follows 024; isolates scroll-frame orchestration and cheap-path synchronization before deeper render-pipeline work
026  (render-engine paint coordinator) - follows 025; moves paint lifecycle orchestration and full-paint fan-out out of RenderEngine
027  (render-engine viewport/layout coordinator) - follows 026; moves viewport layout computation, recycling, and scroll-targeting out of RenderEngine
028  (public react surface hardening) - follows 027; splits the overloaded public React surface into explicit entrypoints before the API becomes sticky in demos and docs
029  (react hook lifecycle contract hardening) - follows 028; splits initial-only hook config from live inputs so warnings stop carrying the contract
030  (single grid entrypoint migration) - follows 029; collapses the remaining public React grid variants into one discriminated-union `Grid` component
032  (single grid entrypoint lockdown) - follows 030; removes the remaining public ownership helpers and showroom indirection so the demo only teaches the single `Grid` entrypoint
```

## Notes

- Plan 001 is written against commit `3d32692`; plans 002-004 against `970c777` on branch `rendering-architecture-v2-wip-2`.
- Plans 005-008 were generated by a quick performance audit on 2026-06-11 against commit `66c92c2`.
- Plan 009 captures the AG Grid-level rendering architecture vision for grouping, sticky grouping, column grouping, layout layers, and layout-plan-driven rendering. Treat it as the north-star plan before adding deeper grouping features.
- Plan 010 was implemented in the recent architecture hardening commits and should be treated as the baseline for future plans.
- Plan 011 was implemented at `39c83e3` and fully reconciled on 2026-06-13. The original review findings were closed by later follow-on work: the feature controllers and `GridChangeApplier` are present, `GridEngine.ts` is now below the active size guard, React no longer reaches through broad core internals, and the full workspace build/test verification is green.
- Plan 012 is implemented and verified on 2026-06-12: core build/test, React build/test, and sequential demo build pass. It fixed the formula fill regression and established the data mutation kernel.
- Plan 013 is implemented and verified on 2026-06-12: `GridEngine.ts` is now below the active 800-line guard, subscription batching and state-reaction logic are extracted, feature controllers route through the narrowed effect boundary, and React's chart overlay no longer imports `@open-grid/core/internal`.
- Plan 014 is implemented and verified on 2026-06-12: shared runtime ports now sit in `packages/core/src/engine/runtimePorts.ts`, `DataModel` / `ColumnModel` / `CellAccessModel` no longer depend on `GridEngine`, and client/server row models no longer reach through `store.engine.*`.
- Plan 014 leaves `store.ts` under the active intermediate guard (`< 900`, currently 891 lines) but not yet at the aspirational `850` target. Treat that as deferred cleanup rather than a hidden failure.
- Plan 015 targets the next pre-renderer hardening step: narrow `@open-grid/core/internal` from a broad export barrel into the explicit adapter host contract used by React and future renderers.
- Plan 015 is implemented and verified on 2026-06-12: `@open-grid/core/internal` now exports only the adapter host contract and `hasImperativeRendererCapability`; React no longer imports `InternalColumnDef`; boundary and architecture guards prevent broad internal barrels and raw implementation exports from returning.
- Plan 016 is implemented and verified on 2026-06-12: plugins now initialize against `GridPluginRuntime` instead of `InternalGridApi`, plugin lifecycle is owned by `GridPluginRegistry`, `gridPlugins.ts` registers through a dedicated plugin controller, and `navigation.ts` / `contextMenu.ts` no longer reference `GridStore` or cast `api as GridStore`.
- Plan 016 leaves `store.ts` below the active intermediate guard (`< 875`, currently 870 lines) but not yet at the aspirational `850` target. Treat that final shrink as follow-on cleanup rather than a hidden failure.
- Plan 017 is the next pre-renderer hardening step: move client/server row models onto explicit runtime contracts so grouping, transactions, and server loading stop depending on the concrete `GridStore` facade.
- Plan 017 is implemented and verified on 2026-06-12: client and server row models now initialize against explicit row-model runtimes, `createGrid.ts` composes them through `store.getClientRowModelRuntime()` / `store.getServerRowModelRuntime()`, architecture guards prevent concrete `GridStore` creep from returning, and core/React/demo verification passed after aliasing the demo to source entrypoints for local workspace package resolution.
- After Plan 017, the main remaining pre-renderer hardening plan should be runtime fault/diagnostic normalization so async, listener, and server failures stop scattering local `console.error` behavior across the core.
- Plan 018 is the last major pre-renderer core hardening pass: unify runtime fault capture across event dispatch, state listeners, undo/redo, plugins, cell notifications, and server row-model loading so the core exposes one bounded diagnostic path before renderer decomposition begins.
- Plan 018 is implemented and verified on 2026-06-12: runtime faults now flow through a shared reporter, `runtimeFault` is a typed grid event, recent core faults can be inspected/cleared via the API boundary, and the targeted pre-renderer core files no longer use scattered local `console.error` calls.
- Plan 019 starts the renderer refactor proper by splitting `RenderEngine` orchestration away from subscription and invalidation policy. The goal is to make `RenderEngine` a composition root before cutting into `rowRenderer.ts`.
- Plan 019 is implemented and verified on 2026-06-12: renderer invalidation wiring now lives in `RenderInvalidationCoordinator.ts`, render stat snapshot/reset logic lives in `renderTelemetry.ts`, `renderEngine.ts` is down to 903 lines, and core/React/demo verification passed. React tests still emit the known `OpenGrid requires one of...` validation error during an intentional misuse test, but the suite exits green.
- Plan 020 is the next renderer hardening step: move invalidation repaint and post-scroll dirty repair into a dedicated maintenance helper so `RowRenderer` can concentrate on slot lifecycle and hot-path cell binding.
- Plan 020 is implemented and verified on 2026-06-12: invalidation repaint and scroll-idle repair now live in `rowRenderMaintenance.ts`, renderer style-hook faults in the row path report through `rendererFaults.ts`, `rowRenderer.ts` is down to 1531 lines, and core/React/demo verification passed. As before, React tests emit the known `OpenGrid requires one of...` validation error during an intentional misuse test, but the suite exits green.
- Plan 021 is the next renderer slice: move live left/center/right lane orchestration into a dedicated helper so the remaining `RowRenderer` mass is concentrated in per-cell binding and slot lifecycle.
- Plan 021 is implemented and verified on 2026-06-12: the live row/data and loading lane path now routes through `rowCellBindingLanes.ts`, architecture guards assert the lane helper boundary, and core/React/demo verification passed. `RowRenderer` still retains wrapper mass and dead-size pressure, so the next slice should remove the leftover lane wrappers and extract hotter per-cell binding policy.
- Plan 022 is the next renderer slice: move the live per-cell binding path through `rowCellBinder.ts` so the remaining RowRenderer pressure is mostly wrapper cleanup and slot-lifecycle ownership.
- Plan 022 is implemented and fully wrapped through the follow-on runtime extraction on 2026-06-13: the live lane path routes per-cell policy through `rowCellBinder.ts`, runtime bridge assembly now lives in `rowRendererRuntime.ts`, `RowRenderer` is down to 680 lines as a true slot-lifecycle shell, and full workspace verification (`corepack pnpm run test`, `corepack pnpm run build`) passed.
- Plan 024 is implemented and verified on 2026-06-13: `rowRendererRuntime.ts` now consumes a live runtime state host instead of a getter-heavy pseudo-host contract, `rowCellBinder.ts` reads the programmatic scroll pointer once per bind path via plain runtime args, and the focused plus full core/React/demo verification commands all passed.
- Plans 017-022 were reconciled from `REVIEW` to `DONE` on 2026-06-13 after confirming the runtime/renderer guardrails in `packages/core/src/engine/architectureGuards.test.ts` and re-running full workspace verification (`corepack pnpm run test`, `corepack pnpm run build`) successfully.
- Plan 027 is implemented and verified on 2026-06-13: viewport/layout orchestration and scroll-into-view targeting now live in `renderViewportCoordinator.ts`, and `RenderEngine` delegates the last layout bridge.
- Plan 028 was superseded by the later `029` + `030` + `032` sequence and reconciled on 2026-06-13. Do not execute it independently; the public-surface goals it described were absorbed by the single-`Grid` rollout.
- Plan 029 is implemented and verified on 2026-06-13: the React hook lifecycle now has explicit initial/live entrypoints, the wrapper components use that split internally, and the demo plus React package still build and test cleanly.
- Plan 030 is the next API consolidation step: replace the remaining public grid variants with one discriminated-union `Grid` entrypoint and migrate the demo to it.
- Plan 031 is implemented and verified on 2026-06-13: context-menu clipboard failures, custom aggregation failures, fill-drag failures, and header callback failures now route through runtime diagnostics instead of scattered production `console.error` calls. The typed plugin runtime now exposes `reportRuntimeFault`, and architecture guards cover the newly normalized paths.
- Plan 032 is implemented and verified on 2026-06-13: the React package now exposes `Grid` as the only public grid entrypoint, `ownedGrid.ts` is gone, architecture guards fail if the demo imports core or owned-grid internals, and the core/React/demo verification gates passed.
- Plan 033 reconciled stale backlog statuses on 2026-06-13 after verifying live row multi-select evidence, single-`Grid` architecture guards, and green core/React/demo build and test gates.
- Plan 034 is implemented and verified on 2026-06-13: pagination is now native to `ServerRowModelController` — page state (`currentPage`, `pageCount`, `totalRowsKnown`) lives in core, `goToPage(n)` is an explicit `GridApi` method, `paginationChanged` is a typed grid event, `GridState.serverPagination` is updated atomically, and the `pagedServerDatasource` React wrapper is deleted. The `InfiniteServerScroll` demo pagination is uncommented and uses the native path. Architecture guard asserts `pagedServerDatasource` cannot reappear in `Grid.tsx`. All 511 core tests, 100 React tests, and demo build pass.
- Plan 001 is implemented and verified on 2026-06-13: row multi-select state/tests live in `packages/core/src/store.test.ts`, the public API is exercised by `demo/src/pages/RowMultiSelectDemo.tsx`, and the core/React/demo verification gates passed.
- After each plan: `pnpm -F @open-grid/core build && pnpm -F @open-grid/react build && pnpm -F @open-grid/core test && pnpm -F @open-grid/react test`

## Findings considered and rejected

- `packages/core/src/renderer/rowRenderer.ts:1075` creates a fallback `new Set(state.selectedRowIds)` for checkbox cells, but `_selectedRowIdSet` is populated at the start of `recycleViewport`; this is defensive and not currently a hot-path finding.
- `packages/react/src/GridPortal.tsx:456-478` snapshots portal Maps with `Array.from(...)`; this is already dirty-gated to structural portal changes, so it is lower leverage than the row-pipeline allocation plans.

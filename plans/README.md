# Plans

| #   | Plan                                                                              | Status | Commit  |
| --- | --------------------------------------------------------------------------------- | ------ | ------- |
| 001 | [Row Multi-Select](./001-row-multiselect.md)                                      | TODO   | 3d32692 |
| 002 | [ColumnType Registry](./002-column-type-registry.md)                              | DONE   | 970c777 |
| 003 | [Row Pipeline Tests](./003-row-pipeline-tests.md)                                 | DONE   | 970c777 |
| 004 | [Declarative Style Rules](./004-declarative-style-rules.md)                       | DONE   | 970c777 |
| 005 | [Row Selection Class Set](./005-row-selection-class-set.md)                       | DONE   | 66c92c2 |
| 006 | [Aggregation Stage Streaming](./006-aggregation-stage-streaming.md)               | DONE   | 66c92c2 |
| 007 | [Grouped Pipeline Filter Allocation](./007-grouped-pipeline-filter-allocation.md) | DONE   | 66c92c2 |
| 008 | [Row Transaction Diff Optimization](./008-row-transaction-diff-optimization.md)   | DONE   | 66c92c2 |
| 009 | [Rendering Layout Architecture](./009-rendering-layout-architecture.md)           | TODO   | 78e8122 |
| 010 | [Core Architecture Hardening](./010-core-architecture-hardening.md)               | DONE   | 53fe61f |
| 011 | [Feature Boundary Architecture](./011-feature-boundary-architecture.md)           | REVIEW | 39c83e3 |
| 012 | [Data Mutation Kernel Hardening](./012-data-mutation-kernel-hardening.md)         | DONE   | 39c83e3 |
| 013 | [Thin Engine Effects Boundary](./013-thin-engine-effects-boundary.md)             | DONE   | 94c9453 |
| 014 | [Runtime Port Inversion](./014-runtime-port-inversion.md)                         | DONE   | 94c9453 |
| 015 | [Internal Adapter Boundary](./015-internal-adapter-boundary.md)                   | DONE   | 0f93724 |

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
```

## Notes

- Plan 001 is written against commit `3d32692`; plans 002-004 against `970c777` on branch `rendering-architecture-v2-wip-2`.
- Plans 005-008 were generated by a quick performance audit on 2026-06-11 against commit `66c92c2`.
- Plan 009 captures the AG Grid-level rendering architecture vision for grouping, sticky grouping, column grouping, layout layers, and layout-plan-driven rendering. Treat it as the north-star plan before adding deeper grouping features.
- Plan 010 was implemented in the recent architecture hardening commits and should be treated as the baseline for future plans.
- Plan 011 was implemented at `39c83e3` and reviewed. It improved file boundaries, but core tests are red in `fillRange.test.ts`, `GridEngine.ts < 800` is still skipped, and feature controllers do not yet consistently use `GridChangeApplier`.
- Plan 012 is implemented and verified on 2026-06-12: core build/test, React build/test, and sequential demo build pass. It fixed the formula fill regression and established the data mutation kernel.
- Plan 013 is implemented and verified on 2026-06-12: `GridEngine.ts` is now below the active 800-line guard, subscription batching and state-reaction logic are extracted, feature controllers route through the narrowed effect boundary, and React's chart overlay no longer imports `@open-grid/core/internal`.
- Plan 014 is implemented and verified on 2026-06-12: shared runtime ports now sit in `packages/core/src/engine/runtimePorts.ts`, `DataModel` / `ColumnModel` / `CellAccessModel` no longer depend on `GridEngine`, and client/server row models no longer reach through `store.engine.*`.
- Plan 014 leaves `store.ts` under the active intermediate guard (`< 900`, currently 891 lines) but not yet at the aspirational `850` target. Treat that as deferred cleanup rather than a hidden failure.
- Plan 015 targets the next pre-renderer hardening step: narrow `@open-grid/core/internal` from a broad export barrel into the explicit adapter host contract used by React and future renderers.
- Plan 015 is implemented and verified on 2026-06-12: `@open-grid/core/internal` now exports only the adapter host contract and `hasImperativeRendererCapability`; React no longer imports `InternalColumnDef`; boundary and architecture guards prevent broad internal barrels and raw implementation exports from returning.
- After each plan: `pnpm -F @open-grid/core build && pnpm -F @open-grid/react build && pnpm -F @open-grid/core test && pnpm -F @open-grid/react test`

## Findings considered and rejected

- `packages/core/src/renderer/rowRenderer.ts:1075` creates a fallback `new Set(state.selectedRowIds)` for checkbox cells, but `_selectedRowIdSet` is populated at the start of `recycleViewport`; this is defensive and not currently a hot-path finding.
- `packages/react/src/GridPortal.tsx:456-478` snapshots portal Maps with `Array.from(...)`; this is already dirty-gated to structural portal changes, so it is lower leverage than the row-pipeline allocation plans.

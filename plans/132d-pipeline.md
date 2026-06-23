# Plan 132d (Phase 5): Pipeline & Visual Model

Parent: [`132-core-rewrite-master.md`](./132-core-rewrite-master.md) · Spec: `ARCHITECTURE.md` §3 R6–R7.

## Mission

Build the pipeline that turns row-model rows into the ordered visual model the renderer paints
(R6), and the ONE shared `RowWriteImpact` classifier every write path uses (R7). This retires the
"deferred to the pipeline domain" notes left in the rows and cells domains.

Separation (R6): DataSource → RowModel → **Pipeline** → VisualModel → layout/viewport → render.
The pipeline owns filter/sort/flatten transforms and produces a `VisualModel`; it does not own
storage, events, versions, or rendering.

## Files (new, under `packages/core/src/domains/pipeline/`)

- `RowWriteImpact.ts` — `RowWriteImpact` type + `classifyWriteImpact(changedFieldsByRow, ctx)` — the single classifier.
- `VisualRow.ts` — the explicit tagged union (`data | group | tree | detail | loading | placeholder`) + `VisualRowId`.
- `VisualModel.ts` — ordered `VisualRow[]` + `VisualIndex` (rowId/visualRowId → position) + selectors.
- `PipelineStage.ts` — `PipelineStage<In,Out>` (`build` + `update`) + `PipelineContext`.
- `FilterStage.ts` — predicate filter over row nodes.
- `SortStage.ts` — multi-key comparator sort.
- `FlattenStage.ts` — row nodes → `VisualRow[]` (data rows for now).
- `RowPipeline.ts` — runs filter → sort → flatten; holds sort/filter models; exposes the classifier.
- `PipelineCommands.ts` — register `pipeline.setSortModel` / `pipeline.setFilterModel` on the kernel.
- `index.ts` — barrel.
- Tests: `RowWriteImpact.test.ts`, `RowPipeline.test.ts`, `PipelineCommands.test.ts`.

## Invariants

- `classifyWriteImpact` is the ONLY place a changed-field set becomes an impact verdict. Rows and
  cells feed it the same `changedFieldsByRow`; no per-path classifier.
- `RowId` (data) and `VisualRowId` (rendered) are distinct; a data visual row carries both.
- The pipeline is a pure transform of (rows, sort, filter) → VisualModel. Stages expose `update`
  for incremental application even if `build` is used initially.
- The pipeline publishes nothing; `pipeline.set*` commands route through the kernel.

## Task list

- [x] 5.1 `RowWriteImpact` + `classifyWriteImpact` / `classifyChangedFields` (priority-ranked).
- [x] 5.2 `VisualRow` union (data implemented; others typed) + `VisualModel` with row/visual indexes.
- [x] 5.3 `PipelineStage` contract + `FilterStage` + `SortStage` (stable) + `FlattenStage`.
- [x] 5.4 `RowPipeline` orchestrator (recompute; sort/filter holders; `classify` accessor).
- [x] 5.5 `pipeline.setSortModel` / `pipeline.setFilterModel` kernel commands.
- [x] 5.6 Tests + `tsc --noEmit` clean + suite green.

## Result

`packages/core/src/domains/pipeline/` complete. 13 new tests across `RowWriteImpact.test.ts` (6),
`RowPipeline.test.ts` (5), `PipelineCommands.test.ts` (2) — all green. Root typecheck clean; only
the 7 pre-existing react failures remain. All 5 gates met. This retires the "deferred to the
pipeline domain" notes in the rows and cells domains: `RowPipeline.classify()` is the single
verdict source, ranking filter > group > tree > aggregation > sort > value-getter > plain, with
structural detected from the change set. Stages expose `update` (honest rebuild for now) so
incremental paths slot in without contract changes.

## Verification gates

1. A cell edit to a sort-key column classifies as `sort-key`; to a filter-key as `filter-key`;
   to a plain column as `plain-cell-value`; an add/remove as `structural`.
2. The pipeline produces a filtered+sorted visual model; data visual rows have distinct
   `VisualRowId` and `RowId`.
3. `pipeline.setSortModel` reorders the visual model and emits `pipeline.changed`.
4. `pipeline.setFilterModel` changes membership and emits `pipeline.changed`.
5. `tsc --noEmit` zero errors; new tests green; only the 7 pre-existing react failures remain.

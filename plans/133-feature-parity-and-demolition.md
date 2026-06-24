# Plan 133: Engine Replacement — new kernel becomes the engine

Supersedes the earlier "feature parity" framing. Decision (user, authoritative): **the new
`GridKernel` + domains become the real engine.** `GridStore`/`GridEngine` + old feature-state
controllers are replaced and deleted. The renderer, React layer, and public API are re-pointed onto
the new engine and may be redesigned where cleaner. Concepts stay; **no feature regresses**; **no
deprecated/compat wrappers**; alpha-breakage acceptable mid-flight if the end state is equal-or-more
powerful.

## What is kept vs replaced

KEEP (the body, re-pointed onto the new engine):
- The whole renderer: `renderer/*` — DOM renderer, scroll engine, **layer registry + layout plans**,
  stable slot assigner, row slot pool, layout transitions, overlays, sticky groups, status bar,
  filter chips, floating filters, header menu, column interaction.
- The React adapter: `GridView`, `gridContext`, hooks, the **portal pool** (`gridPortalStore`,
  `gridPortalHosts`), renderers, sidebar, filters. React stays an adapter only.
- `styles.ts`, `themes.ts`, `ThemeManager`. Every feature. The demo (migrated, not deleted-as-feature).

BECOME THE ENGINE (new):
- `kernel/` (command/commit/effect/version/undo, applied|noop|rejected).
- `domains/` (rows incl. client/infinite/server, cells, pipeline + shared `RowWriteImpact`
  classifier, columns, selection, editing, layout, viewport, render).
- `api/GridCore.ts` (composition root) + `api/GridApiFacade.ts` (`createGrid` → the NEW public
  `GridApi`, grown to cover the surface the app needs).

DELETE (when nothing consumes them): `store.ts` (`GridStore`), `engine/*` (`GridEngine`,
`GridCommitKernel`, executors, the old models), `features/*`, old row models (`rowModel.ts`,
`infiniteRowModel.ts`, `serverPageRowModel.ts`), old `api/GridApi.ts`, and their tests.

## Renderer-facing contract the new engine MUST expose (from the seam map)

The existing renderer reads these today (from `engine`); the new engine must provide equivalents
(or a redesigned-but-not-weaker form the re-pointed renderer consumes):
- Visual rows by index incl. kind: data | group | tree | detail | loading | placeholder
  (`getVisualRow(i)`, `getVisualRowCount()`, id↔index maps). **Pipeline currently emits only `data`.**
- Geometry: row heights/tops, total height, column widths/lefts, pinned lanes (left/right).
- Cell read values: raw + cheap display + computed/value-getter; cell state (editing).
- Column state: displayed columns, order, pinned, widths, sort/filter indicators.
- Selection + focus + range; editing/active-edit.
- Domain version counters (or a successor invalidation signal) for targeted repaint.
- Event subscription + the render-port binding (`bindRuntimePorts` / `RendererPort` + `ThemePort`).

## Staged sequence (each stage: keep the demo runnable, no feature regression)

- **S1 — Engine read-surface:** grow the new engine to expose the renderer-facing contract above.
  First gap: pipeline emits group/tree/detail/loading visual rows (group/tree/aggregation/
  master-detail + infinite/server loading stages). Then geometry incl. pinned lanes + display values.
- **S2 — Re-point the renderer:** adapt `renderer/*` to read the new engine's visual model/geometry/
  snapshots and bind to a new ports object. Reuse all the machinery; change only its data source.
- **S3 — Re-point React:** `GridView` binds new ports; hooks subscribe to the new engine; the public
  `GridApi` becomes the new facade (redesigned where cleaner) covering all app/demo needs.
- **S4 — Migrate the demo** onto the new API, page by page; it must look/behave identically.
- **S5 — Demolish:** delete `store.ts`, `engine/*`, `features/*`, old row models, old `api/GridApi.ts`,
  old tests. Promote `next.ts`→`index.ts`, `GridApiFacade`→`GridApi`. Add architecture-guard tests.

## Feature backlog (must all land in the new domains before their old code is deleted — no regression)

filtering (+ advanced query builder, floating filters, filter chips) · sorting (multi) · grouping
(+ group panel, sticky groups, footers, aggregation) · tree data · master/detail · pinned columns
+ pinned rows · infinite block loading + server pagination (real datasources, loading/placeholder
rows) · range selection · fill handle · clipboard copy/paste/multi-paste · multi/checkbox/select-all
· custom cell renderers + editors · native cell types · value formatters/getters · formula/computed
fields (DAG) · validation + tooltips · data-integrity pipeline + quality/diff/conflict/stream ·
column groups/header groups · row drag · status bar · keyboard nav/focus · context menu · column &
view/workspace persistence · theming/skins · column auto-size · CSV export · data integrity capabilities.

## Gates

- Each stage ends with the **demo running on the new engine** for the surfaces touched, and the new
  behavior covered by tests. No subpar/regressed features. No compat shims.
- Old tests are deleted with the old engine (they assert the old architecture), not kept passing.

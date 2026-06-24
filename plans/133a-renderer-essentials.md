# Plan 133a (Tranche A, slice 1): Renderer essentials — headers & custom cell renderers

Parent: [`133-feature-parity-and-demolition.md`](./133-feature-parity-and-demolition.md).

## Mission

Make the React adapter render real grids: a column header row (click-to-sort) and pluggable custom
cell renderers. Keeps the adapter a pure plan-painter (R12) — sort goes through `api.pipeline`,
nothing reaches into row models.

## Scope (this slice)

- `ColumnModel.getHeader(columnId)` (+ expose header via `next.ts`).
- `KernelGrid`: render a header row from the column layout; clicking a sortable header cycles
  none → asc → desc → none via `api.pipeline.setSortModel`.
- `KernelGrid`: `cellRenderers` prop — `Record<columnId, (params) => ReactNode>`; default renders
  `String(value)`. Header `headerRenderers` deferred.
- Tests (jsdom): headers render; click toggles sort order in the painted rows; custom renderer used.

Deferred to later slices: cell editors UI, keyboard nav/focus, context menu, theming classes.

## Gates

1. `pnpm --filter @open-grid/react test` green; core tests green. ✅ core 1457, react 91.
2. `tsc` clean for touched packages. ✅ 0 new-tree errors.
3. Header click reorders the painted rows (asc then desc). ✅
4. A custom cell renderer overrides the default text for its column. ✅

## Result — done

`ColumnModel.getHeader/isSortable`; `GridCore.getColumnHeaders()` + `api.view.getColumns()`
(header text + lane/left/width + live sort direction, exposed via `next.ts` as `GridColumnHeader`).
`KernelGrid` now paints a header row (click-to-sort cycling none→asc→desc) and supports a
`cellRenderers` prop (`Record<columnId, CellRenderer>`). 3 new jsdom tests. Sort still routes
through `api.pipeline.setSortModel` — the adapter stays a plan-painter (R12).

Next slices of Tranche A: cell editor UI wired to the editing transaction; keyboard nav + focus;
cell/row class & theming hooks; context menu.

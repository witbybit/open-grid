# Plan 133: Feature Parity, Demo Migration & Old-Core Demolition

Parent program of `132` Phase 11–12. Spec: [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Mission

The new kernel core (Plan 132, Phases 1–10) is complete and green but minimal. This program
incrementally rebuilds the old grid's features on the **new** core + React adapter, migrates the
demo onto the new API, and **deletes the old `GridStore`/`GridEngine` + old React layer** as each
slice is replaced. End state: one architecture, no old code, demo running on the new stack.

## Strategy — build → migrate → delete, per slice

For each feature slice:
1. **Build** it on the new core (`domains/*`) and/or the React adapter (`react/src/kernel/*`),
   with tests, capability-gated and command-routed (R1–R13).
2. **Migrate** the demo page(s) that use it onto the new API.
3. **Delete** the corresponding old code (old feature controller, old React, old tests) once
   nothing depends on it.

We do NOT keep old+new alive at the end. Final step erases all remaining old core/react/demo and
promotes `@open-grid/core/next` → canonical `index.ts`, `GridApiFacade` → `GridApi`.

## Canonical gates (every slice)

- `pnpm test` (per-package vitest) green — NOT `npx vitest run` from root (stale-dist artifact).
- `tsc -p packages/<pkg>/tsconfig.json` clean for touched packages.
- No `(Plan N` / `Phase N:` / `(Phase N)` comments in production source (Plan-088 guard).

## Feature inventory (from old demo pages + old GridApi surface)

Renderer/UX: column headers, custom cell renderers, custom cell editors, cell/row CSS class rules
& theming, keyboard navigation + focus, context menu, header menu, status bar, group panel, filter
chip bar, floating filters, sidebar tool panels (columns/filters), row drag-reorder, loading
overlay.

Data/pipeline: real infinite datasource (block cache + loading/placeholder visual rows), real
server pagination datasource, row grouping (+ group visual rows, sticky group rows), tree data,
aggregation/footers, pagination, master/detail, pinned columns rendering, pinned rows.

Spreadsheet: range selection, fill handle, clipboard copy/paste, multi-cell paste, native cell
types, formulas/computed fields (DAG engine), value formatters/getters.

Integrity: validation engine + tooltips, data-integrity pipeline, data quality panel, diff mode,
conflict resolution, live data stream.

Selection: multi-select, checkbox selection, range selection, select-all.

Persistence/workspace: column state persistence, view/workspace persistence, query model.

## Tranche roadmap (priority order)

- **A — Renderer essentials** (unblocks migrating any page): column headers; custom cell renderer
  registry in the adapter; custom cell editor wired to the editing transaction; cell/row class &
  style hooks; keyboard nav + focus model; basic context menu.
- **B — Core data display**: pinned-column lane rendering in the adapter (layout already lanes);
  pinned rows; real infinite block loading + loading/placeholder visual rows; real server pagination.
- **C — Pipeline shaping**: group stage + group visual rows (+ sticky); tree stage; aggregation +
  footers; pagination stage.
- **D — Spreadsheet**: range selection model + commands; fill handle; clipboard copy/paste/multi-paste.
- **E — Values & integrity**: value formatters/getters; formula/computed-field engine (DAG);
  validation engine + UI; data-integrity pipeline; quality/diff/conflict/stream.
- **F — Advanced UI**: column groups/header groups; floating filters; advanced query builder;
  sidebar tool panels; status bar; group panel; filter chip bar; row drag.
- **G — Theming**: migrate the theming system + skins to the new adapter.
- **Demo migration**: per page as its tranche lands; replace `demo/` app entry with the new stack.
- **Demolition**: delete old core (`store.ts`, `engine/`, `features/`, old `api/GridApi.ts`, old
  row models, etc.), old React (`Grid.tsx`, `gridContext`, `gridPortalStore`, hooks…), old demo
  pages, old-architecture tests. Promote `next.ts`/`GridApiFacade` to canonical names. Add the
  Phase-12 architecture-guard tests that lock the new boundaries.

## Notes

- Each tranche gets its own child plan (`133a`, `133b`, …) when started.
- Demolition is irreversible/outward-facing — only delete an old module once the new replacement is
  proven and nothing imports the old one (grep the import graph first).
- Known core follow-up: cell edits currently trigger a full pipeline recompute — wire the shared
  classifier so plain-value edits skip recompute (do during Tranche C/D when pipeline grows).

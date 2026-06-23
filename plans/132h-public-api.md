# Plan 132h (Phase 9): Public GridApi (command-backed facade)

Parent: [`132-core-rewrite-master.md`](./132-core-rewrite-master.md) · Spec: `ARCHITECTURE.md` §3 R1, "Public API Direction".

## Mission

Compose the kernel + all domains into one runtime and expose a small, command-backed `GridApi`.
Every state-changing method is a thin wrapper over `kernel.dispatch` (R1). The composition root
owns the reactive glue: after a commit dirties rows/pipeline/columns, it recomputes the derived
models (pipeline → visual model → layout) so the render plan stays current. `GridStore`/`GridEngine`
are NOT exposed.

## Files (new, under `packages/core/src/api/`)

- `GridCore.ts` — composition root: builds row model (by type), pipeline, cell engine, column model,
  selection, edit model, layout + viewport; registers all commands; subscribes to keep derived
  models in sync; exposes typed read accessors + render-plan building.
- `GridApi.ts` — the `GridApi<TRow>` interface + `createGrid(options)` factory returning a facade.
- `index.ts` — barrel.
- `GridApi.test.ts` — end-to-end flows through the public API.

## Invariants

- Every mutating API method routes through `kernel.dispatch` — none touches a domain model directly (R1).
- `rowModelType` is fixed at construction (R6); the facade never exposes a setter for it.
- The reactive recompute updates DERIVED models only; it never dispatches commands (no loops).
- The facade exposes `GridApi`, never `GridStore`/`GridEngine`/raw domain models.
- Unsupported operations surface the kernel's `rejected` result unchanged.

## Task list

- [x] 9.1 `GridCore`: builds + wires all domains; client/infinite/server via `createRowModel`.
- [x] 9.2 Reactive glue: recompute pipeline/layout on `rows.*`/`cells.changed`; sync count on `pipeline.changed`; rebuild column layout on `columns.changed`.
- [x] 9.3 `GridApi` interface + `createGrid` facade (rows/cells/columns/pipeline/selection/editing/rowModel + undo/redo + subscribe/destroy + view).
- [x] 9.4 `view`: `getVisualRowCount`, `setViewport`, `getRenderPlan`.
- [x] 9.5 Facade in `api/GridApiFacade.ts` (no collision with old `api/GridApi.ts`) + tests; clean + green.

## Result

`api/GridCore.ts` (composition root) + `api/GridApiFacade.ts` (`GridApi` + `createGrid`) complete.
8 end-to-end tests: replace→plan, cell edit→plan, sort reorder via plan, editing flow + undo,
selection, column resize/move, fixed type + honest capabilities, server-reject. All green; core
build typecheck clean. All 7 gates met. The new core is now usable as a unit through one
command-backed facade that never exposes `GridStore`/`GridEngine`.

Note: cell edits currently trigger a full pipeline recompute (correct but not optimal); wiring the
shared classifier to skip recompute on plain-value edits is a follow-up optimization. New facade
lives in `GridApiFacade.ts`; Phase 11 consolidates the canonical name after deleting old `GridApi.ts`.

## Verification gates

1. `createGrid({ columns, ... }).rows.replace(rows)` populates the visual model; `getRenderPlan` reflects it.
2. `api.cells.setValue` writes through the kernel and is reflected in `getValue`.
3. `api.pipeline.setSortModel` reorders the visual model seen via `getRenderPlan`.
4. `api.selection.selectRows` / `api.editing.*` work end-to-end through the facade.
5. `api.rowModel.getType()` is fixed; `api.rowModel.getCapabilities()` is honest.
6. Unsupported (`server.applyTransaction`) returns `rejected` via the facade.
7. `tsc --noEmit` zero errors; new tests green; only the 7 pre-existing react failures remain.

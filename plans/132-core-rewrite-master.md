# Plan 132: Core Architecture Reset — Master Plan

## Mission

Rewrite the core of Open Grid into a command-driven `GridKernel` architecture with strict
domain ownership, typed change sets and effects, honest row-model capabilities, a separate
visual model, and a renderer that paints plans. Delete the `GridStore`/`GridEngine`-centered
architecture. Target the design quality of AG Grid, Google Sheets, Linear's grid, and Airtable.

Spec: [`ARCHITECTURE.md`](../ARCHITECTURE.md). This is the master tracker; each phase has its
own child plan (`132a`…`132l`). This is an **alpha** rewrite — break what must be broken, keep
no compatibility layer, leave no old/new duplication at the end.

## Status

- **Priority**: P0
- **Effort**: XXL (multi-session program)
- **Risk**: HIGH — replaces the center of the system
- **Category**: architecture, foundation
- **Supersedes**: the GridStore/GridEngine write-path program (plans 113, 131 are absorbed and then deleted)

## Strategy

Build the new tree fresh under `packages/core/src/{kernel,domains,api,react}` while the old
core keeps the demo alive. Wire the React adapter to the new kernel at Phase 10. Delete the old
architecture at Phase 11. Architecture-guard tests (Phase 12) lock the boundaries so they cannot
silently regress.

We do **not** edit the old `GridStore`/`GridEngine` into the new shape. We do not keep both
kernels alive past Phase 11. No feature flags, no `legacyMode`, no deprecated aliases.

## Child plans

| Phase | Plan | Scope | Status |
| ----- | ---- | ----- | ------ |
| 1 | (this file) + `ARCHITECTURE.md` | Freeze target, ownership, forbidden deps, terminology | **done** |
| 2 | `132a-kernel.md` | GridKernel, GridCommand, GridCommandResult, GridCommit, GridEffect, GridEvent, GridVersion, dispatch | **done** |
| 3 | `132b-rows-domain.md` | Branded IDs, RowNode, RowModelCapabilities, RowModelPlugin, client/infinite/server shells | **done** |
| 4 | `132c-cells-domain.md` | CellAddress, CellValueEngine, sync-only valueSetter, CellChangeSet | **done** |
| 5 | `132d-pipeline.md` | FilterStage, SortStage, flatten, shared RowWriteImpact classifier | **done** |
| 6 | `132e-columns-domain.md` | ColumnModel, ColumnState, ColumnCommand, ColumnLayout | **done** |
| 7 | `132f-selection-editing.md` | SelectionModel, EditSession, edit commands | **done** |
| 8 | `132g-layout-viewport-render.md` | LayoutSnapshot, ViewportSnapshot, RenderPlan, SlotModel | **done** |
| 9 | `132h-public-api.md` | GridApi command-backed facade | **done** |
| 10 | `132i-react-adapter.md` | Grid.tsx, GridProvider, render-plan consumption, immutable rowModelType | **done** |
| 11 | → `133-feature-parity-and-demolition.md` | Reframed: incrementally rebuild old features on the new core, migrate the demo, then delete old | program started |
| 12 | → `133` (Demolition step) | Architecture-guard tests land with the demolition step of the 133 program | pending |

> Phases 11–12 are executed via the **[133 program](./133-feature-parity-and-demolition.md)**: the
> user's directive is to rebuild the old grid's features on the new stack incrementally, migrate the
> demo onto the new API, and erase the old implementation as each slice is replaced (not a single
> big-bang delete). The core rewrite (Phases 1–10) is complete; 133 carries it to feature parity +
> demolition.

## Global invariants (mirror of ARCHITECTURE.md §3)

R1 kernel is the only write gateway · R2 writes return typed effects · R3 row models are
structural · R4 capabilities authoritative · R5 row identity branded & visual rows explicit ·
R6 datasource/rowmodel/pipeline/visualmodel separate · R7 incremental pipeline + one impact
classifier · R8 cells are their own domain · R9 sync writes truly sync · R10 editing is a
transaction system · R11 domain-based state · R12 renderer consumes plans · R13 slot
virtualization first-class.

## Acceptance criteria

The 14 criteria in `ARCHITECTURE.md` §7. The program is complete only when all hold and the old
architecture is gone.

## Verification gates (per phase, before marking a child plan done)

1. `pnpm -C packages/core tsc --noEmit` — zero errors.
2. Full test suite green.
3. New phase code follows the module layout in `ARCHITECTURE.md` §2.
4. No new violation of the forbidden-dependency list (`ARCHITECTURE.md` §4).

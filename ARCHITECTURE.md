# Open Grid — Core Architecture (v2 Reset)

> **Status: in-progress rewrite.** This document is the frozen target. It describes the
> architecture the core *must* have, not the one it has today. Where the current code
> contradicts this document, the current code is wrong and is scheduled for deletion.
> This is alpha. We break what must be broken. No compatibility wrappers, no `legacyMode`,
> no migration flags, no duplicate old/new systems left side by side.

The grid is not a React table component. It is a stack of cooperating engines:

```
a small data engine
+ a spreadsheet engine
+ a command system
+ a visual projection engine
+ a virtualization renderer
```

The product must eventually support client/infinite/server rows, grouping, tree data,
aggregation, pivoting, master/detail, pinned rows & columns, range selection, fill handle,
clipboard, multi-cell paste, undo/redo, formulas, computed fields, validation, data
integrity, AI-proposed edits, runtime devtools, column/view persistence, server-backed
editing, and collaboration. **This reset does not build those features.** It builds the
*spine* that lets them be added without rotting the core.

---

## 1. The pipeline of ownership

Every state change flows in exactly one direction. There are no back-edges.

```
Public API (GridApi)
  ↓  thin wrappers — translate calls into commands, own no state
Command Layer (GridCommand)
  ↓
Grid Kernel / Commit Pipeline (GridKernel)
  ↓  the ONLY write gateway: validate → capability check → transaction → commit → publish
Domain Engines (rows / columns / cells / pipeline / selection / editing / validation)
  ↓  structural engines: apply local state, return typed change sets. Publish nothing.
Derived / Visual Models (VisualModel, VisualRow)
  ↓
Layout + Viewport Engine (LayoutSnapshot, ViewportSnapshot)
  ↓
Render Planner (RenderPlan)
  ↓
React Adapter / DOM Renderer (paints plans; owns no business state)
```

The current `GridStore` / `GridEngine`-centered architecture **must not** remain the center
of the system. The center is the command-driven `GridKernel`.

---

## 2. Module layout (by ownership)

New code lives under `packages/core/src/` in this tree. We build it fresh and delete the old
modules in the final phase — we do not edit the old tree into this shape.

```
kernel/        GridKernel, GridCommand, GridCommandResult, GridCommit, GridCommitPipeline,
               GridEffect, GridEvent, GridVersion, GridTransaction, GridUndoRedoEngine, GridInvariant
domains/
  rows/        RowId, RowNode, RowIdentity, RowModelType, RowModelCapabilities, RowModelPlugin,
               RowCommand, RowChangeSet, RowModelError + client/ infinite/ server/
  columns/     ColumnId, ColumnDef, ColumnModel, ColumnState, ColumnLayout, ColumnCommand, ColumnChangeSet
  cells/       CellAddress, CellValue, CellValueEngine, CellChangeSet, CellGraph, FormulaEngine,
               ValueParser, ValueSetter
  pipeline/    PipelineStage, FilterStage, SortStage, GroupStage, TreeStage, AggregationStage,
               PaginationStage, VisualModel, VisualRow, VisualIndex
  selection/   SelectionModel, RangeSelectionModel, SelectionCommand, SelectionChangeSet
  editing/     EditSession, EditTransaction, EditCommand, EditValidation
  validation/  ValidationEngine, ValidationRule, ValidationResult
  layout/      GridGeometry, RowHeightModel, ColumnWidthModel, PinnedLayout, LayoutSnapshot
  viewport/    ViewportModel, ScrollModel, VisibleWindow, ViewportSnapshot
  render/      RenderPlan, SlotModel, CellSlot, RowSlot, CellBinding, RendererContract
api/           GridApi, GridApiFacade, PublicTypes
react/         Grid.tsx, GridProvider.tsx, useGridApi, useGridSelector, ReactRenderAdapter
```

Do not create empty files. Build only what each phase needs — but every file lands in the
folder its ownership dictates.

---

## 3. The thirteen non-negotiable rules

**R1 — The kernel is the only write gateway.** Every state-changing operation is a command.
Public API methods are thin: `api.cells.setValue(...) → kernel.dispatch({ type: 'cell.setValue', ... })`.
The kernel — and only the kernel — owns: command validation, capability checks, transaction
boundaries, the commit lifecycle, undo/redo recording, version increments, event generation,
dirty-domain calculation, render invalidation, rollback, and error/rejection handling.
Forbidden: public API mutating rows / calling row-model lifecycle / refreshing the renderer /
bumping versions / dispatching events / poking selection/editing/layout state directly.

**R2 — All writes return typed effects.** No domain method "does everything." Domain engines
apply their own local state and return typed change sets. The kernel applies and publishes
effects centrally. A `GridCommandResult` is `applied | noop | rejected`. A `GridCommit`
carries `{ id, command, changes[], effects[], events[], dirtyDomains[], renderInvalidation, undoPatch? }`.

**R3 — Row models are structural engines, not grid engines.** A row model may own row storage,
identity maps, loaded-row state, server page state, infinite block state, node lookup, source
order, and structural changes. It must **not** own global event dispatch, cell notification,
formula invalidation, render-invalidation publication, undo/redo history, public API behavior,
global version publication, or any cross-domain side effect. Command handlers return
`RowCommandResult { status, reason?, rowChanges, requiredPipelineRefresh }`.

**R4 — Capabilities are authoritative.** No duck typing (`'applyTransaction' in rowModel`,
`asTransactionalRowModel(...)`). Decisions are made from an explicit `RowModelCapabilities`
map. If a feature is not truly implemented, its capability is `false`. We do not lie.
> Note: this is **distinct** from the existing user-permission `GridCapabilitiesConfig`
> (`canEdit`, `canSort`…). That is a per-action authorization gate. `RowModelCapabilities`
> is the structural ability of a row model. Both exist; they are never conflated.

**R5 — Row identity is sacred.** Branded IDs: `RowId`, `VisualRowId`, `ColumnId`, `CellId`.
Visual rows are an explicit tagged union (`data | group | tree | detail | loading | placeholder`).
A loading/group/detail row never pretends to be a data row. This is load-bearing for selection,
editing, formulas, copy/paste, server reloads, and virtualization.

**R6 — DataSource, RowModel, Pipeline, and VisualModel are separate concepts.**
DataSource = where data comes from. RowModel = what logical rows exist / which are loaded.
Pipeline = filter/sort/group/tree/aggregation/pagination transforms. VisualModel = what rows
are visible, in what order. Flow: source change → row model → pipeline → visual model →
layout/viewport → render plan. The row model does not own render invalidation; the renderer
does not recompute business state.

**R7 — The pipeline is incremental by design.** `PipelineStage<In,Out>` exposes `build()` and
`update(prev, changeSet, ctx)`. Initial stages: filter, sort, pagination/window, flatten-visual.
Future stages (group, tree, aggregation, pivot, master/detail) fit the same shape. A single
shared `RowWriteImpact` classifier (`none | plain-cell-value | sort-key | filter-key |
group-key | tree-parent | aggregation-input | value-getter-dependency | structural`) is used
by *every* write path — setCellValue, batch cell update, updateRows, applyTransaction,
replaceRows, row order, paste, fill. No per-path classifier.

**R8 — Cell values are their own domain.** `CellValueEngine` owns value application semantics
(raw/parsed/formatted/computed, value getters, eventually formulas + dependency graph +
dirty cells + validation + conditional formatting + AI suggestions). The row model owns rows;
the cell engine owns cell-value semantics. No row model implements its own cell-value semantics.

**R9 — Sync writes are truly sync.** `valueSetter?: (...) => boolean` — never
`boolean | Promise<boolean>`. No fake async in sync commit paths. Async editing, if needed,
is an explicit `api.editing.commitAsync(...)` transaction built later. No fake `abort: () => {}` —
if `abort` exists it works, otherwise it does not exist.

**R10 — Editing is a transaction system.** `EditSession { id, cell, initialValue, draftValue,
status }`. Commands: `edit.start | edit.updateDraft | edit.commit | edit.cancel`. `edit.commit`
internally produces a cell-value command. This is the seam for validation, async validation,
server-backed commit, rollback, AI proposals, paste, fill, and undo/redo.

**R11 — State is domain-based, not one mutable blob.** Each domain owns its state, version,
commands, events, selectors, and serialization policy. Persistent state (columns, sort/filter,
view config, pinned columns) is separated from runtime state (scroll position, loaded blocks,
active edit session, mounted slots, pending requests).

**R12 — The renderer consumes plans, not live business state.** kernel commit → visual snapshot
→ layout snapshot → viewport snapshot → `RenderPlan` → DOM/React adapter applies the plan. The
renderer never reaches into row models for business truth and never mutates rows/selection/
editing/columns.

**R13 — Slot virtualization is first-class.** `RowSlot` / `CellSlot` are reused and rebound
during scroll rather than remounted. React custom renderers use a controlled portal pool.
React reconciliation is never responsible for thousands of cells during scroll.

---

## 4. Forbidden dependencies (enforced by architecture guard tests)

- `api/**` must not import or mutate row-model internals; it may only call `kernel.dispatch`.
- `domains/rows/**` must not import the event bus, the version counter, the cell notifier, the
  renderer, or the undo engine. It returns change sets; it publishes nothing.
- `domains/render/**` and `react/**` must not import row-model internals or domain mutators.
- `react/**` exposes `GridApi`, never `GridStore`/`GridEngine`. Demo/app code depends only on `GridApi`.
- Nothing outside `kernel/**` may bump a domain version or emit a `GridEvent`.
- No `?.` optional-chaining "maybe it supports this" calls on row-model commands. Capability-gate first.

---

## 5. Terminology

| Term | Meaning |
| --- | --- |
| **Command** | An intent to change state. Immutable, serializable, dispatched to the kernel. |
| **Commit** | The kernel's record of one applied command: its change sets, effects, events, dirty domains, render invalidation, undo patch. |
| **Effect** | A typed, kernel-applied consequence (version bump, event, render invalidation). Domains describe effects; only the kernel applies them. |
| **ChangeSet** | Typed description of what a domain changed (`RowChangeSet`, `ColumnChangeSet`, `CellChangeSet`, `SelectionChangeSet`). |
| **Event** | A published notification derived from a commit. Emitted by the kernel only. |
| **CommandResult** | `applied | noop | rejected`. Rejected is never collapsed into noop; noop is never collapsed into applied. |
| **RowWriteImpact** | The single classification of how a write affects the pipeline. |
| **VisualRow** | A row as the user sees it: data, group, tree, detail, loading, or placeholder. Distinct from a data row. |
| **Capability** (row model) | Structural ability of a row model. Authoritative; never duck-typed. |
| **Capability** (grid) | Per-action user-permission gate (`canEdit`…). A separate concept. |

---

## 6. Command result & commit contracts

```ts
type GridCommandResult =
  | { status: 'applied'; commitId: string; effects: GridEffect[] }
  | { status: 'noop'; reason: string }
  | { status: 'rejected'; reason: string; error?: Error };

interface GridCommit {
  id: string;
  command: GridCommand;
  changes: GridChangeSet[];
  effects: GridEffect[];
  events: GridEvent[];
  dirtyDomains: GridDomainId[];
  renderInvalidation: RenderInvalidation | null;
  undoPatch?: GridUndoPatch;
}
```

Unsupported row-model operations return `rejected` (or throw a strict invariant error per
convention) — **never** a silent no-op.

---

## 7. Acceptance criteria (the reset is done only when all hold)

1. Every public state-changing API routes through `GridKernel.dispatch`.
2. Every command returns `applied | noop | rejected`; rejected ≠ noop; noop ≠ applied.
3. No row model dispatches global events, bumps global versions, or notifies cells.
4. No public API calls row-model mutation methods directly.
5. Capabilities are authoritative; unsupported operations never silently no-op.
6. Client/infinite/server row models have honest capability maps.
7. Sync `valueSetter` is truly sync; no fake async; no fake abort.
8. Row identity and visual-row identity are distinct (branded).
9. DataSource, RowModel, Pipeline, VisualModel are separate.
10. The pipeline uses one shared impact classifier across all write paths.
11. The renderer consumes plans/snapshots, not live business state.
12. The React adapter exposes `GridApi`, not `GridStore`; `rowModelType` is immutable after mount.
13. The old `GridStore`/`GridEngine`-centered architecture is deleted.
14. Architecture guard tests prove the ownership boundaries.

---

## 8. Implementation phases

Tracked in `plans/132-core-rewrite-master.md` and its child plans (`132-*`). Order:

1. Freeze target (this document) + plan files.
2. Kernel: command, result, commit, effect, dispatch, event publication, version publication.
3. Rows domain: branded IDs, RowNode, capabilities, RowModelPlugin, client/infinite/server.
4. Cells domain: CellAddress, CellValueEngine, sync-only valueSetter, CellChangeSet.
5. Pipeline: filter, sort, flatten, shared RowWriteImpact classifier.
6. Columns domain: ColumnModel, state, commands, layout snapshot.
7. Selection + editing skeleton.
8. Layout / viewport / render planning.
9. Public API as a command-backed facade.
10. React adapter consuming render plans.
11. Delete old architecture.
12. Tests: architecture guards, command behavior, capability, pipeline, render plan, adapter boundary.

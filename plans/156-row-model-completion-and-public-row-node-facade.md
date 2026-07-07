# Plan 156: Row Model Completion + Public RowNode Facade

> **Executor instructions**: This plan must be executed in phases. Do not jump straight to a public `GridRowNode` convenience API without first making row-model load state, async request ownership, and mutation semantics explicit. The goal is not to mimic AG Grid loosely; it is to provide AG Grid-class ergonomics without leaking internal mutable row-model state or bypassing Open Grid's commit, freshness, invalidation, validation, and integrity contracts.
>
> **Drift check (run first)**: `git diff --stat HEAD -- packages/core/src/rowModel.ts packages/core/src/rowNode.ts packages/core/src/infiniteRowModel.ts packages/core/src/serverPageRowModel.ts packages/core/src/api packages/core/src/state packages/core/src/renderer packages/core/src/features/dataIntegrity`
> If any in-scope seam changes materially while this plan is in progress, compare the checklist below against the live code before continuing. Any mismatch in public API, renderer expectations, or row-model semantics is a STOP condition until reconciled.

## Status

- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: `plans/131-commit-kernel-write-path-unification.md`, `plans/138-canonical-data-write-pipeline.md`, `plans/140-row-model-integrity-parity.md`, `plans/153-feather-scroll-snapshot-program.md`
- **Category**: architecture
- **Planned at**: working tree, 2026-07-07

## Why this matters

Plans 154 and 155 made the renderer much more controller-first and semantically honest. The next architectural pressure point is the row-model layer: today the renderer still relies on row-model-specific seams, row load state is not first-class enough, and the public API still exposes `RowNode` as though it were safe to hand to consumers directly.

Open Grid should absolutely adopt RowNode-style ergonomics. Serious grid consumers expect it. But the exposed object must be a public facade that routes through the same row-model and commit contracts as the rest of the grid. Otherwise consumers can mutate row-model state directly and silently bypass versioning, invalidation, validation, integrity, and render-refresh ownership.

This plan completes the row-model contract across `client`, `infinite`, and `server-page`, then introduces a safe `GridRowNode` facade on top of that contract.

## North star

Final architecture must obey:

```txt
Renderer asks for visual rows and row/range load state.
Row model owns visual row projection.
Client row model owns full local dataset.
Infinite row model owns sparse block cache.
Server-page row model owns current page cache only.
Async requests are query-version/request-token guarded.
Loading/failed/placeholder rows are first-class visual rows.
Public GridRowNode is a facade, not an internal mutable node.
Unsupported operations fail explicitly and consistently.
Validation/integrity row operations route through existing authoritative feature owners.
Capabilities are truthful.
```

## Current state summary

- [packages/core/src/rowNode.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/rowNode.ts) is a mutable internal row wrapper with `id`, `data`, and a cell-value cache.
- [packages/core/src/rowModel.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/rowModel.ts) currently exposes that `RowNode` through `VisualRowModel.getRowNodeById`.
- [packages/core/src/api/GridApiSurfaces.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/api/GridApiSurfaces.ts) publicly exposes `getRowNodeById(rowId): RowNode | null`.
- [packages/core/src/state/GridState.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/state/GridState.ts) still uses `RowModelType = 'client' | 'infinite' | 'server'`, even though the implementation is really `server-page`.
- Infinite/server-page loading semantics are present but not unified behind one renderer-facing row/range load-state contract.
- Validation/integrity row operations already exist elsewhere in the system, but there is no safe row-node facade that routes into them.

## Scope

**In scope**

- `packages/core/src/rowModel.ts`
- `packages/core/src/rowNode.ts`
- `packages/core/src/infiniteRowModel.ts`
- `packages/core/src/serverPageRowModel.ts`
- `packages/core/src/api/**`
- `packages/core/src/state/**`
- `packages/core/src/renderer/**` where renderer contracts need updating
- `packages/core/src/features/dataIntegrity/**` only where row-node validation/integrity delegation must hook into existing owners
- `packages/core/src/engine/**` where row-model registration, invalidation, or request-token guards need updating
- `plans/README.md`

**Out of scope**

- Full SSRM implementation
- New grouping, pivot, AI, DevTools, or unrelated integrity product features
- New server commit protocols beyond honest capability expression and loaded-row/page patch semantics

## Phases

### Phase 1 - Honest naming and contract scaffolding

- [x] Add explicit internal row-model kind naming (`server-page` internally, compatibility alias only if required publicly)
- [x] Introduce `InternalRowModelKind`
- [x] Introduce `RowNodeKind` and `RowLoadState`
- [x] Split internal/public node concepts in types:
  - [x] internal mutable row node contract boundary identified and kept separate from new facade types
  - [x] public `GridRowNode` facade contract
- [x] Add `RowModelViewportAccess` interface skeleton
- [ ] Add initial architecture guards preventing new full-SSRM naming drift

### Phase 2 - Internal row-node ownership split

- [ ] Keep existing mutable row wrapper internal-only
- [~] Stop using the internal node type as a public API surface
- [x] Add a public-row-node factory/facade layer
- [x] Ensure facade properties are readonly snapshots/getters only
- [x] Ensure no facade method can mutate row arrays or row data directly

### Phase 3 - Public GridRowNode API surface

- [x] Add `api.getRowNode(rowId)`
- [x] Add `api.getDisplayedRowAtIndex(index)`
- [x] Add `api.getRowIndexById(rowId)`
- [x] Add `api.forEachNode(callback)`
- [x] Add `api.forEachDisplayedNode(callback)`
- [x] Add `api.getRowLoadState(index)`
- [x] Remove public `getRowNodeById` if blast radius is acceptably small

### Phase 4 - Row-model viewport/load contract

- [ ] Implement `RowModelViewportAccess` on client row model
- [ ] Implement `RowModelViewportAccess` on infinite row model
- [ ] Implement `RowModelViewportAccess` on server-page row model
- [ ] Add:
  - [ ] `getKnownRowCount`
  - [ ] `getEstimatedRowCount`
  - [ ] `getRowCountKind`
  - [ ] `getRowLoadState`
  - [ ] `isRowLoaded`
  - [ ] `isRowLoading`
  - [ ] `isRowFailed`
  - [ ] `isRangeLoaded`
  - [ ] `getRangeLoadState`
  - [ ] `ensureRange`

### Phase 5 - Visual row normalization

- [ ] Normalize minimum visual row kinds:
  - [ ] `data`
  - [ ] `loading`
  - [ ] `failed`
  - [ ] `placeholder`
- [ ] Ensure renderer can render loading/failed/placeholder rows without inferring from null data
- [ ] Ensure server/infinite missing rows are represented honestly

### Phase 6 - Infinite block cache and request-token authority

- [ ] Introduce `InfiniteBlockCache`
- [ ] Replace ad hoc infinite loading state as source of truth
- [ ] Add `RowModelQueryState`
- [ ] Add `RowModelRequestToken`
- [ ] Guard async result application on datasource generation, queryVersion, requestId, and block/page identity
- [ ] Add stale-result tests

### Phase 7 - Sort/filter/query ownership hardening

- [ ] Client sort/filter/query remains local pipeline-owned
- [ ] Infinite sort/filter/query bumps queryVersion and resets/stales cache
- [ ] Server-page sort/filter/query bumps queryVersion and resets to page 0
- [ ] Add tests proving stale previous-query results are ignored

### Phase 8 - Honest mutation semantics per row model

- [ ] Client row-node writes are fully local committed writes
- [ ] Infinite row-node writes patch loaded cache rows only
- [ ] Server-page row-node writes patch current loaded page rows only
- [ ] Loading/failed/placeholder row nodes reject unsupported writes safely
- [ ] Unsupported operations fail consistently through the existing result/error policy

### Phase 9 - Row selection scope honesty

- [ ] Define explicit selection-scope behavior per row model
- [ ] Reject `all` where the model cannot honestly provide it
- [ ] Add scope tests for client, infinite, and server-page

### Phase 10 - Renderer integration migration

- [ ] Renderer depends on `RowModelViewportAccess`, not model-specific APIs
- [ ] Renderer uses `getRowLoadState` and `ensureRange`
- [ ] Renderer does not inspect infinite block internals
- [ ] Renderer does not infer loading from `getVisualRow(index) === null`

### Phase 11 - GridRowNode validation and integrity ergonomics

- [ ] Add row-node validation/integrity helpers only if they route into existing authoritative owners
- [ ] Capability-gate unsupported row-node validation/integrity actions
- [ ] Keep them scoped to row-level operations, not new product features
- [ ] Add tests proving they do not bypass the commit/invalidation/integrity pipeline

### Phase 12 - Verification and guardrails

- [ ] Contract tests for all row models
- [ ] Public row-node facade tests
- [ ] Infinite cache tests
- [ ] Query token tests
- [ ] Renderer integration tests
- [ ] Mutation semantics tests
- [ ] Selection scope tests
- [ ] Architecture guards for public facade and viewport access usage

## Initial execution checklist

- [x] Create this plan and keep it updated as phases land
- [x] Land Phase 1 scaffolding with the smallest safe public/internal type split
- [x] Build after Phase 1
- [ ] Add/update tests with each phase instead of backfilling at the end

## Progress notes

- 2026-07-07: Plan created. Phase 1 execution started.
- 2026-07-07: Phase 1 scaffolding landed. Added `InternalRowModelKind`, `RowNodeKind`, `RowLoadState`, `RowRangeLoadState`, `RowCountKind`, `RowModelViewportAccess`, and a new public `GridRowNode` facade contract. Public compatibility type `RowModelType = 'client' | 'infinite' | 'server'` remains unchanged for now, but `GridState` now documents that `'server'` maps to the server-page model rather than full SSRM. `corepack pnpm --filter @open-grid/core build` passed.
- 2026-07-07: First compatibility bridge landed for the public facade. `GridApiSurfaces` now includes `getRowNode`, `getDisplayedRowAtIndex`, `getRowIndexById`, `forEachNode`, `forEachDisplayedNode`, and `getRowLoadState`. `GridStore` now creates `GridRowNode` facades through `createGridRowNodeFacade(...)`, and plugin runtime passthroughs were updated. This is still an intermediate bridge: `getRowNodeById` remains public compatibility, and row-model-aware load/failure/placeholder semantics are not complete yet. `corepack pnpm --filter @open-grid/core build` and `corepack pnpm --filter @open-grid/core test` passed.
- 2026-07-07: Public `getRowNodeById` removal and Phase 2 surface shrink are in progress. `GridApiSurfaces`, plugin/runtime composition, and `rows().getNodeById(...)` now point at `GridRowNode` facades instead of the internal mutable node. `GridCellAccess.node` and `GridCellClickParams.node` now also return `GridRowNode` facades, and `getDataRowNodeAtVisualIndex(...)` has been removed from the public API facade. Renderer/portal internals still intentionally use `RowNode` for now. Verification passed with `corepack pnpm --filter @open-grid/core build`, `corepack pnpm --filter @open-grid/core test`, and `corepack pnpm --filter @open-grid/react test`.

## Done criteria

- [ ] Row model kinds are honest and architecture/docs stop implying full SSRM where it does not exist
- [ ] Public `GridRowNode` facade exists
- [ ] Public `GridRowNode` does not expose internal mutable row-model objects
- [ ] All row models implement one renderer-facing viewport/load-state contract
- [ ] Loading/failed/placeholder rows are first-class visual rows
- [ ] Infinite model uses a real block cache with explicit status
- [ ] Async results are query-version/request-token guarded
- [ ] Row-node writes are honest per row model
- [ ] Validation/integrity row-node operations route through existing authoritative owners
- [ ] Selection scopes are honest per row model
- [ ] Renderer no longer relies on row-model-specific loading seams
- [ ] Unsupported operations fail consistently
- [ ] Core tests and build pass

## STOP conditions

- The public API must preserve `'server'` and a deeper compatibility decision is needed before internal/public type split can proceed cleanly
- Existing validation/integrity owners cannot support row-scoped facade delegation without a separate product/architecture decision
- Renderer migration uncovers an undocumented dependency on row-model-specific internals that needs explicit design before proceeding

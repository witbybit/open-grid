# Plan 158 Server-Page Deletion Manifest

Last audited: 2026-07-12

Source search used for this manifest:

```txt
rg -n "ServerPageRowModelController|server-page|serverPage|getCurrentServerPage|goToServerPage|serverPageChanged|serverPageLoaded|pageNumber" packages demo docs plans
```

This document is the Stage C demolition map for Plan 158. Its purpose is to identify every page-oriented `rowModelType: 'server'` seam that must be deleted or replaced before the new hierarchical SSRM can truthfully own the public `server` row model.

## Demolition rule

The current server-page architecture must not survive as:

- a compatibility mode
- a legacy alias
- a nested controller inside SSRM
- a fallback runtime branch
- a public deprecated API

Breaking changes are expected. The final repository must contain exactly one server row model: real SSRM.

## Primary implementation files to delete or replace

These files currently encode page-oriented server behavior and must be deleted or rewritten as part of the SSRM cutover:

- `packages/core/src/serverPageRowModel.ts`
- `packages/core/src/createGrid.ts`
- `packages/core/src/rowModel.ts`
- `packages/core/src/engine/runtimePorts.ts`
- `packages/core/src/engine/createRowModelRuntimes.ts`
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/store.ts`
- `packages/core/src/internal/createGridRuntimeComposition.ts`
- `packages/core/src/plugins/createGridPluginRuntime.ts`
- `packages/core/src/state/GridState.ts`
- `packages/core/src/api/GridApiSurfaces.ts`
- `packages/core/src/api/GridEvents.ts`
- `packages/core/src/index.ts`
- `packages/core/src/renderer/paginationBarRenderer.ts`
- `packages/react/src/Grid.tsx`

## Page-oriented state and runtime seams to remove

These current seams are specific to the selected-page model and must not exist after SSRM replacement:

- `InternalRowModelKind = 'server-page'` in `packages/core/src/rowModel.ts`
- `GridUIState.serverPage` in `packages/core/src/state/GridState.ts`
- `setServerPageState(...)` in `packages/core/src/engine/GridEngine.ts`
- `getServerPageRowModelRuntime()` consumers throughout core
- `dispatchServerPageLoadingStarted`, `dispatchServerPageLoaded`, and `dispatchServerPageLoadFailed`
- server-page request scope identity from `packages/core/src/asyncRowModelRequestIdentity.ts`
- server-page retry routing in `packages/core/src/store.ts` and `packages/core/src/engine/GridEngine.ts`
- server-page pagination rendering in `packages/core/src/renderer/paginationBarRenderer.ts`

## Public API and event surface to delete

These public contracts must be removed rather than deprecated:

- `goToServerPage(...)` in `packages/core/src/api/GridApiSurfaces.ts`
- `ServerDatasource` and `ServerPageState` exports from `packages/core/src/serverPageRowModel.ts`
- `GridEventName.serverPageLoadingStarted`
- `GridEventName.serverPageLoaded`
- `GridEventName.serverPageLoadFailed`
- `GridEventName.serverPageChanged`
- page-oriented event payloads in `packages/core/src/api/GridEvents.ts`
- page-oriented runtime composition forwarding in `packages/core/src/internal/createGridRuntimeComposition.ts`
- plugin runtime forwarding of `goToServerPage(...)`

The public replacement surface should move to SSRM-specific operations such as:

- `setServerSideDatasource(...)`
- `refreshServerSide(...)`
- `purgeServerSide(...)`
- `getServerSideStoreState()`

## Tests that currently protect the page architecture

These suites must be rewritten to protect SSRM behavior or deleted if they only encode page semantics:

- `packages/core/src/serverRowModel.test.ts`
- `packages/core/src/serverRowModel.adversarial.test.ts`
- `packages/core/src/rowModel.capabilities.test.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/query/queryModel.test.ts`
- `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts`
- `packages/core/src/asyncRowModelRequestIdentity.test.ts`
- server-page assertions in `packages/core/src/engine/architectureGuards.test.ts`

Specific server-page expectations to delete:

- explicit page loading events
- current-page-only integrity/source labels
- `goToServerPage(...)` capability behavior
- `currentPage` partial-scope semantics
- selected-page request identity

## React and presentation seams to replace

These files currently expose page-oriented server behavior above the core model:

- `packages/react/src/Grid.tsx`
- `packages/core/src/renderer/paginationBarRenderer.ts`

Required replacement direction:

- server row model props must describe SSRM block/cache/datasource options, not selected-page pagination
- any future pagination UI must be presentation-only and must not define the datasource contract

## Documentation and plan references to migrate

The following documents currently describe or justify the page-oriented server model:

- `plans/034-server-grid-polish-foundation.md`
- `plans/140-row-model-integrity-parity.md`
- `plans/156-row-model-completion-and-public-row-node-facade.md`

These should remain only as historical migration notes once SSRM lands. They must not remain normative documentation for the live `server` row model.

## Reusable pieces that may survive only if made page-agnostic

These areas are candidates for reuse, but only if the page semantics are removed:

- datasource generation and query generation authority
- abortable async request handling
- response validation patterns
- authoritative async publication patterns
- row-count normalization concepts
- bounded cache primitives

Anything that assumes:

- one selected page
- page count
- page number
- current-page integrity scope
- page-owned visual index derivation

must be deleted instead of reused.

## Atomic replacement checklist

Stage C is not complete until all of the following are true:

- `packages/core/src/serverPageRowModel.ts` is gone
- `rowModelType: 'server'` creates only SSRM
- no server-page events remain
- no `serverPage` state key remains
- no `goToServerPage(...)` API remains
- no page-oriented datasource types remain
- no architecture guards require `server-page` naming
- no tests assert current-page-only server semantics
- no React props expose selected-page server loading
- repo search for server-page symbols returns only migration notes that explicitly describe removal

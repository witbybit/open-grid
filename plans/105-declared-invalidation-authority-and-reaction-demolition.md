# Plan 105: Declared Invalidation Authority and Reaction Demolition

## Mission

Make mutation-declared invalidation the sole normal authority for rendering work, then reduce `GridStateReactionController` and state-key observers to true derived synchronization only.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH — incorrect invalidation can cause stale UI or excess work
- **Depends on**: Plans 103–104
- **Category**: rendering, invalidation, state reactions, demolition

## Problem

The grid can currently receive explicit invalidations from `GridChange` while also observing changed state keys and inferring invalidations again. Two authorities create duplicate paints, unexplained full renders, and hidden compatibility behavior.

## Target end state

```text
command → domain mutation → explicit invalidation plan → FrameCoordinator
```

State reactions may maintain derived internal structures, but they do not rediscover the render consequences of commands.

## Non-negotiable invariants

- Every logical command declares the minimum valid invalidation scope.
- Full invalidation requires an explicit reason and is measurable.
- Reactions never issue normal render invalidation for command-owned state.
- Legacy inferred invalidation is instrumented and must reach zero in foundation scenarios.
- Renderer-local visual effects remain clearly separate from logical invalidation.

## Mandatory demolition

- Broad subscriptions whose only role is mapping changed keys to invalidation.
- Duplicate invalidation after command commit.
- Generic `globalVersion` invalidation escape hatches where a domain version/change is available.
- Hidden fallback full paints that mask missing command declarations.
- Reaction-owned render requests for normal API operations.

## Execution workstreams

1. Inventory every invalidation source and classify logical, derived, renderer-local, or legacy.
2. Define a typed invalidation plan with cell, row, viewport, header, overlay, geometry, portal, and full scopes.
3. Add invalidation declarations to every command converted in Plan 103.
4. Add `legacyInferredInvalidationCount` and traces.
5. Delete reaction-derived invalidation domain by domain.
6. Reduce `GridStateReactionController` responsibility and rename/split it if necessary.
7. Add minimality tests ensuring local changes do not trigger broader paints.

## Verification

- No duplicate render request for one logical command.
- Cell edit invalidates only affected cell/dependents unless structure changes.
- Selection/focus avoids row-model rebuild.
- Sort/filter/group commands request structural work exactly once.
- Foundation real-app flows record zero legacy inferred invalidations.
- Full invalidation reasons are enumerated and budgeted.

## Completion gate

- Explicit mutation invalidation is authoritative.
- Reaction-derived invalidation is absent from normal foundation flows.
- Legacy counter is zero in tests and real-app smoke runs.
- `GridStateReactionController` no longer behaves as a second mutation/render engine.

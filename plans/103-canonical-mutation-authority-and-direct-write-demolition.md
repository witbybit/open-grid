# Plan 103: Canonical Mutation Authority and Direct-Write Demolition

> This plan replaces the previous “alpha foundation cut” Plan 103. The foundation cut is moved to Plan 112. This plan is the immediate blocker because the grid currently has a canonical change abstraction without a canonical change path.

## Mission

Make `GridChangeApplier` and typed domain commands the only production path for committing logical grid mutations. Remove renderer-owned domain writes, broad store-facade writes, and side-effect reconstruction through state reactions.

## Why this changes the project

The engine currently contains a strong `GridChange` model, but logical state can still be mutated directly through `StateManager`, `GridEngine`, feature controllers, renderers, row runtimes, and store helpers. Those bypasses can omit domain versions, events, undo registration, invalidation, instrumentation, persistence notification, or render requests. Until mutation authority is singular, every other architectural guarantee remains conditional.

## Status

- **Priority**: P0 — current foundation blocker
- **Effort**: XL
- **Risk**: HIGH — changes many mutation call sites
- **Depends on**: Plans 089–102 WIP implementation
- **Category**: architecture convergence, mutation ownership, demolition
- **Planned at**: 2026-06-18

## Current evidence

Known direct mutation paths include production calls equivalent to:

```ts
stateManager.setState(...)
engine.stateManager.setState(...)
engine.setState(...)
store.setState(...)
invalidation.invalidateFull(...)
invalidation.invalidateViewport(...)
invalidation.invalidateCell(...)
```

Known high-risk owners include floating filters, pagination UI, state feature controllers, row-model runtime creation, viewport/geometry coordination, grouping/expansion flows, and store convenience methods.

## Target end state

```text
input / API / renderer intent
        ↓
typed command
        ↓
domain owner validates and computes mutation
        ↓
GridChangeApplier commits one atomic change set
        ↓
versions + events + invalidation + history + persistence + render request
```

Direct state writes remain only in a documented allowlist:

1. initial construction/bootstrap;
2. `GridChangeApplier` commit internals;
3. tightly scoped derived-state maintenance that cannot be represented as a user/domain command;
4. test fixtures.

Every allowlisted write must include a code comment naming the owning invariant and an architecture test entry.

## Non-negotiable invariants

- Renderers express intent; they never commit domain state.
- Public API methods dispatch typed commands or invoke domain owners; they do not assemble side effects independently.
- One logical mutation produces one committed change set.
- Domain versions, events, invalidations, undo records, persistence notification, and rendering cannot be independently forgotten.
- Direct state writes outside the allowlist fail architecture tests.
- No long-lived compatibility switch selects between old and new mutation paths.

## Mandatory demolition

Delete or convert:

- renderer-side filter and pagination state writes;
- store-facade methods that call state mutation directly;
- controller methods that mutate state and then manually invalidate;
- duplicate API paths that perform the same logical operation differently;
- reaction logic whose only purpose is reconstructing side effects that the originating command already knows;
- helper functions that expose raw `StateManager` mutation to feature modules.

## Execution workstreams

### Workstream 1 — Inventory and classify every write

Generate a checked-in report of all production references to:

- `setState` and state updater variants;
- domain model mutators;
- invalidation methods;
- event emission;
- version increment methods;
- undo/redo registration;
- direct render requests.

Classify each call as bootstrap, canonical commit, derived internal state, renderer-local visual work, or illegal logical mutation.

### Workstream 2 — Define command families

Create typed commands grouped by domain rather than one giant command enum:

- row data and transactions;
- sorting/filtering/grouping/tree expansion;
- columns and geometry;
- selection/focus/navigation;
- editing and validation;
- pagination;
- UI feature state where it legitimately belongs in core.

Commands must carry intent, not implementation-side effects.

### Workstream 3 — Convert high-risk paths first

Convert in this order:

1. floating filter mutations;
2. pagination renderer mutations;
3. row transaction and row-model registration paths;
4. grouping, expansion, filtering, and sorting;
5. selection and focus;
6. editing lifecycle;
7. column visibility/order/width and geometry;
8. panel/theme/sidebar state retained in the foundation surface.

### Workstream 4 — Add an enforced write allowlist

Add an architecture guard that scans production sources and rejects direct writes outside named files and exact approved call sites. The allowlist must shrink during this plan and be included in the completion evidence.

### Workstream 5 — Remove compatibility bypasses

Once each domain is converted, delete its direct-write helpers immediately. Do not leave deprecated forwarding methods because there are no released consumers to protect.

## Forbidden end state

- `GridChangeApplier` exists but optional call sites still write directly.
- Renderers mutate filter, pagination, selection, or editing state.
- A state reaction is required to infer the normal side effects of a command.
- Direct invalidation remains paired manually with domain mutation.
- Architecture tests merely check that `GridChangeApplier` exists.
- A generic `dispatch({ type: string, payload: any })` replaces typed ownership with an untyped bus.

## Verification program

- Behavioral tests for every converted domain operation.
- A mutation trace test proving each public operation commits exactly one logical change set.
- Event/version/invalidation assertions for representative commands.
- Undo and persistence assertions for applicable commands.
- Architecture test with an explicit direct-write allowlist.
- Real-application smoke test with no internal mutation APIs.

## Required evidence

- Before/after direct-write inventory.
- Deleted methods and files list.
- Command-to-domain-owner map.
- Runtime trace for representative row, column, selection, edit, filter, and pagination mutations.
- Remaining allowlist with justification for every entry.

## Completion gate

- All logical production mutations flow through typed domain commands and `GridChangeApplier`.
- Direct writes are limited to the approved bootstrap/derived-state allowlist.
- Renderers contain no domain-state mutation.
- Normal operation does not rely on reactions to reconstruct command side effects.
- The direct-write count has materially decreased and is recorded as a regression gate.

## STOP conditions

- Stop if conversion adds a second generic command framework beside existing domain APIs.
- Stop if a command becomes a bag of optional side effects rather than domain intent.
- Stop if behavior is preserved only through hidden reaction fallbacks.
- Stop if old direct paths remain behind feature flags.

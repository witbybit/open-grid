# Plan 115: Public Snapshot and Runtime State Closure

## Mission

Finish the public runtime-state boundary so stable listeners and snapshots expose only immutable, canonical public state and never mutable runtime internals.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MEDIUM — public types and subscriptions tighten further
- **Depends on**: Plans 113–114
- **Category**: public API, snapshots, immutability, boundaries

## Problem

Plan 112 removed the major stable `GridState` export leak, but the boundary is still not fully canonical:

- public listener contracts still need to be definitively snapshot-based
- key subscriptions are not yet driven from the canonical public snapshot contract
- mutable nested objects in snapshots need one authoritative builder and immutability guarantees
- compatibility type aliases around runtime state still need to disappear

## Target end state

Public subscriptions use snapshot contracts only:

```ts
type GridSnapshotListener<TRowData> = (snapshot: GridStateSnapshot<TRowData>) => void;
```

Typed key subscriptions are snapshot-based:

```ts
subscribeToKey<K extends keyof GridStateSnapshot<TRowData>>(
	key: K,
	listener: (value: GridStateSnapshot<TRowData>[K]) => void
): () => void;
```

One canonical builder exists:

```ts
createGridStateSnapshot(internalState);
```

## Non-negotiable invariants

- no stable listener exposes `InternalGridState`
- public snapshots never expose mutable runtime references
- `GridState = InternalGridState` compatibility alias is deleted
- internal-only fields stay out of the stable general snapshot

## Mandatory demolition

- public listener contracts tied to mutable runtime state
- duplicate snapshot builders
- compatibility `GridState` alias
- public snapshot fields for internal runtime structures such as render epochs or physical identity

## Execution workstreams

### 1. Canonicalize snapshot creation

Use one builder everywhere and remove duplicate snapshot assembly paths.

### 2. Tighten stable listeners

Replace broad stable listeners with:

- snapshot listeners
- typed key listeners
- dedicated public snapshots where needed (`getEditingState()`, `getViewportState()`, `getLoadingState()`)

### 3. Strengthen immutability

Clone or freeze at minimum:

- sort entries
- filter trees
- selection objects
- column-state objects
- pagination state
- editing snapshots

### 4. Delete compatibility state aliasing

Remove:

```ts
type GridState = InternalGridState;
```

and migrate remaining internal/test uses accordingly.

## Verification

- snapshots cannot mutate internal state
- no application code imports mutable runtime-state aliases
- public key subscriptions are typed against `GridStateSnapshot`
- one canonical snapshot builder is used everywhere

## Completion gate

- stable listeners and subscriptions expose only immutable snapshot state
- the mutable runtime compatibility alias is gone
- all public snapshot construction routes through one canonical builder

# Plan 100: Portal Identity and Behavioral Contract Tests

> **Why this closes the set**: Portal generation improved, but pooled identity remains optional and generation comparison differs between layers. Several architecture tests still assert source strings rather than runtime behavior. The portal contract must become structural and verified through adversarial integration tests.

## Status

- **Priority**: P2 — portal correctness and regression resistance
- **Effort**: M
- **Risk**: MEDIUM — portal identity types and tests
- **Depends on**: Plans 081, 092–093
- **Category**: portals, testing, correctness
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

`slotGeneration` is optional in interfaces even for pooled cells. Generation equality is not expressed consistently between core and React layers, and generation alone is not globally meaningful without physical slot identity.

Important runtime guarantees are often protected by source-text tests rather than integration behavior.

## What to add

### 1. Formal mount identity

```ts
type PortalMountIdentity =
  | {
      kind: 'pooled-cell';
      slotId: number;
      generation: number;
      lane: 'left' | 'center' | 'right';
      laneIndex: number;
    }
  | {
      kind: 'standalone';
      key: string;
    };
```

Pooled identity is mandatory and compared by exact physical identity plus generation.

### 2. Shared stale-mount rule

Core and React use one helper:

```ts
isCurrentMount(expected, actual): boolean
```

Do not use layer-specific `>` versus `!==` rules.

### 3. Behavioral integration tests

Test:

- old async mount cannot replace a rebound slot;
- identical row/value payload with new generation remounts correctly;
- slot-pool recreation does not confuse generations;
- stale imperative renderer update is rejected;
- editor mount cannot commit into a new occupant;
- portal flush obeys Plan 092 stages.

### 4. Replace behavioral string guards

Keep source guards only for import/dependency boundaries. Runtime contracts must be proven by executing the actual pipeline.

## Phases

### Phase 1 — Identity type migration

- Introduce discriminated identity
- Update core portal manager and React portal store

### Phase 2 — Shared comparison semantics

- Centralize current/stale checks
- Remove optional pooled generation paths

### Phase 3 — Adversarial tests

- Add deterministic deferred-mount tests
- Remove redundant string-presence tests

## STOP conditions

- Do not rely on generation without slot identity.
- Do not permit pooled mounts without a generation.
- Do not duplicate stale-mount semantics across adapters.
- Do not replace all architecture guards; import-boundary guards remain useful.

## Verification gate

Run core and React tests with delayed portal mount/update scheduling and prove stale work can never mutate the current slot occupant.

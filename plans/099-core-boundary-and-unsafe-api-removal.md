# Plan 099: Core Boundary and Unsafe API Removal

> **Why this plan exists**: Boundary enforcement currently covers only selected directories, while `store.ts` remains a broad dependency hub across features, models, rows, events, persistence, and utilities. The deprecated renderer-port setter also keeps an unsafe architecture path alive.

## Status

- **Priority**: P2 — maintainability and architectural enforcement
- **Effort**: L
- **Risk**: MEDIUM — import migration across core
- **Depends on**: Plans 087, 091
- **Category**: boundaries, API cleanup, architecture
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

Dedicated domain modules exist, but many production modules still import contracts from `store.ts`. Current guards cover only engine/state areas, allowing the compatibility hub to remain central.

`setRendererPorts()` also bypasses the safe binding protocol.

## What to add

### 1. Shrinking allowlist boundary guard

Disallow new internal imports from `store.ts` and maintain an explicit temporary allowlist for existing files.

Migrate in this order:

1. `features/`
2. `models/`
3. `rows/`
4. `events/` and persistence
5. renderer/root utilities

### 2. Owning-domain imports

Move or re-export types from their true domains:

```text
api/
state/
rows/
columns/
selection/
editing/
events/
rendering/
```

Internal modules import directly from these owners.

### 3. Remove unsafe runtime-port API

Delete `setRendererPorts()` as part of Plan 091 completion.

### 4. Compatibility facade rule

`store.ts` may remain as a public compatibility export surface, but production internals may not import from it.

## Phases

### Phase 1 — Guard and inventory

- Add allowlist-based test
- Record all current imports

### Phase 2 — Directory migration

- Migrate one domain at a time
- Keep commits small and behavior-neutral

### Phase 3 — Close facade

- Empty the allowlist
- Remove unsafe APIs and stale re-exports where allowed

## STOP conditions

- Do not perform semantic refactors while moving imports.
- Do not create a new giant barrel to replace `store.ts`.
- Do not weaken the guard when a new import appears.
- Do not keep deprecated unsafe APIs without a removal milestone.

## Verification gate

No production internal file imports from `store.ts`; public compatibility exports and API signatures continue to build.

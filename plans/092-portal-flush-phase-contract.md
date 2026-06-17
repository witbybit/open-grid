# Plan 092: Portal Flush Phase Contract

> **Why this matters**: `canFlushPortals()` says portals may flush only when no frame is active, yet permits the whole `paint-frame`. This allows reentrant React work while native row and cell binding may still be incomplete. Portal flush permission must be explicit and owned by the paint pipeline.

## Status

- **Priority**: P1 — render correctness and frame stability
- **Effort**: M
- **Risk**: MEDIUM — React/core synchronization path
- **Depends on**: Plans 079, 081, 090
- **Category**: portals, rendering, lifecycle
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

The runtime currently permits synchronous portal flushes in `idle` and `paint-frame`. A broad paint phase does not guarantee that native cell ownership, geometry, and slot rebinding are complete.

This can produce reentrant React rendering against partially updated physical slots.

## What to add

### 1. Explicit portal-flush stage

Prefer an explicit stage inside the paint pipeline:

```ts
type PaintStage = 'native-bind' | 'portal-commit' | 'decoration';
```

Portal flushing is legal only during `portal-commit` or when fully idle.

### 2. Narrow capability

```ts
runtimeState.withPortalFlushPermission(() => {
	portalManager.flush();
});
```

The permission is lexical and cannot leak beyond the owned stage.

### 3. Reentrancy protection

Reject nested portal flushes and report a runtime fault in development/test builds.

### 4. React adapter contract

`flushSync` may be used only from the authorized portal-commit stage or explicit idle API operation.

## Phases

### Phase 1 — Conservative safety

- Change broad `canFlushPortals()` to idle-only
- Identify current paint-time portal flush call sites

### Phase 2 — Owned paint stage

- Add portal-commit stage or lexical permission
- Route portal flush through one orchestrator path

### Phase 3 — Integration tests

- Native slot binding completes before portal commit
- Portal flush is rejected during native binding
- Nested flush is rejected
- Idle flush remains supported where required

## STOP conditions

- Do not add another global `isPortalFlushAllowed` boolean.
- Do not permit all `paint-frame` work to flush portals.
- Do not move native cell rendering into React to avoid the problem.
- Do not swallow reentrant flush faults.

## Verification gate

Add runtime tests that observe slot/container identity before and during portal commit, including custom renderer and editor mounts.

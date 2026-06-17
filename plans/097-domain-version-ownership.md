# Plan 097: Domain Version Ownership

> **Why this follows correctness work**: Domain versions now exist, but broad state reactions increment them. That makes “exactly once per committed logical mutation” difficult to guarantee. Each domain model must own its version at the point where it commits real state.

## Status

- **Priority**: P2 — state architecture and render precision
- **Effort**: L
- **Risk**: MEDIUM — cross-cutting version ownership
- **Depends on**: Plan 084
- **Category**: state, architecture, invalidation
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

`GridStateReactionController` infers domain changes from broad updated keys. One logical mutation may trigger overlapping reaction paths, while some real model changes may not correspond neatly to a top-level state key.

The version contract is therefore observational rather than authoritative.

## What to add

### 1. Model-owned commits

- `ColumnModel` increments column version after committed column state changes.
- `RowModel` increments row-model version after visual output changes.
- `GeometryModel` increments geometry version after geometry changes.
- `SelectionModel` increments selection version after selection identity changes.
- `EditingModel` increments editing version after active edit state changes.

### 2. Commit helper

```ts
commitDomainMutation(domain, changed): void
```

No increment occurs for a semantic no-op.

### 3. Reaction-controller simplification

Reactions consume domain versions and schedule effects; they do not invent version changes.

### 4. Styling domain decision

Either wire a real styling version owner or remove the unused version until a domain exists.

## Phases

### Phase 1 — Define ownership table

Document one owner and increment point for every domain version.

### Phase 2 — Move increments

Migrate one domain at a time with exact-count tests.

### Phase 3 — Remove inferred increments

Delete broad reaction-based version changes and stale compatibility paths.

## STOP conditions

- Do not increment versions from both model and reaction layers.
- Do not increment on semantic no-ops.
- Do not use one global version as a fallback for every domain.
- Do not keep permanently unused version fields.

## Verification gate

Tests must assert exact version deltas for single mutations, transactions, no-ops, failed edits, and batched row/column operations.

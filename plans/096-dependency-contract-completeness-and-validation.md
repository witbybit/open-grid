# Plan 096: Dependency Contract Completeness and Validation

> **Why this is needed**: Active sort/filter/group dependency closure improved, but formula outputs, aggregation sources, and tree-parent callbacks still rely on incomplete or optional declarations. Dependency metadata is a correctness contract, not merely an optimization hint.

## Status

- **Priority**: P1 — derived-data correctness
- **Effort**: M
- **Risk**: MEDIUM — affects mutation classification fallbacks
- **Depends on**: Plans 082, 089
- **Category**: dependencies, formulas, tree data, correctness
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

`formulaFields` tracks computed output fields rather than their source fields. Updating `price` for computed `total` may therefore classify as value-only unless `total` is actively structural.

Tree parent dependencies are optional; an incorrect declaration can silently preserve the wrong hierarchy.

## What to add

### 1. Resolved source dependency sets

```ts
readonly formulaSourceFields: ReadonlySet<string>;
readonly aggregationSourceFields: ReadonlySet<string>;
readonly treeParentSourceFields: ReadonlySet<string>;
```

Resolve transitive computed dependencies where declarations permit it.

### 2. Opaque dependency policy

For opaque getters/callbacks without declarations:

- active structural use forces conservative structural refresh;
- non-structural formula use triggers dependent cell recomputation;
- tree parent callback defaults to structural refresh.

### 3. Development validation

In development/test mode, sample declared callbacks after updates:

- evaluate previous/current parent ID;
- detect a changed computed output whose declared sources did not match;
- report a runtime fault;
- force a safe refresh.

### 4. Documentation contract

Document dependency declarations as correctness-critical when opting into incremental mutation handling.

## Phases

### Phase 1 — Complete formula source tracking

- Replace output-only formula classification
- Add transitive dependency resolution

### Phase 2 — Tree and aggregation validation

- Validate declarations in development
- Add safe fallback on mismatch

### Phase 3 — Tests

- Computed output updates from source mutation
- Computed sort/filter/group dependency
- Incorrect tree dependency declaration detected
- Opaque getter fallback remains correct

## STOP conditions

- Do not trust missing declarations for structural callbacks.
- Do not run expensive validation in production hot paths.
- Do not silently continue after detecting dependency contract violations.
- Do not require parsing arbitrary JavaScript function bodies.

## Verification gate

Add adversarial tests with intentionally incomplete declarations and prove development mode reports the fault while output remains correct.

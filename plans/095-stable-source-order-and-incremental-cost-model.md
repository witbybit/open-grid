# Plan 095: Stable Source Order and Incremental Cost Model

> **Why this is the next row-model priority**: Incremental relocation now avoids full index-map recreation, but every sorted mutation still builds an O(N) source-index map. The fallback heuristic can also choose an O(N log N) rebuild over a cheaper partial O(N) reindex. Incremental behavior needs persistent source order and a measured cost model.

## Status

- **Priority**: P1 — large-model performance
- **Effort**: L
- **Risk**: MEDIUM — row store and sort stability
- **Depends on**: Plans 083, 089
- **Category**: row model, sorting, performance
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

For each sorted update or insertion, the pipeline creates a map from row ID to source index by scanning all nodes. This makes a one-row mutation O(N) before relocation begins.

The current threshold may also prefer a full sorted rebuild when a partial reindex touches a large suffix, despite full sort and reconstruction doing more work.

## What to add

### 1. Persistent source-order identity

Store stable source order on the row node or data store:

```ts
interface RowNode {
	readonly sourceOrder: number;
}
```

For mutable insert/remove order, use a maintained order key or data-store index accessor rather than rebuilding a map per mutation.

### 2. Stable comparator input

Sort tie-breaking reads persistent source order directly.

### 3. Operation-specific cost model

Separate policies for:

- sorted relocation;
- sorted insertion/removal;
- unsorted append/remove;
- filtered models;
- grouped/tree models;
- large batches.

The decision must consider total row count, earliest changed index, mutation count, and whether a full sort is required.

### 4. Benchmarks

Measure at 10k, 100k, and 1m rows:

- one sort-key update near start/middle/end;
- 50 updates;
- one insert and 50 inserts;
- partial reindex versus full rebuild;
- allocation volume.

## Phases

### Phase 1 — Persistent source order

- Add data-store ownership
- Remove per-mutation `sourceIndexOf` map creation
- Preserve stable sort semantics

### Phase 2 — Replace heuristic

- Introduce operation-specific decision functions
- Base thresholds on benchmark data

### Phase 3 — Regression gates

- Add large-model performance assertions with generous non-flaky bounds
- Verify output identity against full rebuild

## STOP conditions

- Do not use array index as stable source order if inserts/removes can invalidate it without maintenance.
- Do not optimize only the 100-row benchmark.
- Do not retain mathematically unsupported thresholds.
- Do not sacrifice stable sorting semantics.

## Verification gate

The one-row sorted update path must not allocate an N-entry source-index map and must produce identical ordering to a full rebuild.

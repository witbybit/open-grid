# Plan 120 — Portal Physical Identity Completion

**Written against commit:** `faf18afa`  
**Branch:** `rendering-architecture-v2-wip-3`  
**Depends on:** Plans 118 and 119 (all 8 tasks complete, 1206 tests passing)

---

## Why this matters

Plans 118–119 established stable CellSlot ownership (monotonic `cellInstanceId`) and
eliminated duplicated lane-inference code. Four correctness gaps remain that could allow
stale React renderer instances to survive row rebinds, or topology changes to be silently
skipped in the header:

1. `PortalMountManager.activeIdentityByKey` does not store `cellInstanceId`.  The stored
   identity only holds `rowSlotId + slotGeneration + cellRowBindingGeneration`, so a React
   cell renderer bound to a now-destroyed `CellSlot` cannot be distinguished from one bound
   to a freshly-created `CellSlot` at the same row/column if the row slot happens to keep
   the same generation.
2. `GridCellContentMount` has no `cellInstanceId` field, so the identity can never reach the
   React adapter or the portal store even if core tracks it.
3. `PortalMountManager.mountCellReal` still builds the React renderer key from
   `createSlotRendererKey(rowSlotId, col.field)` instead of
   `createCellInstanceRendererKey(cellInstanceId, col.field)`.  React therefore reuses the
   same component tree across CellSlot destruction/recreation cycles when the row-slot ID
   happens to be reused (pool recycling).
4. `HeaderRenderer.syncVisibleHeaders()` private bailout (lines 133–142) checks
   `colStart / colEnd / pinLeftCount / pinRightCount / colCount` but NOT `topologyVersion`.
   A topology change that leaves the column count and pin counts unchanged (e.g. a column
   pinned to a different side) is silently skipped.

**Forbidden approaches:**
- No full redraws, no broader invalidation, no larger overscan, no forced synchronous
  repaint, no removing React support, no clearing content earlier, no CSS-only hiding,
  no weakening tests, no changing perf budgets.

---

## Files in scope

| File | Change |
|---|---|
| `packages/core/src/renderer/IGridRenderer.ts` | Add `cellInstanceId` to `GridCellContentMount` and `GridCellContentUnmount` |
| `packages/core/src/renderer/cellSlot.ts` | Add `portalHostId` field |
| `packages/core/src/renderer/portalMountManager.ts` | Extract `CellPortalPhysicalIdentity`; add `cellInstanceId`; fix `createSlotRendererKey`; add `isSamePhysicalIdentity`; update stale checks |
| `packages/core/src/renderer/rowCellBinder.ts` | Pass `cellInstanceId` in both mount call sites |
| `packages/core/src/renderer/customRendererManager.ts` | Add `cellRowBindingGeneration` to `onMountCellContent` emit |
| `packages/core/src/renderer/headerRenderer.ts` | Fix topology version in private bailout |
| `packages/core/src/renderer/portalMountManager.test.ts` | Add stale identity regression tests |
| `packages/core/src/renderer/headerRenderer.test.ts` (new file) | Add topology bailout regression tests |

**Out of scope:** `floatingFilterRenderer.ts`, `stickyGroupRenderer.ts`, DOM cell renderer path,
plan README additions (done in Step 9 separately).

---

## Step 1 — Add `cellInstanceId` and `portalHostId` to `CellSlot`

**File:** `packages/core/src/renderer/cellSlot.ts`

`CellSlot` already has `cellInstanceId` (line 50, assigned `ci${++_cellInstanceCounter}`).
It does NOT have a stable `portalHostId` string.  Add it immediately after `cellInstanceId`:

```typescript
// After line 50 (cellInstanceId declaration):
/**
 * Stable string identifier for the portal host element of this cell.
 * Derived from cellInstanceId — never changes for the lifetime of this CellSlot.
 * Carries the instance ID across the portal boundary so the React adapter can
 * verify it is rendering into the correct physical host.
 */
public readonly portalHostId: string;
```

In the constructor (find the line that assigns `this.cellInstanceId`):
```typescript
this.cellInstanceId = `ci${++_cellInstanceCounter}`;
this.portalHostId = `${this.cellInstanceId}-ph`;
```

**Verification:** `npx tsc --noEmit` in `packages/core` — no errors.

---

## Step 2 — Add `cellInstanceId` and `portalHostId` to `GridCellContentMount`

**File:** `packages/core/src/renderer/IGridRenderer.ts`

`GridCellContentMount` (line 38) currently has:
```typescript
rowSlotId: string;
slotGeneration: number;
cellRowBindingGeneration?: number;
```

Add two optional fields immediately after `cellRowBindingGeneration`:
```typescript
/**
 * Stable identity of the physical CellSlot that owns this portal host.
 * Set by rowCellBinder at every mount call site. When present, allows
 * PortalMountManager to detect and reject mounts/releases from a different
 * CellSlot instance that happens to share the same rowSlotId and generation
 * (a pool-recycling corner case).
 */
cellInstanceId?: string;
/**
 * Stable host-element identifier matching CellSlot.portalHostId.
 * Optional: React adapters may use this for DOM integrity assertions.
 */
portalHostId?: string;
```

Also add `cellInstanceId?: string` to `GridCellContentUnmount` (line 73) immediately after
`cellRowBindingGeneration?`:
```typescript
cellInstanceId?: string;
```

**Verification:** `npx tsc --noEmit` — no errors.

---

## Step 3 — Pass `cellInstanceId` and `portalHostId` from both `rowCellBinder` call sites

**File:** `packages/core/src/renderer/rowCellBinder.ts`

### Site 1: `bindCellFull` — `portalMountManager.mountCell` call (~line 350–373)

Current call:
```typescript
deps.portalMountManager.mountCell({
    cellKey: stableKey,
    container: portalHost,
    ...
    rowSlotId: slotId,
    slotGeneration: request.slotGeneration,
    cellRowBindingGeneration: cellSlot.rowBindingGeneration,
    ...
});
```

Add two fields:
```typescript
    cellRowBindingGeneration: cellSlot.rowBindingGeneration,
    cellInstanceId: cellSlot.cellInstanceId,
    portalHostId: cellSlot.portalHostId,
```

### Site 2: `bindCellDuringScroll` — `portalMountManager.mountCellImmediately` (two call sites, ~lines 533 and 562)

Both scroll mount calls pass `cellRowBindingGeneration: cellSlot.rowBindingGeneration`.
Add immediately after that line in each call:
```typescript
    cellInstanceId: cellSlot.cellInstanceId,
    portalHostId: cellSlot.portalHostId,
```

**Verification:** `npx tsc --noEmit` — no errors.

---

## Step 4 — Extract `CellPortalPhysicalIdentity` and add `cellInstanceId`

**File:** `packages/core/src/renderer/portalMountManager.ts`

### 4a — Extract the inline type

Locate line 112:
```typescript
private activeIdentityByKey = new Map<string, { rowSlotId: string; slotGeneration: number; cellRowBindingGeneration: number }>();
```

Add a named interface immediately before the class or in the imports block (top of file, after imports):

```typescript
/** Full physical identity record for a mounted cell portal. Stored in activeIdentityByKey. */
interface CellPortalPhysicalIdentity {
    cellInstanceId: string;
    rowSlotId: string;
    slotGeneration: number;
    cellRowBindingGeneration: number;
}
```

Change line 112 to:
```typescript
private activeIdentityByKey = new Map<string, CellPortalPhysicalIdentity>();
```

### 4b — Add `isSamePhysicalIdentity` helper

Add a private method to `PortalMountManager` (place near `reportMissingPooledIdentity`):

```typescript
private isSamePhysicalIdentity(
    active: CellPortalPhysicalIdentity,
    op: { cellInstanceId?: string; rowSlotId: string; slotGeneration: number; cellRowBindingGeneration?: number }
): boolean {
    if (active.rowSlotId !== op.rowSlotId) return false;
    if (active.slotGeneration !== op.slotGeneration) return false;
    if (op.cellRowBindingGeneration !== undefined && active.cellRowBindingGeneration !== op.cellRowBindingGeneration) return false;
    if (op.cellInstanceId !== undefined && active.cellInstanceId !== op.cellInstanceId) return false;
    return true;
}
```

### 4c — Update `mountCellReal` to store `cellInstanceId`

Locate `mountCellReal` (line ~148). It currently does:
```typescript
this.activeIdentityByKey.set(mount.cellKey, {
    rowSlotId: mount.rowSlotId,
    slotGeneration: mount.slotGeneration,
    cellRowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
});
```

Change to:
```typescript
this.activeIdentityByKey.set(mount.cellKey, {
    cellInstanceId: mount.cellInstanceId ?? '',
    rowSlotId: mount.rowSlotId,
    slotGeneration: mount.slotGeneration,
    cellRowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
});
```

### 4d — Update `getActiveIdentity` return type

```typescript
public getActiveIdentity(cellKey: string): CellPortalPhysicalIdentity | undefined {
    return this.activeIdentityByKey.get(cellKey);
}
```

### 4e — Update both stale checks in `flushDeferred` to use `isSamePhysicalIdentity`

**Stale check for releases** (~line 430–438):
```typescript
// Current:
if (
    activeIdentity !== undefined &&
    (activeIdentity.rowSlotId !== unmount.rowSlotId ||
        activeIdentity.slotGeneration !== unmount.slotGeneration ||
        (unmount.cellRowBindingGeneration !== undefined && activeIdentity.cellRowBindingGeneration !== unmount.cellRowBindingGeneration))
) {

// Replace with:
if (activeIdentity !== undefined && !this.isSamePhysicalIdentity(activeIdentity, unmount)) {
```

**Stale check for mounts** (~line 464–474):
```typescript
// Current:
if (
    activeIdentity !== undefined &&
    (activeIdentity.rowSlotId !== mount.rowSlotId ||
        activeIdentity.slotGeneration !== mount.slotGeneration ||
        (mount.cellRowBindingGeneration !== undefined && activeIdentity.cellRowBindingGeneration !== mount.cellRowBindingGeneration))
) {

// Replace with:
if (activeIdentity !== undefined && !this.isSamePhysicalIdentity(activeIdentity, mount)) {
```

**Verification:** `npx tsc --noEmit` — no errors.

---

## Step 5 — Fix React renderer key in `mountCellReal`

**File:** `packages/core/src/renderer/portalMountManager.ts`

Locate the React renderer path in `mountCellReal` (~lines 190–195):
```typescript
// React renderer — goes through portal store
const rendererKey = mount.isEditing
    ? createEditRendererKey(node.id, col.field)
    : rowSlotId
        ? createSlotRendererKey(rowSlotId, col.field)
        : this.customRendererManager.getRendererKey(col, node.id, rowIndex, colIndex, mount.isEditing);
```

Replace with:
```typescript
// React renderer — goes through portal store
const rendererKey = mount.isEditing
    ? createEditRendererKey(node.id, col.field)
    : mount.cellInstanceId
        ? createCellInstanceRendererKey(mount.cellInstanceId, col.field)
        : rowSlotId
            ? createSlotRendererKey(rowSlotId, col.field)
            : this.customRendererManager.getRendererKey(col, node.id, rowIndex, colIndex, mount.isEditing);
```

Also add `createCellInstanceRendererKey` to the import from `'./identityKeys.js'` if not already present:
```typescript
import { createEditRendererKey, createSlotRendererKey, createDomSlotRendererKey, createDomIndexRendererKey, createCellInstanceRendererKey } from './identityKeys.js';
```

**Verification:** `npx tsc --noEmit` — no errors. Confirm `createSlotRendererKey` still has at least one usage (the fallback above) so no unused-import lint errors.

---

## Step 6 — Fix `customRendererManager.acquire` missing `cellRowBindingGeneration` in emit

**File:** `packages/core/src/renderer/customRendererManager.ts`

Locate `onMountCellContent?.({...})` around lines 213–228:
```typescript
this.onMountCellContent?.({
    cellKey: params.cellKey,
    rowSlotId: params.rowSlotId,
    slotGeneration: params.slotGeneration,
    container,
    value: params.value,
    node: params.node,
    col: params.col,
    isEditing: params.isEditing,
    isLoading: params.isLoading,
    phase: params.phase,
    isScrolling: params.isScrolling,
    isFocused: params.isFocused,
    isSelected: params.isSelected,
    lifecycleOperation: 'mount',
});
```

Add `cellRowBindingGeneration` and `cellInstanceId` immediately after `slotGeneration`:
```typescript
this.onMountCellContent?.({
    cellKey: params.cellKey,
    rowSlotId: params.rowSlotId,
    slotGeneration: params.slotGeneration,
    cellRowBindingGeneration: params.cellRowBindingGeneration,
    cellInstanceId: params.cellInstanceId,
    container,
    ...
});
```

Check that `AcquireParams` (the params type for `customRendererManager.acquire`) includes
`cellRowBindingGeneration` and `cellInstanceId`. If they are missing, add them as optional
fields to the `AcquireParams` interface:
```typescript
cellRowBindingGeneration?: number;
cellInstanceId?: string;
```

**Verification:** `npx tsc --noEmit` — no errors.

---

## Step 7 — Fix `HeaderRenderer.syncVisibleHeaders()` topology version bailout

**File:** `packages/core/src/renderer/headerRenderer.ts`

### 7a — Update `lastHeaderVisibleRange` type

Locate line 36:
```typescript
public lastHeaderVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1, colCount: -1 };
```

Add `topologyVersion`:
```typescript
public lastHeaderVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1, colCount: -1, topologyVersion: -1 };
```

### 7b — Get topology version in `syncVisibleHeaders`

In `syncVisibleHeaders` (private method), the compiled plan is already available because
the method calls `this.engine.columns.getCompiledPlan()`. Locate where `leafBand.cells` is
accessed (around line 129). The plan provides `plan.version` which equals the topology
version (established by Plans 118–119).

Add at the top of the method, after the layout plan and range are computed but before the bailout check:
```typescript
const compiledPlan = this.engine.columns.getCompiledPlan();
const topologyVersion = compiledPlan.version;
```

### 7c — Add topology version to the bailout condition

Current bailout (lines 133–142):
```typescript
if (
    !forceRepaint &&
    colStart === this.lastHeaderVisibleRange.startIdx &&
    colEnd === this.lastHeaderVisibleRange.endIdx &&
    pinLeftCount === this.lastHeaderVisibleRange.pinLeft &&
    pinRightCount === this.lastHeaderVisibleRange.pinRight &&
    colCount === this.lastHeaderVisibleRange.colCount
) {
    return;
}
```

Add `topologyVersion` check:
```typescript
if (
    !forceRepaint &&
    colStart === this.lastHeaderVisibleRange.startIdx &&
    colEnd === this.lastHeaderVisibleRange.endIdx &&
    pinLeftCount === this.lastHeaderVisibleRange.pinLeft &&
    pinRightCount === this.lastHeaderVisibleRange.pinRight &&
    colCount === this.lastHeaderVisibleRange.colCount &&
    topologyVersion === this.lastHeaderVisibleRange.topologyVersion
) {
    return;
}
```

### 7d — Update `lastHeaderVisibleRange` at the end of the method

Find the site where `lastHeaderVisibleRange` fields are updated after the body of
`syncVisibleHeaders`. It will look like:
```typescript
this.lastHeaderVisibleRange.startIdx = colStart;
this.lastHeaderVisibleRange.endIdx = colEnd;
this.lastHeaderVisibleRange.pinLeft = pinLeftCount;
this.lastHeaderVisibleRange.pinRight = pinRightCount;
this.lastHeaderVisibleRange.colCount = colCount;
```

Add:
```typescript
this.lastHeaderVisibleRange.topologyVersion = topologyVersion;
```

If `lastHeaderVisibleRange` is updated in a single object assignment rather than field-by-field, add `topologyVersion` to that assignment instead.

**Verification:** `npx tsc --noEmit` — no errors.

---

## Step 8 — Regression tests

### 8a — Portal stale identity tests in `portalMountManager.test.ts`

**File:** `packages/core/src/renderer/portalMountManager.test.ts`

Add a new `describe` block: `'flushDeferred — stale identity rejection'`

Write these 5 tests (model after the existing deferred-scroll tests in the same file):

**Test 1: releases rejected when slotGeneration advanced**
- Mount cell with `slotGeneration: 0, cellRowBindingGeneration: 0`
- Set scrolling → enqueue release with `slotGeneration: 0`
- Remount same cell with `slotGeneration: 1` (simulates row rebind)
- Stop scrolling, `flushDeferred`
- Verify release callback NOT called; `STALE_CELL_OPERATION_REJECTED` metric incremented

**Test 2: releases rejected when cellRowBindingGeneration advanced**
- Mount with `slotGeneration: 0, cellRowBindingGeneration: 0`
- While scrolling enqueue release with `cellRowBindingGeneration: 0`
- Remount with same `slotGeneration: 0` but `cellRowBindingGeneration: 1`
- `flushDeferred` — release must be rejected

**Test 3: releases rejected when cellInstanceId differs**
- Mount with `cellInstanceId: 'ci1', slotGeneration: 0, cellRowBindingGeneration: 0`
- While scrolling enqueue release with `cellInstanceId: 'ci1'`
- Remount with same `slotGeneration: 0` but `cellInstanceId: 'ci2'` (simulates CellSlot destroyed and recreated)
- `flushDeferred` — release must be rejected

**Test 4: deferred mount rejected when slotGeneration advanced**
- While scrolling enqueue mount with `slotGeneration: 0`
- Immediately remount (non-scrolling) with `slotGeneration: 1` — this writes `slotGeneration: 1` to `activeIdentityByKey`
- `flushDeferred` — the enqueued mount from generation 0 must be rejected (not call `onMountCellContent` a second time)

**Test 5: legitimate release NOT rejected when identity matches exactly**
- Mount with full identity including `cellInstanceId: 'ci1'`
- Enqueue release with same identity
- `flushDeferred` — release must be executed (callback called)

### 8b — Header topology bailout tests

**File:** `packages/core/src/renderer/headerRenderer.test.ts` (create new file)

This test must use `jsdom` environment and a minimal `GridEngine` mock (model after the pattern in `columnTopology.test.ts` which uses a plain plan object rather than a full engine).

Write these 3 tests in `describe('HeaderRenderer — topology version bailout')`:

**Test 1: header re-renders when topology version changes with same column count**
- Create a `HeaderRenderer` with a mock engine that returns a plan with `version: 1`
- Call `syncVisibleHeaders` with `pinLeftCount: 1, colStart: 0, colEnd: 5, colCount: 6`
- Change only `plan.version` to `2` (same column count, same pinning)
- Call `syncVisibleHeaders` again with identical visible range but `forceRepaint: false`
- Assert that the header re-rendered (check `lastHeaderVisibleRange.topologyVersion === 2`)

**Test 2: header bails out when topology version is identical**
- Call `syncVisibleHeaders` twice with the same visible range AND same `plan.version`
- Count DOM writes (spy on `headerCell.style.transform` setter or similar)
- Assert second call produces zero DOM writes

**Test 3: `forceRepaint = true` bypasses topology version check**
- Set `lastHeaderVisibleRange.topologyVersion` to the current version
- Call `syncVisibleHeaders({ forceRepaint: true })`
- Assert render runs despite matching topology version

**Verification for both test files:**
```
npx vitest run packages/core/src/renderer/portalMountManager.test.ts
npx vitest run packages/core/src/renderer/headerRenderer.test.ts
```
Both must pass. Then full suite:
```
npx vitest run --project core
```
All tests must pass (≥ 1206; new tests add to the count).

---

## Step 9 — Update `plans/README.md`

Add two rows to the table:
```markdown
| 118 | [Stable Cell View Ownership](./118-stable-cell-view-ownership-and-renderer-lifecycle.md) | DONE | faf18afa |
| 119 | [Unified Column Topology](./119-unified-column-topology-and-pinned-lane-rendering.md)    | DONE | faf18afa |
| 120 | [Portal Identity Completion](./120-portal-identity-completion.md)                         | TODO | faf18afa |
```

---

## Done criteria (machine-checkable)

Run these commands in order.  Each must succeed before the next.

```bash
# 1. TypeScript — zero errors
npx tsc --noEmit -p packages/core/tsconfig.json

# 2. Full test suite — all tests pass
npx vitest run --project core

# 3. Portal mount manager tests pass with stale identity coverage
npx vitest run packages/core/src/renderer/portalMountManager.test.ts

# 4. Header topology bailout tests pass
npx vitest run packages/core/src/renderer/headerRenderer.test.ts

# 5. cellInstanceId field present in GridCellContentMount
grep -n "cellInstanceId" packages/core/src/renderer/IGridRenderer.ts

# 6. createSlotRendererKey no longer the primary branch in mountCellReal
# (createCellInstanceRendererKey should appear first)
grep -n "createCellInstanceRendererKey\|createSlotRendererKey" packages/core/src/renderer/portalMountManager.ts

# 7. topologyVersion in lastHeaderVisibleRange object literal
grep -n "topologyVersion" packages/core/src/renderer/headerRenderer.ts
```

---

## Maintenance note

`CellPortalPhysicalIdentity` is the single source of truth for what makes a mounted cell
"the same physical cell" across async/deferred operations.  If new per-cell identity fields
are added to `CellSlot` in the future, add them here and to the `isSamePhysicalIdentity`
comparator — not scattered across call sites.  The `cellInstanceId` fallback (`?? ''`) in
`mountCellReal` is intentional: call sites that do not supply `cellInstanceId` (legacy paths,
tests) degrade to slot+generation identity which was the prior contract.

---

## Escape hatches

- If `headerRenderer.ts` has no single place where all five `lastHeaderVisibleRange` fields
  are written together — search for `lastHeaderVisibleRange.startIdx =` and update each
  individually (one per field write, add `topologyVersion` beside them).
- If `customRendererManager.ts` `AcquireParams` type is imported from a separate file
  (not defined inline), find the originating file via grep and update it there.
- If `syncVisibleHeaders` obtains the plan via `layoutPlan.columns.compiledTopology` rather
  than `this.engine.columns.getCompiledPlan()`, use `layoutPlan.columns.compiledTopology.version`
  as the topology version instead.  Do not call `getCompiledPlan()` a second time if the
  plan is already available on the layout plan.
- If TypeScript complains that `CellPortalPhysicalIdentity` is used before declaration,
  move the interface to the top of the file above the `PortalMountManager` class.

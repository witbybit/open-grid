# Plan 121 — React Portal Physical Identity Completion

**Written against commit:** `7f648390`  
**Branch:** `rendering-architecture-v2-wip-3`  
**Depends on:** Plan 120 complete (commit `5cb7d65c`)

---

## Why this matters

Plan 120 made core identity tracking 5-field-strong:
`cellInstanceId + rowSlotId + slotGeneration + cellRowBindingGeneration + portalHostId`.

But **the React boundary still constructs physical identity from only 2 fields** at every call
site in `GridView.tsx`:

```typescript
// GridView.tsx line 111 / 128 / 132-135 — ALL three portal operations
{ rowSlotId: mount.rowSlotId, slotGeneration: mount.slotGeneration }
```

And the React portal store `isSamePhysicalIdentity` only compares those two:

```typescript
// gridPortalStore.ts line 16
return left?.rowSlotId === right?.rowSlotId && left?.slotGeneration === right?.slotGeneration;
```

This means the stale-operation guarantees added in Plan 120 are **entirely bypassed** by the
time an operation reaches React. A stale async React update after a row rebind that keeps
the same slot generation will succeed when it should be rejected.

**Forbidden:** full redraws, broader invalidation, overscan changes, React removal, CSS
hiding, weaker tests, perf budget changes. This is identity-propagation only.

---

## Files in scope

| File | Change |
|---|---|
| `packages/react/src/gridPortalTypes.ts` | Expand `CellPortalPhysicalIdentity` to 5 fields |
| `packages/react/src/GridView.tsx` | Pass all 5 fields at every identity construction site |
| `packages/react/src/gridPortalStore.ts` | Update `isSamePhysicalIdentity` to compare all 5 fields |
| `packages/core/src/renderer/portalMountManager.ts` | Add `portalHostId` to core `CellPortalPhysicalIdentity`; update store + stale checks |
| `packages/core/src/renderer/IGridRenderer.ts` | Add `portalHostId?` to `GridCellContentUnmount` |
| `packages/core/src/renderer/rowRendererRuntime.ts` | Pass `cellInstanceId` + `portalHostId` in release objects |
| `packages/react/src/gridPortalStore.adversarial.test.ts` | Update to 5-field identity; add 3 new stale-rejection tests |
| `packages/core/src/engine/architectureGuards.test.ts` | Update Plan 110 guard to require all 5 fields |

**Out of scope:** `gridPortalHosts.tsx`, DOM cell renderer, floating-filter renderer,
sticky group renderer, row portal path, menu portal path.

---

## Step 1 — Expand `CellPortalPhysicalIdentity` in React types

**File:** `packages/react/src/gridPortalTypes.ts` lines 3–6

Current:
```typescript
export interface CellPortalPhysicalIdentity {
	rowSlotId: string;
	slotGeneration: number;
}
```

Replace with:
```typescript
export interface CellPortalPhysicalIdentity {
	readonly cellInstanceId: string;
	readonly rowSlotId: string;
	readonly slotGeneration: number;
	readonly rowBindingGeneration: number;
	readonly portalHostId: string;
}
```

Note: the core uses `cellRowBindingGeneration`; the React boundary normalises it to
`rowBindingGeneration` (no `cell` prefix). This is the ONLY place the rename happens —
all core files continue to use `cellRowBindingGeneration`.

**Verification:** `npx tsc --noEmit -p packages/react/tsconfig.json` — TypeScript errors
will appear in `GridView.tsx` and the adversarial test file. That is expected; fix them in
subsequent steps.

---

## Step 2 — Update `GridView.tsx` to pass all 5 fields

**File:** `packages/react/src/GridView.tsx`

There are **three** identity construction sites (lines ~111, ~128, ~132–135).

### Site 1 — `tryImperativeUpdate` call (~line 111)

Current:
```typescript
{ rowSlotId: mount.rowSlotId, slotGeneration: mount.slotGeneration }
```

Replace with:
```typescript
{
    cellInstanceId: mount.cellInstanceId ?? '',
    rowSlotId: mount.rowSlotId,
    slotGeneration: mount.slotGeneration,
    rowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
    portalHostId: mount.portalHostId ?? '',
}
```

### Site 2 — `mountCell` call (~line 128)

Current:
```typescript
{ rowSlotId: mount.rowSlotId, slotGeneration: mount.slotGeneration }
```

Replace with:
```typescript
{
    cellInstanceId: mount.cellInstanceId ?? '',
    rowSlotId: mount.rowSlotId,
    slotGeneration: mount.slotGeneration,
    rowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
    portalHostId: mount.portalHostId ?? '',
}
```

### Site 3 — `unmountCell` call (~lines 132–135)

Current:
```typescript
portalStore.unmountCell(unmount.cellKey, unmount.container, unmount.flushSync ?? false, {
    rowSlotId: unmount.rowSlotId,
    slotGeneration: unmount.slotGeneration,
});
```

Replace with:
```typescript
portalStore.unmountCell(unmount.cellKey, unmount.container, unmount.flushSync ?? false, {
    cellInstanceId: unmount.cellInstanceId ?? '',
    rowSlotId: unmount.rowSlotId,
    slotGeneration: unmount.slotGeneration,
    rowBindingGeneration: unmount.cellRowBindingGeneration ?? 0,
    portalHostId: unmount.portalHostId ?? '',
});
```

`unmount.portalHostId` does not exist on `GridCellContentUnmount` yet — add it in Step 3.

**Verification:** `npx tsc --noEmit -p packages/react/tsconfig.json`

---

## Step 3 — Add `portalHostId` to `GridCellContentUnmount`

**File:** `packages/core/src/renderer/IGridRenderer.ts`

`GridCellContentUnmount` already has `cellInstanceId?: string` (added Plan 120).
Add `portalHostId?` immediately after it:

```typescript
cellInstanceId?: string;
/** Stable portal host ID at the time this release was requested. */
portalHostId?: string;
```

**Verification:** `npx tsc --noEmit -p packages/core/tsconfig.json` — no errors.

---

## Step 4 — Pass `cellInstanceId` + `portalHostId` from `rowRendererRuntime.releaseCellPortal`

**File:** `packages/core/src/renderer/rowRendererRuntime.ts`

`releaseCellPortal` (~lines 220–268) reads from `activeIdentity` to build unmount objects.
Currently reads `rowSlotId`, `slotGeneration`, `cellRowBindingGeneration` — needs to
also read `cellInstanceId` and `portalHostId`.

Locate this block (~lines 243–256):
```typescript
const rowSlotId = activeIdentity.rowSlotId;
const slotGeneration = activeIdentity.slotGeneration;
const cellRowBindingGeneration = activeIdentity.cellRowBindingGeneration;

if (isDeferred) {
    this.deps.stateHost.currentScrollPortalOps++;
    this.deps.portalMountManager.releaseCellForScroll({
        cellKey,
        container,
        flushSync: false,
        rowSlotId,
        slotGeneration,
        cellRowBindingGeneration,
    });
} else {
    this.deps.portalMountManager.releaseCell({
        cellKey,
        container,
        flushSync: false,
        reason,
        rowSlotId,
        slotGeneration,
        cellRowBindingGeneration,
    });
}
```

Replace with:
```typescript
const rowSlotId = activeIdentity.rowSlotId;
const slotGeneration = activeIdentity.slotGeneration;
const cellRowBindingGeneration = activeIdentity.cellRowBindingGeneration;
const cellInstanceId = activeIdentity.cellInstanceId;
const portalHostId = activeIdentity.portalHostId;

if (isDeferred) {
    this.deps.stateHost.currentScrollPortalOps++;
    this.deps.portalMountManager.releaseCellForScroll({
        cellKey,
        container,
        flushSync: false,
        rowSlotId,
        slotGeneration,
        cellRowBindingGeneration,
        cellInstanceId,
        portalHostId,
    });
} else {
    this.deps.portalMountManager.releaseCell({
        cellKey,
        container,
        flushSync: false,
        reason,
        rowSlotId,
        slotGeneration,
        cellRowBindingGeneration,
        cellInstanceId,
        portalHostId,
    });
}
```

**Verification:** `npx tsc --noEmit -p packages/core/tsconfig.json` — no errors.

---

## Step 5 — Add `portalHostId` to core `CellPortalPhysicalIdentity` and update stale checks

**File:** `packages/core/src/renderer/portalMountManager.ts`

### 5a — Add `portalHostId` to the interface (~line 70)

Current:
```typescript
interface CellPortalPhysicalIdentity {
    cellInstanceId: string;
    rowSlotId: string;
    slotGeneration: number;
    cellRowBindingGeneration: number;
}
```

Add `portalHostId`:
```typescript
interface CellPortalPhysicalIdentity {
    cellInstanceId: string;
    portalHostId: string;
    rowSlotId: string;
    slotGeneration: number;
    cellRowBindingGeneration: number;
}
```

### 5b — Store `portalHostId` in `mountCellReal` (~line 168)

Current:
```typescript
this.activeIdentityByKey.set(mount.cellKey, {
    cellInstanceId: mount.cellInstanceId ?? '',
    rowSlotId: mount.rowSlotId,
    slotGeneration: mount.slotGeneration,
    cellRowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
});
```

Add `portalHostId`:
```typescript
this.activeIdentityByKey.set(mount.cellKey, {
    cellInstanceId: mount.cellInstanceId ?? '',
    portalHostId: mount.portalHostId ?? '',
    rowSlotId: mount.rowSlotId,
    slotGeneration: mount.slotGeneration,
    cellRowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
});
```

### 5c — Update `isSamePhysicalIdentity` to also check `portalHostId` (~line 157)

Current:
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

Replace with (add `portalHostId` check):
```typescript
private isSamePhysicalIdentity(
    active: CellPortalPhysicalIdentity,
    op: { cellInstanceId?: string; portalHostId?: string; rowSlotId: string; slotGeneration: number; cellRowBindingGeneration?: number }
): boolean {
    if (active.rowSlotId !== op.rowSlotId) return false;
    if (active.slotGeneration !== op.slotGeneration) return false;
    if (op.cellRowBindingGeneration !== undefined && active.cellRowBindingGeneration !== op.cellRowBindingGeneration) return false;
    if (op.cellInstanceId !== undefined && active.cellInstanceId !== op.cellInstanceId) return false;
    if (op.portalHostId !== undefined && op.portalHostId !== '' && active.portalHostId !== op.portalHostId) return false;
    return true;
}
```

Note: the `portalHostId` check is guarded by `!= ''` because `portalHostId` defaults to `''`
when not provided (legacy call sites without access to the CellSlot). An empty string means
"not provided" and the check is skipped, preserving back-compat for non-React paths.

**Verification:** `npx tsc --noEmit -p packages/core/tsconfig.json` — no errors.

---

## Step 6 — Update `isSamePhysicalIdentity` in the React portal store

**File:** `packages/react/src/gridPortalStore.ts` line 15–17

Current:
```typescript
function isSamePhysicalIdentity(left: CellPortalPhysicalIdentity | undefined, right: CellPortalPhysicalIdentity | undefined): boolean {
	return left?.rowSlotId === right?.rowSlotId && left?.slotGeneration === right?.slotGeneration;
}
```

Replace with strict 5-field comparison:
```typescript
function isSamePhysicalIdentity(
    left: CellPortalPhysicalIdentity | undefined,
    right: CellPortalPhysicalIdentity | undefined
): boolean {
    return (
        !!left &&
        !!right &&
        left.cellInstanceId === right.cellInstanceId &&
        left.rowSlotId === right.rowSlotId &&
        left.slotGeneration === right.slotGeneration &&
        left.rowBindingGeneration === right.rowBindingGeneration &&
        left.portalHostId === right.portalHostId
    );
}
```

No fallback. No compatibility mode. A stale operation must be rejected if any field differs.

**Verification:** `npx tsc --noEmit -p packages/react/tsconfig.json` — no errors.

---

## Step 7 — Update `gridPortalStore.adversarial.test.ts`

**File:** `packages/react/src/gridPortalStore.adversarial.test.ts`

All `mountCell`, `unmountCell`, and `tryImperativeUpdate` calls currently pass 2-field
identity objects. They must all be updated to 5-field objects.

### 7a — Helper constant

Add a helper at the top of the describe block (after the `COLUMN` constant):

```typescript
function makeIdentity(
    cellInstanceId: string,
    rowSlotId: string,
    slotGeneration: number,
    rowBindingGeneration = 0,
    portalHostId = `${cellInstanceId}-ph`
): import('./gridPortalTypes.js').CellPortalPhysicalIdentity {
    return { cellInstanceId, rowSlotId, slotGeneration, rowBindingGeneration, portalHostId };
}
```

### 7b — Update Test 1: "rejects stale imperative updates after slot generation rebinding"

Replace every `{ rowSlotId: 'slot-0', slotGeneration: N }` with `makeIdentity('ci1', 'slot-0', N)`.

The `.toEqual` assertion at line 79:
```typescript
expect(store.getCellData?.('slot-0:name')?.physicalIdentity).toEqual({ rowSlotId: 'slot-0', slotGeneration: 2 });
```
Replace with:
```typescript
expect(store.getCellData?.('slot-0:name')?.physicalIdentity).toEqual(makeIdentity('ci1', 'slot-0', 2));
```

### 7c — Update Test 2: "rejects stale imperative updates when slot id mismatches"

Replace `{ rowSlotId: 'slot-0', slotGeneration: 7 }` with `makeIdentity('ci2', 'slot-0', 7)`.
Replace `{ rowSlotId: 'slot-1', slotGeneration: 7 }` with `makeIdentity('ci2', 'slot-1', 7)`.

### 7d — Update Test 3: "ignores stale unmounts when physical identity mismatches"

Replace identity objects:
- mount: `makeIdentity('ci3', 'slot-0', 2)`
- stale unmount 1: `makeIdentity('ci3', 'slot-0', 1)` (older generation)
- stale unmount 2: `makeIdentity('ci3', 'slot-1', 2)` (wrong slot)

### 7e — Update Test 4: churn test

The churn test uses inline identity objects in `store.mountCell(...)` calls at line ~188.
Replace `{ rowSlotId: \`slot-${...}\`, slotGeneration: generation }` with:
```typescript
makeIdentity(`ci-${generation}`, `slot-${container === cellContainers[0] ? 0 : 1}`, generation)
```

### 7f — Add 3 new stale-rejection tests

Add after the existing tests, before the closing `});` of the describe block:

**Test: "rejects operations when cellInstanceId differs"**
```typescript
it('rejects stale operations when cellInstanceId differs (same slot + generation)', () => {
    const store = createPortalStore<TestRow>();
    const container = document.createElement('div');

    store.mountCell(
        'ci-a:name', container, 'A', makeNode('row-a'), COLUMN,
        false, false, undefined, undefined, undefined, undefined,
        makeIdentity('ci-a', 'slot-0', 0)
    );

    // Different cellInstanceId — same slot and generation but physically different cell
    store.unmountCell('ci-a:name', container, false, makeIdentity('ci-b', 'slot-0', 0));
    expect(store.getCellData?.('ci-a:name')?.value).toBe('A');
});
```

**Test: "rejects operations when rowBindingGeneration differs"**
```typescript
it('rejects stale operations when rowBindingGeneration differs', () => {
    const store = createPortalStore<TestRow>();
    const container = document.createElement('div');

    store.mountCell(
        'ci-c:name', container, 'C', makeNode('row-c'), COLUMN,
        false, false, undefined, undefined, undefined, undefined,
        makeIdentity('ci-c', 'slot-0', 0, 1)
    );

    // rowBindingGeneration 0 vs 1 — cell was hot-unbound and rebound
    store.unmountCell('ci-c:name', container, false, makeIdentity('ci-c', 'slot-0', 0, 0));
    expect(store.getCellData?.('ci-c:name')?.value).toBe('C');
});
```

**Test: "rejects operations when portalHostId differs"**
```typescript
it('rejects stale operations when portalHostId differs', () => {
    const store = createPortalStore<TestRow>();
    const container = document.createElement('div');

    store.mountCell(
        'ci-d:name', container, 'D', makeNode('row-d'), COLUMN,
        false, false, undefined, undefined, undefined, undefined,
        { cellInstanceId: 'ci-d', rowSlotId: 'slot-0', slotGeneration: 0, rowBindingGeneration: 0, portalHostId: 'ci-d-ph' }
    );

    store.unmountCell('ci-d:name', container, false,
        { cellInstanceId: 'ci-d', rowSlotId: 'slot-0', slotGeneration: 0, rowBindingGeneration: 0, portalHostId: 'ci-x-ph' }
    );
    expect(store.getCellData?.('ci-d:name')?.value).toBe('D');
});
```

---

## Step 8 — Update architecture guards

**File:** `packages/core/src/engine/architectureGuards.test.ts`

### 8a — Update the Plan 110 guard (~lines 1468–1474)

Current:
```typescript
it('React portal store requires physical identity for pooled cell mounts (Plan 110)', () => {
    const content = readFileSync(resolve(REACT_ROOT, 'src', 'gridPortalTypes.ts'), 'utf-8');
    expect(content).toContain('export interface CellPortalPhysicalIdentity');
    expect(content).toContain('rowSlotId: string;');
    expect(content).toContain('slotGeneration: number;');
    expect(content).toContain('physicalIdentity: CellPortalPhysicalIdentity;');
});
```

Replace with:
```typescript
it('React portal store requires physical identity for pooled cell mounts (Plan 110)', () => {
    const content = readFileSync(resolve(REACT_ROOT, 'src', 'gridPortalTypes.ts'), 'utf-8');
    expect(content).toContain('export interface CellPortalPhysicalIdentity');
    // All 5 required fields (Plan 121)
    expect(content).toContain('cellInstanceId: string;');
    expect(content).toContain('rowSlotId: string;');
    expect(content).toContain('slotGeneration: number;');
    expect(content).toContain('rowBindingGeneration: number;');
    expect(content).toContain('portalHostId: string;');
    expect(content).toContain('physicalIdentity: CellPortalPhysicalIdentity;');
});
```

### 8b — Update the `isSamePhysicalIdentity` guard (~lines 693–697)

Current:
```typescript
it('portal mount equality check compares full physical identity in React store (Plan 110)', () => {
    const content = readFileSync(resolve(REACT_ROOT, 'src', 'gridPortalStore.ts'), 'utf-8');
    expect(content).toContain('isSamePhysicalIdentity(existing.physicalIdentity, physicalIdentity)');
    expect(content).toContain('existing?.physicalIdentity');
});
```

Replace with:
```typescript
it('portal mount equality check compares full physical identity in React store (Plan 110/121)', () => {
    const content = readFileSync(resolve(REACT_ROOT, 'src', 'gridPortalStore.ts'), 'utf-8');
    expect(content).toContain('isSamePhysicalIdentity(existing.physicalIdentity, physicalIdentity)');
    expect(content).toContain('existing?.physicalIdentity');
    // All 5 fields must be compared — no 2-field weak check (Plan 121)
    expect(content).toContain('left.cellInstanceId === right.cellInstanceId');
    expect(content).toContain('left.rowBindingGeneration === right.rowBindingGeneration');
    expect(content).toContain('left.portalHostId === right.portalHostId');
});
```

---

## Step 9 — Verify

Run in order. Each must pass before the next.

```bash
# TypeScript — both packages clean
npx tsc --noEmit -p packages/core/tsconfig.json
npx tsc --noEmit -p packages/react/tsconfig.json

# Adversarial tests
npx vitest run packages/react/src/gridPortalStore.adversarial.test.ts

# Architecture guards
npx vitest run packages/core/src/engine/architectureGuards.test.ts

# Full core suite
cd packages/core && npx vitest run

# Full react suite
cd packages/react && npx vitest run
```

All test files must pass. The total test count will be ≥ 1217 (core) after architecture guard
updates, plus all React tests.

---

## Done criteria (machine-checkable)

```bash
# 1. All 5 fields in React type
grep -n "cellInstanceId\|rowBindingGeneration\|portalHostId" \
  packages/react/src/gridPortalTypes.ts

# 2. React store compares all 5 fields
grep -n "cellInstanceId === right.cellInstanceId\|rowBindingGeneration\|portalHostId" \
  packages/react/src/gridPortalStore.ts

# 3. GridView passes all 5 fields (no old 2-field literal)
grep -n "rowSlotId: mount.rowSlotId" packages/react/src/GridView.tsx
# Must be 0 matches — all sites replaced with object spread / full literal

# 4. Core CellPortalPhysicalIdentity includes portalHostId
grep -n "portalHostId" packages/core/src/renderer/portalMountManager.ts

# 5. Release objects include cellInstanceId + portalHostId
grep -n "cellInstanceId\|portalHostId" packages/core/src/renderer/rowRendererRuntime.ts

# 6. All tests pass
cd packages/core && npx vitest run 2>&1 | tail -3
cd packages/react && npx vitest run 2>&1 | tail -3
```

---

## Completion statement

When this plan is done, write:

> Plans 118–119 are complete because React portal ownership now uses full physical cell
> identity. Stale portal releases, stale row-binding updates, and stale host operations
> are rejected by cellInstanceId, rowBindingGeneration, and portalHostId. Pinning
> relocates retained cells without remounting React portals.

---

## Maintenance note

`CellPortalPhysicalIdentity` in `gridPortalTypes.ts` is the React boundary's contract with
the core physical cell model. If new per-cell lifecycle fields are added to `CellSlot` in
the future, they must flow through:
1. `GridCellContentMount` (core boundary type)
2. `GridView.tsx` (boundary adapter)
3. `CellPortalPhysicalIdentity` + `isSamePhysicalIdentity` (React store)

The `?? ''` / `?? 0` defaults in `GridView.tsx` are intentional: legacy test call sites that
do not supply `cellInstanceId` degrade gracefully to the prior 2-field contract. In production,
`rowCellBinder` always supplies all fields.

---

## Escape hatches

- If `packages/react/tsconfig.json` does not exist, use `npx tsc --noEmit` from `packages/react`.
- If the adversarial test `makeIdentity` helper causes a TypeScript complaint about the return
  type annotation, remove the explicit return type — TypeScript will infer it correctly.
- If `gridPortalStore.adversarial.test.ts` uses `{ rowSlotId, slotGeneration }` in more places
  than listed (the churn test has inline construction), update all occurrences.
- If `existing?.physicalIdentity` in the guard check is actually `existing.physicalIdentity`
  (non-optional), update the guard to match what is actually in the file.

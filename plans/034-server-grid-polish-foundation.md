# Plan 034: Server Grid Polish Foundation

> **Executor instructions**: Execute this plan completely. Prefer product-facing
> polish over deep architecture churn. Keep server-grid behavior stable while
> exposing the missing status signals the demo and future API work need.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/032-single-grid-entrypoint-lockdown.md`
- **Category**: product, server-grid, rendering
- **Planned at**: working tree, 2026-06-13

## Why this matters

The current server-grid surface already virtualizes and streams data, but the
product experience still feels rough in three places:

- block fetch failures only surface through runtime faults, not first-class grid
  events the UI can react to,
- pagination in the demo should be owned by `Grid` instead of raw scroll math, and
- selection behavior across unloaded blocks is opaque to the user even when the
  state itself is preserved.

This slice focuses on the highest user-facing payoff without redesigning the
server row model.

## Scope

**In scope**:

- `packages/core/src/api/GridEvents.ts`
- `packages/core/src/engine/runtimePorts.ts`
- `packages/core/src/engine/createRowModelRuntimes.ts`
- `packages/core/src/serverRowModel.ts`
- `packages/core/src/serverRowModel.test.ts`
- `packages/react/src/Grid.tsx`
- `packages/react/src/index.test.tsx`
- `demo/src/pages/InfiniteServerScroll.tsx`
- `plans/README.md`

**Out of scope**:

- server-side selection semantics redesign
- a new public server pagination hook or separate pagination wrapper requirement
- row model cache eviction strategy changes
- server datasource retry/backoff policy frameworks

## Steps

### Step 1: Expose server block failure as a first-class event

Add an explicit server block load failure event so server-grid UIs can respond
to fetch failures without scraping runtime faults.

### Step 2: Improve the server demo status surface

Update the server demo and public `Grid` surface to show:

- active loading state,
- last fetch failure with retry,
- built-in page controls driven by `Grid pagination={...}` instead of scroll syncing.

### Step 3: Make unloaded-block selection state legible

Show the difference between total selected row ids and currently loaded selected
rows so users can understand what remains selected while blocks are unloaded.

## Verification

1. `corepack pnpm --filter @open-grid/core build`
2. `corepack pnpm --filter @open-grid/core exec vitest run src/serverRowModel.test.ts`
3. `corepack pnpm --filter @open-grid/core test`
4. `corepack pnpm --filter @open-grid/react build`
5. `corepack pnpm --filter demo-app build`

## Done criteria

- [ ] Server block load failures emit a dedicated grid event.
- [ ] The server demo shows loading, failure, retry, and built-in `Grid` pagination.
- [ ] The server demo distinguishes total selected rows from loaded selected rows.
- [ ] Core build/tests and demo build pass.

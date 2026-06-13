# Plan 042: Remove React-layer pagination + status bar (thin the adapter)

> **Executor instructions**: This is a deletion + migration plan. Do NOT start until Plan 041 has landed (core must own client pagination slicing first, or client pagination regresses). It is mostly subtraction; the only additive work is a core status-bar panel config so no capability is silently dropped. Keep core + react + demo green.
>
> Part of Plan 040 (north-star). **Depends on Plan 041.**

## Status

- **Priority**: P1 (architecture clarity; depends on 041)
- **Effort**: M
- **Risk**: MEDIUM (public API removal — breaking change; demos must migrate)
- **Depends on**: Plan 041 (core client pagination), Plan 039 Phase 5 (core pagination + status-bar chrome)
- **Category**: architecture cleanup, public surface reduction
- **Planned at**: 2026-06-14

## Goal

Delete the React layer's pagination and status-bar implementations entirely. After this, pagination + status bar are **purely core chrome** (layer registry, Plan 039 Phase 5 + Plan 041 slicing). The React adapter stops reshaping data (`Grid.tsx` no longer slices rows) and stops shipping chrome components users must compose. This is the headline "better architecture" win: the adapter becomes thin.

## Current React inventory to remove (from audit)

**Files to delete outright:**

- `packages/react/src/pagination.tsx` (234 lines) — `useClientGridPagination` hook, `GridPagination` component, `getPageNumbers`, types `ClientGridPaginationResult`, `GridPaginationProps`.
- `packages/react/src/GridStatusBar.tsx` (52 lines) — `GridStatusBar` component + `GridStatusBarProps`.

**`packages/react/src/Grid.tsx` (245 lines) — remove pagination wiring:**

- `pagination?: boolean | GridPaginationOptions` prop (line ~26, ~77).
- Client pagination state + slice: `clientPage`, `clientTotalRows`, `clientPageCount`, `clampedClientPage`, `pagedClientRows` (lines ~98-114) — **the data-reshaping in the view layer that the north-star forbids.**
- Server pagination subscription wiring that exists only to feed `<GridPagination>` (lines ~117-119) — keep any `serverPagination` state read only if still needed by the core bar; otherwise remove.
- `<GridPagination>` render block (lines ~224-240) and `onPageChange` routing (`api.goToPage` / `setClientPage`).
- Pass `rows` (not `pagedClientRows ?? rows`) straight to the core grid (lines ~138-145).

**`packages/react/src/types.ts`:**

- `GridPaginationOptions` (lines ~79-88).

**`packages/react/src/index.ts`:**

- Line 3: `export { GridStatusBar }`.
- Line 4: `export { GridPagination, useClientGridPagination }`.
- Line 5: `export type { GridPaginationProps, ClientGridPaginationResult }`.
- Line 77: `GridPaginationOptions` from the type re-export block.

**Demos to migrate:**

- `demo/src/pages/RowMultiSelectDemo.tsx` (import + `<GridStatusBar/>` at line ~12, ~307; custom `SelectionStatusBar`).
- `demo/src/pages/PerformanceLab.tsx` (`pagination={{ pageSize: PAGE_SIZE }}` ~256).
- `demo/src/pages/InfiniteServerScroll.tsx` (`pagination={{ pageSize: 1000 }}` ~209).

## Capability-preservation (do this BEFORE deleting)

The React components expose capabilities the fixed core bars don't yet have. To avoid a silent regression, re-expose them as **core config** first:

1. **Status-bar custom panels.** `GridStatusBar` allowed custom `left`/`right` content (e.g. `SelectionStatusBar`). Add a core `statusBar` config — e.g. `showStatusBar: boolean | { panels?: StatusBarPanelDef[] }` where a panel is `{ id, align: 'left'|'right', render(api): string | HTMLElement }`. `statusBarRenderer` renders configured panels; default panels = today's Rows/Selected. This keeps the RowMultiSelectDemo's selection display possible without a React component.
2. **Pagination config.** Client pagination is now core (`state.pagination` + Plan 041 slicing); the demos' `pagination={{ pageSize }}` maps to the core `pagination` config (already on `GridEngineConfig`/`GridState`). The React `pagination` prop is removed; users set it via the grid options the adapter already forwards.
3. **Page-info / button customization** (the React `renderPrevButton`/`renderPageInfo`/`maxPageButtons`) is dropped in v1. If needed later, expose via core pagination config — note as follow-up, do not reintroduce a React component.

## Execution phases

### Phase 0 — confirm core parity (gate)

Verify Plan 041 landed: core client pagination slices; core status bar shows counts. Add the core `statusBar` panel config (capability-preservation #1) + tests. Build green.

### Phase 1 — migrate demos to core config

Switch the three demos to core `pagination`/`statusBar` config + default core bars. Replace `SelectionStatusBar` with a core status-bar panel def. Demo builds + visually verified (the bars render, counts live, pages navigate).

### Phase 2 — remove React exports + props

Delete the four `index.ts` export lines, `GridPaginationOptions` from `types.ts`, and the `pagination` prop + slicing/`<GridPagination>` wiring from `Grid.tsx`. `Grid.tsx` now forwards `rows` unchanged.

### Phase 3 — delete the files

Delete `pagination.tsx` and `GridStatusBar.tsx`. Remove any now-dead imports.

### Phase 4 — guard the invariant

Add an adapter guard test (in the `architectureGuards` style) asserting: `Grid.tsx` contains no row slicing/`pagedClientRows`, and `index.ts` no longer exports `GridPagination`/`GridStatusBar`/`useClientGridPagination`/`GridPaginationOptions`. This locks the north-star invariant "the React adapter never reshapes data."

## Verification

```sh
corepack pnpm --filter @open-grid/react build
corepack pnpm --filter @open-grid/react test
corepack pnpm --filter demo-app build
corepack pnpm --filter @open-grid/core test
```

## Scope

In: `packages/react/src/{pagination.tsx,GridStatusBar.tsx,Grid.tsx,types.ts,index.ts}`, the three demo pages, a core `statusBar` panel config + `statusBarRenderer`. Out: the pagination slicing engine (Plan 041), pin/exit animation (043/044).

## Review checklist — reject if it:

- Deletes React pagination before core slicing (Plan 041) is in — that regresses client pagination.
- Leaves any `pagedClientRows`/row slicing in `Grid.tsx` or any `.slice/.filter/.sort` of `rows` in `packages/react`.
- Drops the status-bar custom-content capability without the core panel config replacement.
- Leaves dangling exports/types referencing the deleted components.
- Forgets to migrate all three demos.

## STOP conditions

- If a demo relies on a pagination customization (custom buttons/page-info) with no core equivalent, add the minimal core pagination-config knob rather than keeping the React component — and note any deliberately-dropped capability in the PR.
- If removing the server-pagination subscription from `Grid.tsx` breaks the server demo's page controls, confirm the core bar + `paginationChanged` event cover the server case before deleting (server slicing is core already).

## Breaking-change note

This removes public exports (`GridPagination`, `GridStatusBar`, `useClientGridPagination`, `GridPaginationProps`, `ClientGridPaginationResult`, `GridPaginationOptions`) and the `<Grid pagination={...}>` prop. Call it out in the changelog; the migration path is the core `pagination`/`statusBar` config + built-in bars.

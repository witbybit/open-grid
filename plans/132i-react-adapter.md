# Plan 132i (Phase 10): React Adapter

Parent: [`132-core-rewrite-master.md`](./132-core-rewrite-master.md) · Spec: `ARCHITECTURE.md` §3 R12–R13, "React adapter exposes GridApi".

## Mission

A React adapter that creates the kernel/API once, exposes `GridApi` via context, and paints the
`RenderPlan` — consuming snapshots, never reaching into row models or `GridStore` (R12). Built
additively as new files under `packages/react/src/kernel/`; the old React layer is untouched until
Phase 11.

## Approach to coexistence

The new core API is exposed via `@open-grid/core/experimental` (already aliased by the react
package) under the migration surface — `createGrid`, `GridApi`, branded-id/type helpers. New React
files live in `packages/react/src/kernel/` so they do not collide with the old `Grid.tsx` etc.

## Files (new)

- `react/src/kernel/GridContext.tsx` — `GridApiProvider`, `useGridApi`, `useGridSelector`.
- `react/src/kernel/KernelGrid.tsx` — the grid component (creates API once, viewport wiring, paints plan).
- `react/src/kernel/index.ts` — barrel.
- `react/src/kernel/KernelGrid.test.tsx` — jsdom + @testing-library tests.

## Invariants

- The component creates the API once (`useRef`); `rowModelType` is immutable after mount (R6).
- The adapter renders only windowed rows from `getRenderPlan` (virtualization, R13).
- The adapter reads the API only — no `GridStore`, no row-model internals (R12).
- Re-render is driven by subscribing to kernel events; scroll updates the viewport directly.

## Task list

- [x] 10.1 Expose new API via a dedicated `@open-grid/core/next` subpath (NOT `experimental`, which is guard-tested). Wired: `core/src/next.ts`, core `package.json` exports `./next`, root tsconfig path, react vitest alias.
- [x] 10.2 `GridContext` (provider + `useGridApi` + `useGridSelector`).
- [x] 10.3 `KernelGrid` (create-once API, viewport size/scroll, paints render plan, destroy on unmount; `children` share the API).
- [x] 10.4 Barrel + jsdom tests (6).
- [x] 10.5 `tsc` clean + canonical suite green.

## Result

`packages/react/src/kernel/` (GridContext, KernelGrid, index) + `core/src/next.ts` migration entry.
6 jsdom tests: virtualization (windowed rows only), external cell write re-render, scroll updates
window, `useGridApi` in/out of provider, `rowModelType` fixed across prop change. All 6 gates met.

**Harness correction:** the canonical gate is `pnpm test` (per-package vitest with each package's
config/aliases), NOT `npx vitest run` from root. Under `pnpm test`: core **1457/1457**, react
**88/88** — fully green. The "7 pre-existing react failures" reported in earlier phases were an
artifact of the root `npx vitest run` resolving `@open-grid/core` to stale `dist/` instead of `src`;
they do NOT occur under the canonical harness. The cross-package-pollution task was dismissed as a
false premise.

## Verification gates

1. `KernelGrid` renders only the windowed rows (far fewer than total) with correct cell values.
2. An external `api.cells.setValue` re-renders the grid with the new value (event subscription).
3. `useGridApi` returns the API inside the provider and throws outside it.
4. `rowModelType` stays fixed when the component re-renders with a changed `rowModelType` prop.
5. Scrolling updates the visible window (different rows rendered).
6. `tsc` clean for react package; new tests green; only the 7 pre-existing react failures remain.

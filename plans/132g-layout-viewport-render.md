# Plan 132g (Phase 8): Layout, Viewport & Render Planning

Parent: [`132-core-rewrite-master.md`](./132-core-rewrite-master.md) · Spec: `ARCHITECTURE.md` §3 R12–R13.

## Mission

Build the projection layer: VisualModel + ColumnModel → **LayoutSnapshot** → **ViewportSnapshot** →
**RenderPlan**, plus a slot model for virtualization. The renderer consumes the plan; it never
recomputes business state (R12). Slots rebind during scroll rather than remount (R13).

## Files (new)

- `domains/layout/RowHeightModel.ts` — per-row heights, cumulative offsets, `rowIndexAtY`.
- `domains/layout/LayoutSnapshot.ts` — row geometry + `ColumnLayout` → one snapshot.
- `domains/viewport/VisibleWindow.ts` — `computeVisibleWindow(rowHeights, scrollTop, h, overscan)`.
- `domains/viewport/ViewportModel.ts` — runtime scroll/size state; derives the visible window.
- `domains/render/RenderPlan.ts` — `RenderPlan`/`RowRenderPlan`/`CellRenderPlan` + `buildRenderPlan`.
- `domains/render/SlotModel.ts` — `RowSlot` + `RowSlotPool` (reuse/rebind, not remount).
- `domains/render/RendererContract.ts` — `RendererContract { applyPlan(plan) }`.
- barrels + tests.

## Design note — scroll is runtime, not a kernel commit

Scroll/size are ephemeral high-frequency runtime state (R11). They update `ViewportModel` directly
and trigger a render-plan recompute; they do NOT go through the undoable commit pipeline. This is a
deliberate, documented exception consistent with R11's runtime/persistent split — routing every
scroll frame through commit/undo would be wrong. Business writes still go only through the kernel.

## Task list

- [x] 8.1 `RowHeightModel` (default + overrides, lazy cumulative offsets, binary-search `rowIndexAtY`).
- [x] 8.2 `LayoutSnapshot` (composes row geometry + `ColumnLayout`).
- [x] 8.3 `computeVisibleWindow` + `ViewportModel` (runtime scroll/size, derived window).
- [x] 8.4 `RenderPlan` + `buildRenderPlan` (windowed row/cell plans; injected getField/getCellValue).
- [x] 8.5 `RowSlotPool` (net released vs rebound) + `RendererContract`.
- [x] 8.6 Barrels + tests + `tsc --noEmit` clean + suite green.

## Result

`domains/layout/` + `domains/viewport/` + `domains/render/` complete. 14 new tests (row geometry,
visible window + viewport, render plan, slot pool reuse). Core build typecheck clean; only the 7
pre-existing react failures remain. All 5 gates met. Scroll/size are runtime state in
`ViewportModel` (not kernel commits, per the design note); the renderer paints `RenderPlan` and
rebinds slots rather than remounting (R12–R13).

## Verification gates

1. `RowHeightModel` cumulative offsets and `rowIndexAtY` correct with mixed heights.
2. `computeVisibleWindow` returns the right first/last index incl. overscan.
3. `buildRenderPlan` emits only windowed rows; data rows carry value, correct top/height/left/width.
4. `RowSlotPool` reuses slots across scroll: rows still visible keep their slot; gone rows free; new rows take freed slots (no churn).
5. `tsc --noEmit` zero errors; new tests green; only the 7 pre-existing react failures remain.

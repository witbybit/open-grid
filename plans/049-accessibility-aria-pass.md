# Plan 049: Accessibility / ARIA pass

## Status

- **Priority**: P1 (enterprise-critical; grid had almost no ARIA)
- **Effort**: M
- **Risk**: LOW–MEDIUM (per-cell attribute writes on the bind path — guarded)
- **Planned at**: 2026-06-14
- **Status**: **DONE (2026-06-14)** — core 602/602, react 70/70, core+react+demo builds clean.

## Problem

A feature-surface survey found the grid shipped with effectively no ARIA: no `role="grid"`/`row`/`gridcell`/`columnheader`, no `aria-rowcount`/`colcount`/`rowindex`/`colindex`, no `aria-sort`/`aria-selected`. Keyboard nav also lacked PageUp/PageDown and Ctrl+Home/End. Both are table stakes for an enterprise/finance grid.

## What landed

### Grid semantics

- **Container** (`viewportRenderer`): `role="grid"` + `aria-multiselectable="true"` on mount; `aria-rowcount` (visual row count) + `aria-colcount` (displayed columns) updated in `syncLayoutPlan`, **guarded** by `lastAriaRowCount`/`lastAriaColCount` so they only touch the DOM on change. Cleared on unmount.
- **Rows** (`rowSlot`): `role="row"` set once in the constructor; `aria-rowindex` (1-based) written in `update()` alongside the existing `data-row-index` change (already guarded by `lastVisualIndex`).
- **Cells** (`cellSlot`): `role="gridcell"` set once in the constructor; `aria-colindex` (1-based) written in the existing `colIndex`-change branch of `update()`; `aria-selected` via a new `ariaSelected?: boolean` param (guarded by `lastAriaSelected`, `undefined` = leave unchanged so the scroll bind path never clobbers it). Fed from `access.isSelected` in `bindCellFull` only — the scroll path is untouched (no per-frame selection writes).
- **Headers** (`headerRenderer`): `role="columnheader"` set once in `createHeaderCellElement`; `aria-colindex` + `aria-sort` (`ascending`/`descending`/`none`, omitted for non-sortable columns) written guarded in the leaf-cell render. Added `sortable` to `HeaderCellLayout` (compiled in `layoutPlan` from `column.sortable !== false`).

### Keyboard completion (`navigation.ts`)

- **PageUp/PageDown**: jump by a page (derived from `state.visibleRowRange.endIdx - startIdx`, fallback 10), snapping to the nearest data row via a new `clampToDataRow` helper.
- **Ctrl/Cmd+Home / Ctrl/Cmd+End**: jump to the first / last cell of the grid (first/last data row + col 0 / maxCol). Plain Home/End keep their row-start/row-end behavior.

## Performance

- All per-cell/row ARIA writes are guarded by the same change-tracking the renderer already uses (`lastVisualIndex`, `colIndex`, `lastAriaSelected`) → **zero extra DOM writes in steady state**. Static roles are set once at element creation. The scroll bind path (`bindCellDuringScroll`) is not touched; `aria-selected` is only computed on full binds. Container counts are guarded and only change on data/column changes.

## Verification

- `renderEngine.test.ts` — "exposes ARIA grid semantics": asserts `role=grid` + counts on the container, `role=row` + `aria-rowindex` on a row, `role=gridcell` + `aria-colindex` on a cell, `role=columnheader` + `aria-colindex` + `aria-sort` on a header, that `aria-sort` tracks the sort model, and that `aria-selected` appears on a selected cell after paint.
- core 602/602, react 70/70, core+react+demo builds clean.
- **Not browser-verified**: the Claude preview tab runs hidden (RAF paused) and the available browser-control MCP is macOS-only (`osascript`, fails on this Windows host). ARIA is pure DOM, so the jsdom test verifies it deterministically without a paint. Keyboard nav (PageUp/Down, Ctrl+Home/End) is logic-reviewed only — no navigation test harness exists yet; recommend an interactive check.

## Deferred / follow-ups

- ARIA `rowgroup` wrappers + putting `columnheader`s inside a `role="row"` (the multi-lane header layers make a clean single header-row structural change non-trivial; current flat `columnheader` + `aria-colindex` is widely supported but not strictly spec-complete).
- Header row not included in `aria-rowindex`/`rowcount` offset (data rows are 1-based among themselves) — simplification; revisit if AT testing flags it.
- `aria-activedescendant` / formal roving-tabindex focus model for the data grid (today focus uses per-cell tabindex).
- A navigation unit-test harness to cover keyboard movement (arrows + the new PageUp/Down/Ctrl-Home/End).

# Plan 134 — Pillar 4: Honest Row Model Scopes

> **Status**: Mostly complete (session 2026-06-22)

## Problem

`ClientGridIntegrityRowProvider._scanAllDataNodes` previously fell back to `getVisualRowCount()`/`getVisualRow(i)` when `getAllDataNodes()` was unavailable. This meant:

- `allRows` scope silently returned only visible rows for row models that don't implement `getAllDataNodes`
- `filteredRows` returned viewport-visible rows instead of all post-filter rows
- No indication of degradation to callers

## Completed (2026-06-22)

- ✅ Removed visual-row fallback — `_scanAllDataNodes` now returns `{ status: 'unsupported' }` when `getAllDataNodes()` not available
- ✅ Added `getFilteredDataNodes(): RowNode<TData>[]` to `ClientRowModelController` — returns all rows in `this.visualRows` (post-sort, post-filter, not viewport-bounded)
- ✅ Added `_scanFilteredNodes()` to `ClientGridIntegrityRowProvider` — uses `getFilteredDataNodes()` first, falls back to `getAllDataNodes()` with `complete: false` warning, returns `unsupported` if neither available
- ✅ Added `_asFilteredDataNodeCapable` duck-type helper alongside `_asAllDataNodeCapable`
- ✅ Architecture guard: `ClientGridIntegrityRowProvider must not fall back to visual rows for allRows scope`
- ✅ Architecture guard: `ClientRowModelController must implement getFilteredDataNodes`

## Remaining

| Task                                                              | File                          | Notes                                                                     |
| ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Add `getCurrentPageDataNodes()` to `ClientRowModelController`     | `rowModel.ts`                 | For pagination: rows on current page only                                 |
| Wire `currentPage` scope in `ClientGridIntegrityRowProvider`      | `GridIntegrityRowProvider.ts` | Currently still falls through to `_scanAllDataNodes`                      |
| Add `FilteredDataNodesCapableRowModel` interface to `rowModel.ts` | `rowModel.ts`                 | Type-safe duck-typing, expose publicly like `AllDataNodesCapableRowModel` |

## Invariants

- `allRows` scope NEVER degrades to visual rows. Return `unsupported` instead.
- `filteredRows` returns ALL rows passing the current filter, not just those in the scroll viewport.
- `visibleRows` is the only scope that is intentionally viewport-bounded.
- Row model scopes are honest contracts — `complete: false` means partial data, `unsupported` means the scope is genuinely unavailable.

# Plan 103 Direct-Write Inventory

Updated: 2026-06-18

This is the first checked-in inventory for the Plan 103 convergence pass. It records the remaining production files that still perform raw `setState` or invalidation writes outside the canonical typed-command path.

## Newly converted in this pass

- `renderer/floatingFilterRenderer.ts`
  Converted floating-filter mutations from renderer-owned `stateManager.setState(...)` + manual invalidation to `engine.setFilterModel(...)`.
- `renderer/paginationBarRenderer.ts`
  Converted client pagination page changes from renderer-owned state/event mutation to `engine.setPaginationPage(...)`.
- `store.ts`
    - Converted `setShowFloatingFilters(...)` from a direct state write to `engine.setShowFloatingFilters(...)`.
    - Converted hidden-column filter cleanup to `engine.setFilterModel(...)`.
    - Converted bulk row-height setters to `engine.setRowHeights(...)` / `engine.setDefaultRowHeight(...)`.
- `engine/createRowModelRuntimes.ts`
  Centralized runtime bootstrap/loading/pagination writes behind named `GridEngine` allowlist methods so the factory no longer mutates state directly.

## Current allowlist

The source-of-truth allowlist lives in [packages/core/src/engine/gridDirectWriteAllowlist.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/engine/gridDirectWriteAllowlist.ts:1).

## Remaining hot spots to convert next

- `features/GridStateFeatureController.ts`
    - `setRowOverscanPx`, `setColBuffer`, and compatibility fallbacks still write directly.
- `engine/GridEngine.ts`
    - Bootstrap, row-model registration, selection application, and `setData(...)` still perform direct writes.
- `store.ts`
    - Panel/chart toggles, viewport pin sync, and theme switching still bypass typed commands.
- `renderer/RenderInvalidationCoordinator.ts`
    - State-reaction invalidation remains active and will be reduced in Plan 105.

## Immediate count reduction from this pass

- Removed 8 renderer/store direct logical mutation sites:
    - `floatingFilterRenderer.ts`: 3
    - `paginationBarRenderer.ts`: 1
    - `store.ts`: 4

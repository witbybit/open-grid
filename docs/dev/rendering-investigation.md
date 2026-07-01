# Rendering Investigation

## Scroll hot path

Vertical scroll currently flows through:

1. `ScrollEngine` DOM listener
2. `RenderEngine.onScroll()`
3. `RenderScrollCoordinator.onScroll()`
4. `FrameCoordinator.requestScrollFrame()`
5. `RenderScrollCoordinator.flushScrollFrame()`
6. `RenderViewportCoordinator.syncLayoutPlan()`
7. `RowRenderer.recycleViewport()`
8. `RowRendererRuntimeBridge.bindAllDataCells()` / `bindAllLoadingCells()`
9. `bindCellDuringScroll()` or `bindCellFull()`
10. `PortalMountManager.mountCellImmediately()` / `mountCell()`
11. `CustomRendererManager.acquire()` / `rebindInstance()`
12. React adapter path: `GridView` -> `gridPortalStore.mountCell()` -> `PortalCellWrapper`

Post-scroll settle currently flows through:

1. `FrameCoordinator` transitions to `post-scroll`
2. `RenderScrollCoordinator.finishScrolling()`
3. budgeted `portalMountManager.flushDeferred()`
4. budgeted `rowRenderer.decorateDirtyCellsAfterScroll()`
5. optional `flushPaint()` if invalidations were deferred while scrolling

## Confirmed findings

- React/custom cells can update during active scroll. `bindCellDuringScroll()` calls `mountCellImmediately()` for portal cells.
- React/custom cells can also be released during active scroll when a slot changes content mode or a physical cell leaves the rendered pool.
- Portal snapshots are only supposed to rebuild on structural changes in `gridPortalStore`, but the previous metrics did not distinguish structural publishes from data-only refreshes.
- The previous row-slot strategy preserved staying-row ownership. `StableSlotAssigner` and `RowSlotPool` explicitly allowed slot index to diverge from viewport position.
- That divergence broke the intended invariant that physical slot `0` is the first rendered viewport row, slot `1` the next, etc.
- `expandAllGroups()` only collected grouped-row ids. Tree parents were not included, so tree-data expand-all was incomplete.

## Broken invariants before the fix

- Physical row-slot identity was row-owned, not viewport-position-owned.
- Scroll metrics conflated React refreshes with structural mounts.
- Tree expand-all did not expand tree parents.

## Fix direction

- Make viewport-position ownership the row-slot contract.
- Rotate the center slot slice for contiguous scroll so staying rows keep their physical hosts without breaking viewport order.
- Keep React cell identity anchored to physical cell hosts and count refreshes separately from mounts/unmounts.
- Track portal structural publishes and snapshot rebuilds in the React portal store.
- Expand both grouped rows and tree parents in the row-model expand-all path.

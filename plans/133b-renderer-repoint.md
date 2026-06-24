# Plan 133b (Stage 2): Re-point the renderer onto the new engine (approach B)

Parent: [`133`](./133-feature-parity-and-demolition.md). Decision (user): **approach B** — refactor the
renderer's data-access layer to consume clean new-engine snapshots; keep ALL of its DOM / slot /
layer / scroll / portal machinery. No reproduction of the old engine's leaky read surface.

## The problem (from the seam map)
The renderer's coordinators read old-engine internals directly and pervasively: `engine.geometry.rowTops/
colLefts` arrays, `engine.columns.getCompiledPlan()/getCompiledPlanVersion()`, `engine.viewport.*`,
`engine.stateManager.getState()`, `engine.invalidation.consume()` → `InvalidationFrame`,
`engine.getRowModel().getVisualRow(i)`, domain version counters, `setScrollStateProvider`,
`bindRuntimePorts`. So the re-point is a data-access refactor of the coordinators, not a one-line swap.

## The clean contract — `RendererEngineView<TRow>` (new engine's renderer-facing surface)
A single read interface the renderer consumes (assembled from pieces the new engine already has):
- structure: `getVisualRowCount()`, `getVisualRow(index)`, `getVisualModel()` (VisualModelView)
- geometry: `getGeometry()` → `LayoutSnapshot` (rowTop/rowHeight/totalHeight, columns ColumnLayout w/ pinned lanes)
- columns: `getColumns()` → `GridColumnHeader[]` (header text + lane/left/width + sort dir)
- viewport: `getViewport()` (ViewportSnapshot), `getVisibleWindow()`
- values: `getCellDisplayValue(rowId, field)`
- selection/edit read: `isRowSelected(rowId)`, `getActiveEdit()`
- change signal: `subscribe(listener)` (kernel events), `getVersion(domain)`
- ports: theme + render port binding

## Refactor sequence (bottom-up; demo on new engine is the no-regression gate at each step)
1. **Contract** — define `RendererEngineView` + expose `GridCore.getRendererView()` (THIS slice).
2. **Geometry** — rewrite `geometryController` / `layoutPlan` consumers to read `getGeometry()`/`ColumnLayout` instead of `engine.geometry.*` arrays + `getCompiledPlan()`.
3. **Rows/cells** — rewrite `rowRenderer` / `renderViewportCoordinator` to pull `getVisualRow(i)`/`getVisualRowCount()`/window from the view; keep slot assigner + pools.
4. **Invalidation** — replace `engine.invalidation.consume()` with a kernel-version-derived invalidation signal feeding the existing frame coordinator.
5. **Paint/state** — rewrite `renderPaintCoordinator` reads of `stateManager.getState()` to the view (styleRules/loading/defaults via explicit view accessors).
6. **Mount** — adapt `gridHost`/`RenderEngine` to construct against `RendererEngineView` + bind the new ports.
7. **Portals** — keep the React portal pool; feed it cell/row identity from the view.

## Gates
- New engine exposes a coherent `RendererEngineView` (tested) before any coordinator is touched.
- Each coordinator refactor keeps the demo rendering identically (the no-regression proof).
- No old-engine internal (`engine.geometry.rowTops`, `getCompiledPlan`, `invalidation.consume`) remains
  referenced by the renderer once its coordinator is migrated.

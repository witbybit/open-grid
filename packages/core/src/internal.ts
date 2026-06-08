export * from './store.js';
export * from './navigation.js';
export * from './serverRowModel.js';
export * from './rowModel.js';
export * from './ids.js';
export * from './viewportGeometry.js';
export * from './viewportController.js';

export * from './engine/GridEngine.js';
export * from './engine/GridEngineConfig.js';
export * from './state/StateManager.js';
export * from './commands/CommandHistory.js';
export * from './events/EventBus.js';
export * from './models/DataModel.js';
export * from './models/ColumnModel.js';
export * from './models/IndexMapper.js';
export * from './models/CellAccess.js';
export * from './models/ViewportModel.js';
export * from './models/GeometryModel.js';
export * from './models/SelectionModel.js';
export * from './models/EditModel.js';

export * from './renderer/scrollEngine.js';
export * from './renderer/IGridRenderer.js';
export * from './renderer/renderEngine.js';

// Renderer classes — internal to the rendering engine and framework adapters.
// Do not import these from application code; use @open-grid/core for public API.
export { GeometryController } from './renderer/geometryController.js';
export { InvalidationManager, type InvalidationFrame } from './renderer/invalidationManager.js';
export { PortalMountManager } from './renderer/portalMountManager.js';
export { RenderOrchestrator, type RenderStats } from './renderer/renderOrchestrator.js';
export { RenderScheduler } from './renderer/renderScheduler.js';
export { type GridScheduler, DefaultGridScheduler, defaultGridScheduler } from './renderer/gridScheduler.js';
export { type GridDiagnostics, NoopDiagnostics, ActiveDiagnostics, createDiagnostics } from './renderer/gridDiagnostics.js';
export { CellRenderer } from './renderer/cellRenderer.js';
export { FullWidthRowRenderer } from './renderer/fullWidthRowRenderer.js';
export { HeaderRenderer } from './renderer/headerRenderer.js';
export { OverlayRenderer } from './renderer/overlayRenderer.js';
export { RowRenderer } from './renderer/rowRenderer.js';
export { ViewportRenderer } from './renderer/viewportRenderer.js';
export { computeStableSlotRows } from './renderer/stableSlotAssigner.js';

// Grid host — low-level DOM mounting used by framework adapters, not application code.
export { mountGridHost, type GridCellContentAdapter, type GridHost, type GridHostOptions } from './gridHost.js';

// ApiBridge — internal reverse-lookup utilities for recovering engine/store from a public GridApi.
export * from './apiBridge.js';

// WeakMap-based store reverse-lookup. Prefer this over ApiBridge for new code.
export { getStoreFromApi } from './createGrid.js';

export * from './contextMenu.js';

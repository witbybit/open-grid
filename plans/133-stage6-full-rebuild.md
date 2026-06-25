# Open Grid — Full Rebuild TODO (Plan 133 Stage 6+)

> **Context:** Stage 5 deleted all old engine/renderer/React code. This file is the authoritative
> rebuild checklist — every feature that existed must be rebuilt on the new `GridKernel` +
> `RendererEngineView` architecture. Work top-to-bottom; each section unblocks the next.
>
> **Already done (do NOT re-list):** GridKernel, domain models (RowNode/ColumnDef/CellAddress/
> VisualRow/RowPipeline), RendererEngineView, basic DomGridRenderer (rows+header+scroll),
> GridApiFacade/createGrid, GridNext React adapter, styles.ts, themes.ts.

## Architecture Principles

- **Command-first, state-second**: every mutation flows through `GridKernel` commands; renderers and API facades are pure consumers of committed state, never mutating directly.
- **Zero-allocation hot path**: scroll frames must not allocate — reuse pre-allocated structs (`RenderWindow`, `ScrollRenderContext`), guard style writes with last-value caches, keep the 120 Hz scroll handler free of `getState()` calls.
- **Renderer knows nothing about data**: `DomGridRenderer` consumes `RendererEngineView` only; it never imports domain models or kernel internals.
- **Slot identity over slot position**: row and cell slots carry stable identity (`generation` counter + `rowId`/`columnId` keys); recycling reuses DOM nodes in-place; stale async ops detected by generation stamps.
- **Incremental by default**: every repaint path has a bailout (`sameRenderedWindow`, last-value guards, topology version stamps) so the common no-change case is a no-op.

---

## 1. DomGridRenderer — Visual Chrome

- [ ] **RenderWindow struct** — `rowStart/End`, `colStart/End`, pin counts, scroll position, viewport dimensions, version stamps, `visibleTop/Bottom`, `bufferTopPx/bufferBottomPx`, `stickyGroupStack`; `computeRenderWindowInto`, `applyRenderWindowRuntimeLimits`, `sameRenderedWindow`, `ViewportDelta`
- [ ] **Double-buffered RenderWindow** — two pre-allocated slots alternated each frame in `RenderScrollCoordinator` to avoid per-frame allocation
- [ ] **ScrollRenderContext** — reusable struct updated in-place per scroll frame (zero allocation); caches `maxScrollLeft`, `totalWidth`, `totalHeight`, `defaultRowHeight`, `hasSelectionOverlay`
- [ ] **FrameCoordinator / GridScheduler** — single pending-bit RAF arbiter; priority: scroll → paint → post-scroll; microtask coalescing; `GridScheduler` abstraction (`microtask`, `raf/cancelRaf`, `idle/cancelIdle` with 100 ms `requestIdleCallback` fallback, `timeout/clearTimeout`)
- [ ] **ScrollEngine** — passive scroll listener; high-resolution velocity tracking (px/ms X+Y, zero alloc); native `scrollend` with 50 ms fallback; programmatic `scrollTo()` syncs tracking state
- [ ] **RowSlotPool** — pool of physical `RowSlot` DOM owners; grow/shrink with viewport; `StableSlotAssigner` two-pass algorithm; `activeRows` map (visualRowIndex → RowSlot)
- [ ] **RowSlot** — `HTMLDivElement` with `role=row`; `translateY(Xpx)` positioning (not `top`); `style.height` guarded by last-value cache; `generation` counter; three `CellSlot[]` arrays (left/center/right); `cellsByColumnId` lifecycle map
- [ ] **PinnedContainerManager** — `.og-row-pin-left` / `.og-row-pin-right` child divs on demand; remove at zero width; guard width writes with last-value cache
- [ ] **Row kind class strings** — pre-built base className for `data`, `group`, `detail`, `loading`, `footer` (avoid string concat per row per frame)
- [ ] **Per-slot dirty buckets** — 4 priority levels: active-edit, focused cell, visible range, off-screen
- [ ] **CellSlot full bind** (`bindCellFull`) — className, style, `data-*`, pin class, column drag preview; dispatch to `TextRendererHandle`, `PortalRendererHandle`, `LoadingRendererHandle`, `CustomRendererHandle`; evaluate `cellStyleRules`; edit-mode transitions
- [ ] **CellSlot scroll fast path** (`bindCellScroll`) — skip style hooks + custom renderer refresh; only update transform/scroll-context metadata
- [ ] **GeometryController** — dirty-track invalidated rowIds/columnIds + `allInvalid`; `recomputeIfNeeded()` rebuilds column lefts and cumulative row-tops for dirty entries only
- [ ] **RenderPaintCoordinator** — detect structural invalidation (sort/group expansion/detail), arm `LayoutTransitionController`; `beginCellReleaseTransaction` / `endCellReleaseTransaction`; full paint vs viewport-only paths
- [ ] **RenderScrollCoordinator** — double-buffer `RenderWindow`; on scroll: `recycleViewport` fast path, mark overlay dirty, queue post-scroll portal-flush within budget; post-scroll decoration timer; cancel layout transitions on scroll start
- [ ] **Selection border overlay** — `selectionBorder` `HTMLDivElement`; `paintOverlay` computes `getOverlayBox(minRow, maxRow, minCol, maxCol)` with absolute position/size; `syncScrollPosition`
- [ ] **Row selection paint** (`SelectionPaintManager`) — `selectedRowIdSet` (O(1)), `hoveredRowIndex`, `rowCheckboxAnchorId`; `updateRowClassNameSlot` computes full row className including `og-row-hovered`, `og-row-selected`, custom `rowClass`/`getRowClass`; Ctrl/Cmd toggle, Shift range, single-click replace
- [ ] **Fill-drag handle** (`FillDragController`) — track start/end rows/columns; direction lock (VERTICAL/HORIZONTAL); dashed-border preview overlay; auto-scroll at edges; commit via kernel fill action
- [ ] **WAAPI layout transitions** (`LayoutTransitionController`) — `captureSnapshot` before change; animate each row from captured → live position with `element.animate()` (280 ms cubic-bezier); fade-out/shrink exit ghosts in `.og-layer-exiting`; `cancel()` on scroll; `prefers-reduced-motion` + jsdom fallback
- [ ] **Sticky group rows** (`StickyGroupRenderer`) — `Map<rowKey, HTMLDivElement>` in `.og-layer-sticky-groups`; `translate3d(0, top - scrollTop, 0)`; `zIndex = 34 + depth`; `og-sticky-group-pushed` class; mount row portal via `PortalMountManager`
- [ ] **Full-width row renderer** (`FullWidthRowRenderer`) — collapse cell lanes; insert `rowPortalHost`; mount via `PortalMountManager`; `release()` detaches portal on transition back to cell mode
- [ ] **Loading overlay** — layer-registry layer; show when row model loading/empty
- [ ] **Empty state overlay** — "no rows" state; hide when rows present
- [ ] **Validation tooltip** (`ValidationTooltipController`) — single `og-validation-tooltip` div on `document.body`; event-delegated `mousemove` finds `[data-validation-error]`; hidden during edit and `og-is-scrolling`; `MutationObserver` auto-hides on cell removal
- [ ] **Column-resize drag indicator** — visual drag bar in `OverlayRenderer` during column resize
- [ ] **Render telemetry counters** — `rowSlotBindsDuringScroll`, `cellSlotBindsDuringScroll`, DOM appends/removes, `sameWindowBailouts`, custom renderer warm/cold hits, per-frame histograms
- [ ] **Scroll-into-view** (`scrollIntoView.ts`) — pure `computeScrollTarget`: given geometry, pin counts, scroll position → minimal `{top, left}` delta; `null` when already visible; clamp to scroll bounds

---

## 2. React Portal System

- [ ] **PortalMountManager** — three portal types: cell content, row content, header menu; deferred mount queue with priority buckets (active-edit ≥ 1000, focused ≥ 900, rest); budget-gated `flushDeferred`; cell release transaction batching; stale-slot guard via generation stamps
- [ ] **CustomRendererManager** — pool of `RendererInstance` keyed by `rendererKey`; warm/cold acquire; LRU eviction; `CustomRendererStats`; `phase` (view/edit) and `isScrolling` flags
- [ ] **React PortalManager component** — two isolated sub-trees: `CellPortalPool` + `RowMenuPortalPool`
- [ ] **CellPortalPool** — subscribes to cell slot list; each portal keyed by `cellKey` (uses `createPortal` third arg to prevent index-based remounting)
- [ ] **RowMenuPortalPool** — group/detail/footer rows + header menu portals
- [ ] **PortalCell** — loading skeleton | active editor | custom `cellRenderer` React component
- [ ] **PortalCellWrapper** — slot-pinned adapter; `useState + lastKnownRef` to prevent blank-cell flashes during concurrent-mode transitions
- [ ] **ImperativePortalCellWrapper** — registers `ref.current.update()` that bypasses React scheduler for high-frequency value updates (`imperativeReact` renderer mode)
- [ ] **ActiveCellEditor** — mounted only during active edit; `cellEditor` component or default `<input>`; intercepts Enter/Escape → `api.commitEdit` / `api.stopEditing`
- [ ] **DefaultGroupRowRenderer** — fallback React renderer for group rows
- [ ] **DefaultDetailRowRenderer** — fallback React renderer for detail rows
- [ ] **DefaultFooterRowRenderer** — fallback React renderer for footer rows
- [ ] **mountGridHost contract** — `mountGridHost(api, container, options)` creates/binds `DomGridRenderer`; returns `GridHostWithAdapter` with `schedulePaint/*` variants, render stats, theme API, `destroy()`; exclusive single-host-per-grid guard
- [ ] **cellRenderer prop support** — React component (incl. `forwardRef` exotic for imperative path); `isDomCellRenderer` guard; props: `value`, `computedValue`, `row`, `rowId`, `colField`, `isScrolling`, `phase`, `isFocused`, `isEditing`, `isSelected`, `api`
- [ ] **cellEditor prop support** — React component; props: `rowId`, `colField`, `value`, `onChange`, `api`, `onCommit`, `onCancel`; fallback to `<input>`
- [ ] **GridView component** — mounts DOM renderer via `mountGridHost`; manages portal store, navigation, context menu, cell flash, sidebar, chart overlay
- [ ] **GridProvider component** — `GridApiContext.Provider`
- [ ] **Grid root component** — creates/destroys API instance; wires live prop updates (rows, columns, datasource, styleRules); renders `GridProvider` + `GridView`

---

## 3. GridApi — Public Methods

### Data / Rows

- [ ] **`getStateSnapshot`** — deep-frozen public state snapshot
- [ ] **`getRowId` / `isRowLoading`** — row identity helpers
- [ ] **`setRows` / `updateRows` / `applyTransaction` / `refreshRows`** — full replace, partial update, add/remove/update transaction, force refresh
- [ ] **`getRowOrder` / `setRowOrder`** — programmatic row reordering
- [ ] **`setRowHeights` / `setDefaultRowHeight`** — per-row and default height override
- [ ] **`getRowModelType` / `getRowModelCapabilities` / `supportsRowModelCapability`** — introspection
- [ ] **`purgeCache`** — clears infinite row model block cache
- [ ] **`setInfiniteDatasource`** — swap datasource on infinite model
- [ ] **`setServerPageDatasource` / `goToServerPage` / `nextServerPage` / `previousServerPage` / `setServerPageSize` / `refreshServerPage` / `getServerPageState`** — server-page controls
- [ ] **`getDataRowAtVisualIndex` / `getDataRowNodeAtVisualIndex`** — visual-index row access
- [ ] **`getRowNodeById` / `getRawRowById`** — row lookup by ID
- [ ] **`rows()` accessor** — `GridRowsAccessor`: `forEach`, `getAll`, `getSelected`, `getSelectedIds`, `getById`, `getNodeById`, `getCount`, `getVisualRowById`, `inRange`, `getChecked`, `getCheckedIds`

### Cell Values

- [ ] **`getCellValue` / `setCellValue` / `batchCellValues`** — single and bulk batch
- [ ] **`getFormula` / `hasFormula` / `setFormula` / `clearFormula`** — formula read/write/clear
- [ ] **`commitEdit`** — commit in-progress cell edit

### Cell Selection

- [ ] **`selectCell` / `selectRange` / `extendSelection`** — programmatic cell range manipulation

### Row Selection

- [ ] **`applyRowSelectionGesture` / `selectRows` / `deselectRows` / `toggleRowSelection` / `selectAllRows` / `clearRowSelection`**
- [ ] **`getSelectedRowIds` / `isRowNodeSelected` / `getSelectedRowCount`** — row selection read API

### Columns

- [ ] **`setColumns` / `setColumnWidth` / `autoSizeColumn` / `autoSizeAllColumns`**
- [ ] **`setColumnVisible` / `setColumnsVisible`**
- [ ] **`getColumns` / `getDisplayedColumns`**
- [ ] **`setPinnedColumns` / `getPinnedColumns`**
- [ ] **`moveColumn` / `setColumnOrder` / `setColumnReorderEnabled`**
- [ ] **`getColumnIndex` / `getColumnField` / `getColumnDef`**
- [ ] **`getColumnState` / `applyColumnState`** — full column state snapshot/restore
- [ ] **`getColumnDistinctValues`** — distinct value set for set filters

### Sort / Filter / Query

- [ ] **`setSortModel` / `setFilterModel`** (already partial — complete + expose on Grid props)
- [ ] **`getQueryModel` / `setQueryModel` / `clearQueryModel` / `evaluateQueryForRow`**

### Grouping / Aggregation

- [ ] **`setGroupBy` / `getGroupBy` / `addGroupBy` / `removeGroupBy` / `moveGroupBy`**
- [ ] **`setAggDefs` / `getAggDefs`**
- [ ] **`expandAllGroups` / `collapseAllGroups` / `toggleGroupExpanded` / `isGroupExpanded`**
- [ ] **`toggleDetailExpanded` / `isDetailExpanded`**
- [ ] **`setShowGroupFooter` / `setStickyGroupRows` / `setShowGroupPanel` / `setShowFloatingFilters` / `setShowFilterChipBar`**

### Editing

- [ ] **`startEditing` / `stopEditing`** — programmatic editing lifecycle

### Clipboard / Export

- [ ] **`copySelectedRange` / `pasteFromClipboard` / `copyRange`** — clipboard
- [ ] **`exportCsv`** — CSV export trigger

### Undo/Redo

- [ ] **`undo` / `redo` / `canUndo` / `canRedo`**

### Styling / Theme

- [ ] **`setStyleRules`** — conditional row/cell style rules
- [ ] **`getTheme` / `getThemeName` / `getAvailableThemes` / `switchTheme` / `mergeTheme` / `onThemeChange`**

### Sidebar / Chart

- [ ] **`openPanel` / `closePanel` / `togglePanel` / `getOpenPanel`**
- [ ] **`openChart` / `closeChart` / `toggleChart` / `isChartOpen`**

### Persistence

- [ ] **`hasPersistence` / `clearPersistedState` / `setAutoSave` / `isAutoSaveEnabled` / `getPersistenceStatus` / `subscribeToPersistenceStatus` / `saveNow`**
- [ ] **`getGridState` / `applyGridState`**

### Workspace / Views

- [ ] **`hasWorkspace` / `getWorkspaceState` / `subscribeToWorkspaceState`**
- [ ] **`listViews` / `saveView` / `updateView` / `applyView` / `deleteView` / `duplicateView` / `renameView` / `setDefaultView`**

### Subscriptions

- [ ] **`subscribe` / `subscribeToKey` / `subscribeToDomainVersions` / `subscribeDomain`**
- [ ] **`addEventListener` / `dispatchEvent`**

### Capabilities

- [ ] **`can` / `canEdit` / `canCopy` / `canPaste` / `canExport`**

### Diagnostics

- [ ] **`getRuntimeFaults` / `clearRuntimeFaults`** — ring-buffer fault log
- [ ] **`flushCellUpdatesSync`**
- [ ] **`getInstrumentation` / `setInstrumentation`**
- [ ] **`getInsightDiagnostics`**
- [ ] **`getVisibleColumnRange`**
- [ ] **`integrity`** — `DataIntegrity` API surface

### Lifecycle

- [ ] **`destroy`** — wire remaining subsystems (already partial)
- [ ] **`getContainer`** — return grid root DOM element

---

## 4. Events — GridEvents

- [ ] **Data** — `rowsUpdated`, `cellValueChanged`, `cellInvalidated`, `rowOrderChanged`
- [ ] **Columns** — `columnsChanged`, `columnOrderChanged`, `columnResized`, `columnReorderToggled`
- [ ] **Selection** — `selectionChanged`, `focusChanged`, `rowSelectionChanged`
- [ ] **Editing** — `editStarted`, `editStopped`, `cellValidationChanged`, `gridValidated`
- [ ] **Clipboard** — `cellsCopied`, `cellsPasted`
- [ ] **Sort/Filter** — `sortChanged`, `filterChanged`, `queryModelChanged`
- [ ] **Grouping** — `groupByChanged`, `groupColumnAdded`, `groupColumnRemoved`, `groupColumnMoved`, `showGroupFooterChanged`, `enableStickyGroupRowsChanged`, `aggDefsChanged`
- [ ] **Cell interaction** — `cellClicked`
- [ ] **Row drag** — `rowDragStart`, `rowDragMove`, `rowDragEnd`, `rowDragCancelled`
- [ ] **Pagination** — `paginationChanged`, `serverPageLoadingStarted`, `serverPageLoaded`, `serverPageLoadFailed`, `serverPageChanged`
- [ ] **Infinite scroll** — `infiniteBlockLoaded`, `infiniteBlockLoadFailed`
- [ ] **Row resize** — `rowResized`
- [ ] **Render** — `renderInvalidated`
- [ ] **Workspace** — `viewSaved`, `viewApplied`, `viewDeleted`, `viewRenamed`, `workspaceStateChanged`
- [ ] **Diagnostics** — `runtimeFault`

---

## 5. Row Models

- [ ] **InfiniteRowModelController** — block/range datasource (`InfiniteDatasource.getRows`); configurable block size (default 100); scroll-velocity-aware prefetch; server sort/filter passthrough; purge-on-sort/filter; emit `LoadingVisualRow` for unfetched blocks; `purgeCache` command; `infiniteBlockLoaded` / `infiniteBlockLoadFailed` events
- [ ] **ServerPageRowModelController** — page-at-a-time datasource; `ServerPageState` (page, pageSize, pageCount, totalRowCount, loading, error); `goToPage` / `setPageSize` / `reloadPage` commands; `serverPage*` events
- [ ] **RowModelCapabilities map** — per-model capability flags for all three row models
- [ ] **RowsAccessor adapter** — `GridRowsAccessor` (`forEach`, `getAll`, `getSelected`, `getSelectedIds`, `getById`, `getNodeById`, `getCount`, `getVisualRowById`, `inRange`, `getChecked`, `getCheckedIds`) over new kernel state

---

## 6. Grouping + Aggregation

- [ ] **GroupDef type** — `colId`, optional `keyCreator`, optional `comparator`; config: `model`, `defaultExpanded`, `expandedGroupIds`, `includeFooter`
- [ ] **aggregateStage pipeline stage** — compute `AggregationDef` results (`sum | avg | min | max | count` + custom); store on `GroupVisualRow.aggregateValues` and footer rows
- [ ] **flattenStage** — flatten group tree respecting expand/collapse state
- [ ] **FooterVisualRow** — per-group footer rows carrying aggregate values; wire to full-width renderer
- [ ] **GroupVisualRow fields** — `path[]`, `depth`, `expanded`, `childCount`, `leafCount`, `aggregateValues`
- [ ] **Expand/collapse tracking** — `Set<string>` of expanded group IDs; all four expand/collapse commands
- [ ] **Sticky group rows** — `setStickyGroupRows` command; wire `StickyGroupRenderer`
- [ ] **Group panel chrome** — `setShowGroupPanel` command; wire `GroupPanelRenderer`
- [ ] **AggregationDef type** — `field` + `aggFunc`; wire `setAggDefs` / `getAggDefs`
- [ ] **Group row renderer default** — expand icon, group key, aggregate summary in DOM/React

---

## 7. Tree Data

- [ ] **Tree data config** — `treeData` option: `getParentId(row)`, `defaultExpanded`, `expandedRowIds`, `filterMode: 'strict' | 'includeAncestors' | 'includeDescendants'`
- [ ] **treeStage pipeline stage** — build parent-child hierarchy from flat rows using `getParentId`
- [ ] **sortTreeStage** — sort within each tree level while preserving hierarchy
- [ ] **Tree expand/collapse** — `expandedRowIds` as `Set<string>`; toggle/expandAll/collapseAll commands
- [ ] **Tree row renderer** — indentation by depth, expand/collapse icon

---

## 8. Master/Detail

- [ ] **Master/detail config** — `masterDetail` option: `enabled`, `expandedRowIds`, `getDetailHeight(params)`, `defaultDetailHeight`
- [ ] **DetailVisualRow** — carries `parentId`, `height`, `render` payload; emitted after parent when expanded
- [ ] **`toggleDetailExpanded` / `isDetailExpanded`** — expand/collapse commands
- [ ] **Detail row renderer** — `DefaultDetailRowRenderer` React component; mount via `FullWidthRowRenderer` / `PortalMountManager`; custom `detailRowRenderer` prop
- [ ] **Detail row height** — `getDetailHeight(params)` called per row; stored in geometry model

---

## 9. Column Model

- [ ] **ColumnTopology compiler** — compile once per topology change; produce `placements[]` with `columnId`, `lane`, `laneIndex`, `absoluteIndex`, `absoluteLeft`, `laneOffset`, `width`; O(1) `byColumnId` map; per-lane arrays; `groupSegments[][]`; `pinLeftWidth`, `pinRightWidth`, `totalContentWidth`; diff output
- [ ] **Column group headers (band headers)** — `headerGroup` field on `ColumnDef`; multi-depth bands above leaf; lane-relative offsets in `GridLayoutPlan`; render in `HeaderRenderer`
- [ ] **Column resize drag handle** — drag handle on right edge of header cell; `ColumnInteractionController`; `setColumnWidth` command; `columnResized` event; `autoSizeColumn` / `autoSizeAllColumns`
- [ ] **Column reorder drag** — drag-to-reorder in header; column shift preview (`data-og-col-shift`); `moveColumn` / `setColumnOrder` commands; `columnOrderChanged` event; `setColumnReorderEnabled` / `columnReorderToggled`
- [ ] **ColumnDef complete field set** — wire all fields: `field`, `header`, `width`, `type`, `hide`, `loading`, `valueGetter`, `valueGetterDependencies`, `valueFormatter`, `valueSetter`, `renderer`, `cellEditor`, `headerMenuRenderer`, `sortable`, `enableRowGroup`, `suppressHeaderMenu`, `minWidth`, `maxWidth`, `tooltip`, `pinned`, `onCopy`, `onPaste`, `checkboxSelection`, `headerGroup`, `filterDef`, `filterType`, `filterValues`, `floatingFilterRenderer`, `disableCellRangeSelection`, `required`, capability callbacks
- [ ] **ColumnTypeDefinition registry** — `columnTypes` prop; built-in types (`multiSelectColumnType`, `dropdownColumnType`, `numberColumnType`); merge with per-column `type`

---

## 10. Layout Registry

- [ ] **LayerRegistry** — declarative registry of every structural layer: `id`, `className`, `parent`, sibling order, `init()`, `apply(el, plan)`; layers: group-panel, filter-chip-bar, header-wrapper (left/center/right), floating-filter-wrapper (left/center/right), sticky-groups, rows-container, exiting (pointer-inert), overlay, status-bar, pagination-bar
- [ ] **Two DOM roots** — scroll-viewport (`overflow:auto`) and container (`role=grid`)
- [ ] **Scoped per-grid CSS variable theming** — `data-og-theme-scope` attribute + `ThemeManager` injection
- [ ] **GridLayoutPlan model** — viewport, dimensions, chrome heights (groupPanel, filterChipBar, columnGroupHeader, leafHeader, floatingFilter, statusBar, pagination), rows geometry, columns geometry (lanes), origins (headerTop, rowLayerTop, etc.), `HeaderBands`, `StickyGroups`, `RenderWindow`, `CompiledColumnTopology`
- [ ] **WAAPI transitions between layout states** — wire `LayoutTransitionController` to layer registry; `prefers-reduced-motion` bypass; jsdom instant fallback

---

## 11. Sidebar Panels

- [ ] **Sidebar shell** — 44px icon tab strip + animated slide-open content panel (264px default); active panel from grid state; badge counts (active filters, active sorts)
- [ ] **ColumnsPanel** (`columns`) — column chooser: show/hide, reorder via drag; subscribes to `columnsChanged`
- [ ] **FiltersPanel** (`filters`) — active filter management: display/clear per-column filters
- [ ] **SortPanel** (`sort`) — sort model editor: add/remove/reorder sort fields
- [ ] **ThemesPanel** (`themes`) — theme switcher: list, preview, apply
- [ ] **ViewsPanel** (`views`) — saved workspace views: list, apply, rename, delete, set default
- [ ] **QueryPanel** (`query`) — structured query builder UI for `GridQueryModel`
- [ ] **DataIntegrityPanel** (`dataIntegrity`) — `GridIntegrityIssue` list by severity
- [ ] **Custom panel support** — `SidebarPanelDef<TRowData>` with `id`, `label`, `icon`, `render(api, onClose)`
- [ ] **`openPanel` / `closePanel` / `togglePanel` / `getOpenPanel`** — panel visibility kernel state

---

## 12. Header Chrome

- [ ] **HeaderRenderer** — three-lane header (center, left pin, right pin); stable cell map keyed by cell ID; DOM relocated on pin/unpin, not recreated; horizontally virtualised center columns; topology version check to skip redundant repaints; checkbox-select header
- [ ] **Sort indicator** — asc/desc/none icon; multi-column sort index badge; click to cycle
- [ ] **Filter chip on header** — indicator badge when column has active filter; click opens header menu filter tab
- [ ] **Column menu button** — `⋮` button; `suppressHeaderMenu` hides it; `headerMenuRenderer` / `headerMenuComponent` for custom content
- [ ] **Header menu popover** (`HeaderMenuController`) — single active `og-header-popover` overlay; anchor to header cell; sort controls, filter operator select, filter value input; 300 ms debounce; `PortalMountManager` for custom header component
- [ ] **Floating filter row** (`FloatingFilterRenderer`) — cells Map per column surviving reorder; text/number/date/set-filter inline inputs; 300 ms debounce; custom `floatingFilterRenderer`; operator-select + set-filter dropdowns (singletons); left/center/right sub-layers; `setShowFloatingFilters` command
- [ ] **Filter chip bar** (`FilterChipBarRenderer`) — horizontal strip of chips per active filter; × to clear single; "Clear all" button; clicking chip opens header menu; zero height when empty; `setShowFilterChipBar` command
- [ ] **Resize handle in header** — drag handle on right edge; `setColumnWidth` command on mouse-up

---

## 13. Data Integrity Pipeline

- [ ] **Built-in cell validators** — `required`, `email`, `min`, `max`, `number`, `date`, `oneOf`, `regex`, `customCellRule`
- [ ] **Row-level integrity rules** — `GridRowIntegrityRule` predicate evaluated per row
- [ ] **GridIntegrityIssue records** — `severity`, scope (cell/row/grid), field, rowId, message
- [ ] **DataIntegrityManager** — tracks all active issues; re-evaluate on `rowsUpdated` / `cellValueChanged`; emit `cellValidationChanged` / `gridValidated`; write `[data-validation-error]` on cell DOM nodes
- [ ] **DataIntegrity API** — `integrity` on `GridApi`: query issues, filter by row/col/severity, clear
- [ ] **Diff model** (`GridDiffModel`) — cell-level changes between two dataset snapshots; highlight added/removed/modified cells
- [ ] **Conflict tracking** — `GridCellConflict` / `ConflictResolutionResult`; concurrent edit conflicts
- [ ] **Live-stream transaction handles** (`GridTransactionStreamHandle`) — streaming batched cell updates with transaction semantics
- [ ] **GridInsightLayer / GridInsightRegistry** — `register`/`unregister`/`clear` per-layer; named layers: `dataQuality`, `diff`, `liveStream`, `conflict`, `dataIntegrity`; cell/row decoration (className, severity, title, data)
- [ ] **Validation tooltip wiring** — wire `ValidationTooltipController` to `[data-validation-error]`
- [ ] **`duplicateValueRule`** — built-in rule detecting duplicate values within a column

---

## 14. Persistence + Workspace

- [ ] **SerializedGridState schema v2** — `SerializedGridState` (column widths/order/visibility, sort/filter/query model, theme name, group-by fields, chrome flags); `GRID_STATE_SCHEMA_VERSION`; parse/validate/apply/prepare functions; reject mismatched schema blobs; deep-frozen `createGridStateSnapshot`
- [ ] **localStorage adapter** (`createLocalStorageAdapter(key)`) — synchronous load/save/clear
- [ ] **PersistenceController** — debounced (500 ms) subscription to persistence-relevant kernel keys; auto-save; `setAutoSave`, `saveNow`, `clearPersistedState`, `getPersistenceStatus`, `subscribeToPersistenceStatus`
- [ ] **GridViewDefinition type** — `id`, `name`, `description`, `scope`, `createdAt`, `updatedAt`, `version`, `state`
- [ ] **GridWorkspaceAdapter interface** — pluggable storage backend; `createLocalStorageWorkspaceAdapter` built-in
- [ ] **GridWorkspaceController** — CRUD: `saveView`, `updateView`, `deleteView`, `duplicateView`, `renameView`, `setDefaultView`; active view tracking; `view*` events; `listViews`, `applyView`
- [ ] **Wire persistence to GridKernel** — subscribe `PersistenceController` to kernel state; restore on init

---

## 15. Export

- [ ] **CSV export** (`exportToCsv`) — `CsvExportOptions`: fileName, delimiter, column subset, selected-only, explicit rowIds; respect `valueFormatter`; RFC-4180 quoting; UTF-8 BOM blob download; `api.exportCsv()`
- [ ] **Clipboard copy** (`ClipboardController`) — copy selected range as tab-delimited text; `onCopy` per-column hook; `cellsCopied` event; `api.copySelectedRange()` / `api.copyRange()`
- [ ] **Clipboard paste** — paste into selected range; `valueSetter` per column; validation check; `cellsPasted` event
- [ ] **Clipboard cut** — copy + clear source cells; batch via `batchCellValues`

---

## 16. Query API

- [ ] **GridQueryModel types** — `GridQueryModel`, `GridQueryGroup`, `GridQueryCondition` (arbitrary AND/OR tree, distinct from per-column `FilterModel`)
- [ ] **evaluateQueryModel** — wire to `RowPipeline` as additional filter stage
- [ ] **queryOperatorRegistry** — map column types to valid query operators
- [ ] **QueryConditionDiagnostic** — report unknown columns/operators
- [ ] **Filter model types** — `ColumnFilter` discriminated union: `TextFilterCondition`, `NumberFilterCondition`, `DateFilterCondition`, `SetFilterCondition`, `SelectFilterCondition`; `FilterModel = Record<string, ColumnFilter>`
- [ ] **Filter operations metadata** — `TEXT_OPS`, `NUMBER_OPS`, `DATE_OPS` tables; `getOpsForType`; `applyFilterToModel`; `isFilterableColumn`
- [ ] **Filter UI render modes** — six modes: `multi-select`, `single-select`, `async-multi-select`, `async-single-select`, `infinite-multi-select`, `custom`; shared primitives: `FilterSearchInput`, `FilterOptionList`, `FilterSelectAll`, `FilterStatusBar`, `FilterOptionItem`

---

## 17. Theming

- [ ] **ThemeManager in GridNext props** — accept `theme` prop; call `ThemeManager.switchTheme` on change
- [ ] **Per-grid CSS variable injection** — `data-og-theme-scope` on each grid root; `ThemeManager.applyThemeScope(element, themeName)`
- [ ] **`mergeTheme`** — partial theme token override merged onto base theme; wire to `api.mergeTheme()`
- [ ] **`onThemeChange` subscription** — notify React and external consumers on theme change
- [ ] **Wire all theme API to GridApiFacade** — `getTheme`, `getThemeName`, `getAvailableThemes`, `switchTheme`

---

## 18. Demo Pages — Acceptance Tests

Each page must work end-to-end before Stage 6 is declared complete.

- [ ] **CalculationsArena (`#perf`)** — 10k rows, `StyleRule`, `applyTransaction`, `editTrigger`, `arrowKeyNavigationEdit`, `pinLeftColumns`/`pinRightColumns`, "massive columns" mode
- [ ] **InfiniteServerScroll (`#server`)** — `rowModelType: infinite`, simulated latency + failure injection, block-loading stats, severity stats, selection across unloaded rows
- [ ] **SpreadsheetWorkspace (`#ranges`)** — range selection, formula bar, `onCopy` per-column, custom context menu, range mutations via `api.updateRows`
- [ ] **CustomEditorRenderer (`#editors`)** — custom `cellRenderer` + `cellEditor`, `GridStateSnapshot`, `editTrigger`, telemetry panel
- [ ] **DynamicLayout (`#layout`)** — dynamic `rowHeight` (compact/normal/spacious), column visibility toggle, `api.subscribeToKey('selection')`, focused-cell indicator
- [ ] **HeadlessSkinsPlayground (`#skins`)** — live CSS-variable theming via `ThemeTweaker`, preset themes, `pinLeftColumns`/`pinRightColumns`
- [ ] **RealtimeDashboard (`#dashboard`)** — `GridTransactionStreamHandle`, `duplicateValueRule`, `StyleRule` by change direction, integrity issues panel
- [ ] **GanttSchedulingWorkspace (`#gantt`)** — custom Gantt cell renderers, `StyleRule` by status, `onCellValueChanged` side-effects
- [ ] **NestedTablesGrouping (`#nested`)** — nested/expandable rows, multiple independent grids, `CellRendererProps` expand/collapse
- [ ] **PerformanceLab (`#lab`)** — four renderer modes: `text`, `dom`, `imperativeReact`, `deferredReact`; bulk-update benchmarks
- [ ] **SidebarPanelsDemo (`#panels`)** — `SidebarPanelDef` custom sidebar panel
- [ ] **NativeCellTypesDemo (`#native`)** — `multiSelectColumnType`, `dropdownColumnType`, `numberColumnType`; `ColumnTypeDefinition` registry
- [ ] **RealtimeGroupingDemo (`#grouping`)** — grouping, `AggregationDef` (sum/count), `GroupVisualRow` expand/collapse, live streaming updates
- [ ] **RowMultiSelectDemo (`#multiselect`)** — `checkboxSelection`, all selection API methods, all three `rowModelType` modes, `rowSelectionChanged` event
- [ ] **CrudValidationDemo (`#crud`)** — `GridIntegrityIssue`, `GridCellIntegrityRule`, `GridRowIntegrityRule`, `SidebarPanelDef` submission log, add/delete rows
- [ ] **WideGridDemo (`#wide`)** — 100-column horizontal virtualization, `api.getVisibleColumnRange()`, adjustable `colBuffer`
- [ ] **ColumnGroupHeaderDemo (`#colgroups`)** — column group headers spanning multiple columns, financial data
- [ ] **ClipboardDemo (`#clipboard`)** — `cellsCopied`/`cellsPasted` events, `onCopy`, `valueFormatter`, copy/paste event log
- [ ] **FloatingFiltersDemo (`#floatingfilters`)** — custom `FloatingFilterRendererParams`, `FilterModel` programmatic filter, `showFloatingFilter` column prop
- [ ] **RowDragDemo (`#rowdrag`)** — `rowDrag: true`, managed vs unmanaged drag, `api.getRowOrder()`/`setRowOrder()`, `rowDragEnd` event log
- [ ] **AdvancedFiltersDemo (`#advancedfilters`)** — `GridWorkspaceAdapter`, named views, `PersistedGridState`, `CustomFilterRendererParams`, `view*` events
- [ ] **DataIntegrityLab (`#integrity`)** — `duplicateValueRule`, `GridTransactionStreamHandle`, `GridDiffModel` diff view, `GridIntegrityIssue` reporting
- [ ] **NewEngineDemo (`#new-engine`)** — ✅ already working

---

## 19. Capabilities + Plugins

- [ ] **GridCapabilitiesConfig** — per-action callbacks: `canEdit`, `canSort`, `canFilter`, `canSelect`, `canCopy`, `canPaste`, `canGroup`, `canFill`, `canPin`, `canResize`, `canDelete`, `canExpand`, `canDrag`, `canMoveColumn`, `canExport`, `canPerformAction`; each receives `GridCapabilityParams`, returns `boolean | GridCapabilityResult`
- [ ] **GridCapabilityManager** — `can()` evaluates column-level → boolean column props → grid-level → `canPerformAction`; first denial wins; diagnostics
- [ ] **GridPlugin interface** — lifecycle hooks: `onInit(runtime)`, `onDestroy()`, `onViewportChange(range)`
- [ ] **GridPluginRegistry** — name-keyed map; re-registering destroys old plugin
- [ ] **GridPluginRuntime** — full internal API surface (rows, columns, selection, sort/filter, grouping, editing, undo/redo, persistence, themes) exposed to plugins
- [ ] **registerGridNavigation** — `GridNavigationController`: arrow-key movement, Tab/Shift-Tab, click-to-focus, mouse-drag range selection, editing lifecycle; `editTrigger`, `arrowKeyNavigationEdit`, `onCellValueChanged`; returns `GridNavigationHandle`
- [ ] **registerGridContextMenu** — `GridContextMenuPlugin`: HTML context menu; built-in items (copy, cut, paste, clear, selectAll, filterByValue, clearColumnFilter, exportAll/exportSelected, divider); `disableDefaults`, `excludeDefaults`, `customItems`; keyboard roving; returns `GridContextMenuHandle`

---

## 20. Calculations (DAG)

- [ ] **DagEngine core** — pure in-memory formula engine; formulas keyed by `rowId\0colField`; `[rowId:colField]` reference syntax; supported functions: `SUM`, `AVERAGE`, `MIN`, `MAX`; Shunting-yard arithmetic (no `eval`)
- [ ] **registerFormula** — DFS cycle detection before commit; throw on circular dependency
- [ ] **invalidateCell** — propagate dirty marks upstream through `dependents` map recursively
- [ ] **getCellValue (formula)** — lazy evaluation of dirty cells; reentrancy protection
- [ ] **Formula API on GridApi** — `getFormula`, `hasFormula`, `setFormula`, `clearFormula`; wire invalidation to `cellInvalidated` event
- [ ] **SpreadsheetFillEngine** (`fillRange.ts`) — `fillRange()` auto-detects direction; numeric series detection (linear step); formula offset rewriting; commit via `engine.batchCellValues()`; wire to `FillDragController`

---

## Supplementary: Cross-Cutting Concerns

- [ ] **ID generation** (`ids.ts`) — `createRowId`, `createColumnId`, `createCellId`, `createCellKey` (unit-separator delimited), `createFormulaRefKey`; `normalizeGridId`; `validateRowIds` (throws on empty/duplicate)
- [ ] **Row drag** (`RowDragController`) — drag-to-reorder rows; managed vs unmanaged; `rowDrag: true` / conditional callback; auto-scroll during drag; `rowDrag*` events
- [ ] **CommandHistory (undo/redo)** — ring-buffer; integrate `batchCellValues`, `setCellValue`, column mutations, row mutations as undoable
- [ ] **GridStateFeatureController** — sort/filter/query model, `showGroupFooter`, `enableStickyGroupRows`, `showGroupPanel`, `showFloatingFilters`, `showFilterChipBar` as kernel state slices
- [ ] **DataMutationController** — `applyTransaction`; dirty-track changed rowIds; emit `rowsUpdated`; integrate undo/redo
- [ ] **GridInstrumentation** — `NoopGridInstrumentation` (production) + `RecordingGridInstrumentation` (tests); named counters (`GridMetric`), per-frame timing (`FrameMetrics`)
- [ ] **RuntimeFaultReporter** — ring-buffer capturing `RuntimeFault` records; emit `runtimeFault` event; 13 named sources
- [ ] **React hooks** — `useGridApi<TRowData>()`, `useGridSelector<T>(selector, isEqual?)` (useSyncExternalStore + generation-counter cache), `useGridKeySelector<T>(key, selector, isEqual?)`, `useGridNavigationController(options, enabled)`
- [ ] **React contexts** — `GridApiContext`, `GridAdapterContext`
- [ ] **Grid root props completeness** — wire all `GridCommonProps`: `getRowId`, `initialState`, `persistence`, `workspace`, `rowOverscanPx`, `colBuffer`, `overscanAdaptive`, `runtimeLimits`, `columnTypes`, `styleRules`, `dataIntegrity`, `capabilities`, `detailRowHeight`, `pagination`, `rowSelection`, `showStatusBar`, `showFilterChipBar`, `showFloatingFilters`, `rowDragMode`, `onGridReady`; all `GridViewProps`: `pinLeftColumns`, `pinRightColumns`, `pinTopRows`, `pinBottomRows`, `enableColumnReorder`, `enableNavigation`, `enableContextMenu`, `contextMenuOptions`, `onCellClick`, `navigationOptions`, `groupRowRenderer`, `detailRowRenderer`, `footerRowRenderer`, `sidebar`, `enableChart`
- [ ] **Status bar** (`StatusBarRenderer`) — total row count + selected row count; re-render on `rowsUpdated`, `filterChanged`, `groupByChanged`, `selectionChanged`, `paginationChanged`
- [ ] **Pagination bar** (`PaginationBarRenderer`) — page summary; First/Prev/Next/Last; client `PageWindowCapableRowModel` + server-controlled `ServerPageControllableRowModel`; `paginationChanged` event
- [ ] **Chart overlay** (`GridChartOverlay`) — floating portal overlay; reads cell selection bounds; SVG charts (no library); 5 chart types (`bar | line | area | pie | scatter`); 6 palette themes; stacking/smoothing/transposition; stats bar (sum/avg/min/max); draggable + resizable

---

_Total: ~150 discrete implementation tasks across 20 feature areas + supplementary._
_Completion gate: all demo pages listed in §18 render correctly with their documented features._

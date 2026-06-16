# Plan 076: Named Column Views / Profiles

> **Summary**: Add named column views (profiles) — saved snapshots of column order, visibility, widths, sort, and filter state that users can name, switch between with hotkeys, and persist across sessions. A dedicated theme-aware sidebar panel complements the existing Columns/Sort/Filter panels, and `saveView` / `loadView` / `deleteView` / `getViews` / `switchView` are exposed on `GridApi`.

## Status

- **Priority**: P1 — feature, high user value
- **Effort**: L
- **Risk**: MEDIUM — extends PersistedGridState schema, adds GridApi surface, new sidebar panel
- **Depends on**: Plans 065–074
- **Category**: feature, persistence, sidebar, hotkeys
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

Users who manage grids with many columns (20+) frequently switch between different "views" of the same data: a compact view (only key fields visible), a wide analytical view (all numeric columns), a presentation view (sorted, filtered, pinned). Today there is no mechanism to save and recall these configurations — users must manually re-apply column visibility, order, sort, and filter every time.

The grid already has everything needed:

- `getColumnState()` / `applyColumnState()` for column snapshots
- `sortModel` / `filterModel` on `GridState`
- `GridPersistenceAdapter` for durable storage
- A sidebar panel system (`GridSidebar`) with theme-aware panels
- A keyboard navigation plugin that can be extended with hotkeys

## Goals

1. Expose `saveView`, `loadView`, `deleteView`, `renameView`, `getViews`, `switchView`, `getActiveView` on `GridApi`.
2. Persist views as part of `PersistedGridState` (schema v3, or v4 if plan 075 ships first).
3. Implement a **Views sidebar panel** (`ViewsPanel`) — theme-aware, consistent with `ColumnsPanel`/`SortPanel`/`FiltersPanel` in appearance.
4. Register `'views'` as a built-in sidebar panel ID in `GridSidebar`.
5. Hotkeys: `Ctrl+Shift+1`–`Ctrl+Shift+9` to switch to views 1–9 by index; `Ctrl+Shift+S` to save the current state as the active view.
6. Emit `GridEventName.viewSaved` / `viewLoaded` / `viewDeleted` events.

## Data model

### ColumnViewSnapshot

```ts
export interface ColumnViewSnapshot {
	/** User-assigned name. Displayed in the panel and used as the save-key. */
	name: string;
	/** ISO timestamp of last save (for "last saved" display). */
	savedAt: string;
	/** Full column state snapshot at save time. */
	columnState: ColumnState[];
	/** Sort model at save time, or null if no sort applied. */
	sortModel: SortModel | null;
	/** Filter model at save time, or null if no filters active. */
	filterModel: FilterModel | null;
}
```

### PersistedGridState extension

```ts
// Add to PersistedGridState
views?: ColumnViewSnapshot[];        // Ordered list of saved views
activeViewName?: string | null;      // Name of last-loaded view, or null
```

Schema version bumped to 3 (or 4 if plan 075 also bumps it — take whichever is current).

## GridApi surface

```ts
/**
 * Save current column/sort/filter state as a named view.
 * If a view with this name already exists it is overwritten.
 */
saveView(name: string): ColumnViewSnapshot;

/**
 * Apply a saved view by name. Returns true on success, false if not found.
 * Fires GridEventName.viewLoaded.
 */
loadView(name: string): boolean;

/**
 * Remove a saved view by name. Returns true if it existed.
 * Fires GridEventName.viewDeleted.
 */
deleteView(name: string): boolean;

/**
 * Rename a view. No-ops if the old name does not exist.
 * Returns true on success.
 */
renameView(oldName: string, newName: string): boolean;

/**
 * Returns all saved views in save-order.
 */
getViews(): ColumnViewSnapshot[];

/**
 * Switch to a view by zero-based index in the views list.
 * No-ops if out of range.
 */
switchView(index: number): boolean;

/**
 * Returns the name of the currently active (last loaded) view, or null.
 */
getActiveView(): string | null;
```

### New GridEventName entries

```ts
viewSaved = 'viewSaved',
viewLoaded = 'viewLoaded',
viewDeleted = 'viewDeleted',
```

## GridStore wiring

- Add `private views: ColumnViewSnapshot[] = []` and `private activeViewName: string | null = null` to store.
- `saveView(name)`:
    1. Call `getColumnState()`, current `sortModel`, current `filterModel`.
    2. Upsert into `this.views` by name.
    3. Set `this.activeViewName = name`.
    4. Dispatch `viewSaved` event.
    5. Trigger persistence save (call existing debounced save path).
- `loadView(name)`:
    1. Find view by name; return false if not found.
    2. Call `applyColumnState(view.columnState, { applyOrder: true })`.
    3. Call `setSortModel(view.sortModel)`.
    4. Call `setFilterModel(view.filterModel)`.
    5. Set `this.activeViewName = name`.
    6. Dispatch `viewLoaded` event.
- `deleteView(name)`: splice from array, clear `activeViewName` if it matches, dispatch `viewDeleted`.
- `renameView(oldName, newName)`: mutate the snapshot in-place, update `activeViewName` if affected.
- `getViews()`: return `[...this.views]` (defensive copy).
- `switchView(index)`: bounds-check, call `loadView(this.views[index].name)`.
- `getActiveView()`: return `this.activeViewName`.

## Persistence wiring

In `statePersistence.ts`:

- `extractPersistedState` adds `views: store.getViews()` and `activeViewName: store.getActiveView()`.
- `applyPersistedState` restores `views` array into the store and calls `loadView(activeViewName)` if set.
- Persistence trigger keys: add `'views'` to `PERSISTENCE_KEYS`.

## Sidebar panel — ViewsPanel

File: `packages/react/src/sidebar/panels/ViewsPanel.tsx`

### Layout (top to bottom)

```
┌─────────────────────────────────────────┐
│  VIEWS                          [+ Save] │  ← header with inline save button
├─────────────────────────────────────────┤
│  Save as: [_______________________] [✓] │  ← expandable save-as form (collapsed by default)
├─────────────────────────────────────────┤
│  ● My Compact View          2024-06-16  │  ← active view (bullet + bold)
│  ○ Full Analytics           2024-06-15  │  ← inactive views
│  ○ Presentation             2024-06-14  │
│    [✏ Rename] [⤴ Load] [🗑 Delete]    │  ← inline actions on hover/focus
├─────────────────────────────────────────┤
│  No views saved yet.                    │  ← empty state
└─────────────────────────────────────────┘
```

### Theme-awareness

Pull `api.getTheme()` for:

- Panel background: `theme.colors.panelBg` (same as other panels)
- Active row highlight: `theme.colors.primaryAccent` at 15% opacity
- Border: `theme.colors.border`
- Text: `theme.colors.cellText` (primary), `theme.colors.headerText` (secondary/dates)
- Buttons: `theme.colors.buttonBg` / `theme.colors.buttonText`

### Interactions

- **[+ Save] header button**: expands inline name input; on submit calls `api.saveView(name)` and collapses form.
- **Load row click**: calls `api.loadView(name)`.
- **✏ Rename**: inline rename input; on blur/enter calls `api.renameView`.
- **🗑 Delete**: confirmation tooltip (click once to show "Confirm?", second click to delete).
- Active view row shows a filled circle and is visually distinguished.
- `viewSaved` / `viewLoaded` / `viewDeleted` events trigger re-render via `useState`.

### Registration in GridSidebar

```ts
// GridSidebar.tsx
export type BuiltinSidebarPanelId = 'columns' | 'filters' | 'sort' | 'themes' | 'views';

// _BUILTIN_ICONS: add Views icon (stacked-layers SVG)
// _BUILTIN_LABELS: 'views' -> 'Views'
// _resolvePanel: 'views' -> renders <ViewsPanel api={api} onClose={onClose} />
```

## Hotkeys

Extend `GridNavigationController.handleKeyDown` (or add a new lightweight plugin):

| Shortcut                        | Action                                           |
| ------------------------------- | ------------------------------------------------ |
| `Ctrl+Shift+1` … `Ctrl+Shift+9` | `api.switchView(n-1)` (1-indexed → 0-indexed)    |
| `Ctrl+Shift+S`                  | `api.saveView(api.getActiveView() ?? 'Default')` |
| `Ctrl+Shift+V`                  | `api.togglePanel('views')`                       |

Implemented as a separate `GridViewsPlugin` that implements `GridPlugin` and reads hotkeys from `handleKeyDown`. Passed alongside `GridNavigationController` in the React wrapper.

```ts
export class GridViewsPlugin<TRowData> implements GridPlugin<TRowData> {
	readonly name = 'views';
	onInit(api: GridPluginRuntime<TRowData>): void;
	handleKeyDown(event: KeyboardEvent): void;
}
```

## Phases

### Phase 1 — Core data model and GridApi

1. Define `ColumnViewSnapshot` in `packages/core/src/api/GridApi.ts` (or a dedicated `views.ts` under `api/`).
2. Add `GridEventName.viewSaved / viewLoaded / viewDeleted`.
3. Add `views` and `activeViewName` fields to `GridStore`.
4. Implement all seven GridApi methods in store + facade.
5. Update `createGridPluginRuntime.ts`.
6. Export from `index.ts`.
7. Unit tests: save/load/delete/rename round-trips; schema version bump.

### Phase 2 — Persistence wiring

1. Extend `PersistedGridState` with `views` and `activeViewName`.
2. Update `extractPersistedState` and `applyPersistedState`.
3. Add `'views'` to `PERSISTENCE_KEYS`.
4. Bump `GRID_STATE_SCHEMA_VERSION`.
5. Tests: views survive a serialize → deserialize → apply cycle.

### Phase 3 — ViewsPanel React component

1. Implement `ViewsPanel.tsx` with all interactions.
2. Register `'views'` as built-in in `GridSidebar.tsx`.
3. Add Views icon SVG to `_BUILTIN_ICONS`.
4. Verify theme token usage matches existing panels (ColumnsPanel as reference).
5. Add to demo: enable `'views'` panel in the AdvancedFeatures demo grid.

### Phase 4 — GridViewsPlugin and hotkeys

1. Implement `GridViewsPlugin` with `handleKeyDown`.
2. Register in the React `<Grid>` component alongside NavigationController (opt-in via `enableViews` prop).
3. Document hotkeys in a JSDoc comment on `GridViewsPlugin`.
4. Demo: show hotkey badge in the Views panel footer.

### Phase 5 — Architecture guard

1. Add guard: `views domain files must not import renderer files`.
2. Add guard: `ColumnViewSnapshot is exported from index.ts`.

## Out of scope

- Sharing views across users (server-side storage)
- View-level row visibility / custom row filters (views only capture column + sort + filter state)
- Animated transitions when switching views
- View import/export as JSON file download

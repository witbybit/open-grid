# Plan 123 — Workspace Views and Persistence Controls

**Status:** TODO  
**Depends on:** Plan 116 (persistence hardening), Plan 055 (schema versioning)  
**Supersedes scope of:** Plan 076 (Named Column Views / Profiles)

---

## Mission

Promote persistence into a first-class workspace / saved-view system. The persistence foundation is already live — this plan layers named views on top of it and moves persistence controls out of the Columns panel into a dedicated Views panel.

Do not replace or rewrite existing persistence. Build named views on top of `GridPersistenceAdapter` and `PersistedGridState`.

---

## What already exists

| Symbol                               | File                                                    | Notes                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GridPersistenceAdapter` interface   | `packages/core/src/persistence/statePersistence.ts:216` | load/save/clear                                                                                                          |
| `PersistedGridState` interface       | same:31                                                 | schema-versioned persisted state                                                                                         |
| `SerializedGridState` interface      | same:17                                                 | raw serialized form                                                                                                      |
| `createLocalStorageAdapter()`        | same:256                                                | built-in localStorage adapter                                                                                            |
| `PersistenceStatus` interface        | same:232                                                | enabled, dirty, lastSavedAt, lastError, loading                                                                          |
| `PersistenceController` interface    | same:242                                                | internal controller interface                                                                                            |
| `GRID_STATE_SCHEMA_VERSION = 2`      | same                                                    | current schema version                                                                                                   |
| `extractPersistedState()`            | same                                                    | state → persisted                                                                                                        |
| `applyPersistedState()`              | same                                                    | persisted → state                                                                                                        |
| `api.hasPersistence()`               | `GridApi.ts:582`                                        | already public                                                                                                           |
| `api.clearPersistedState()`          | `GridApi.ts:585`                                        | already public                                                                                                           |
| `api.setAutoSave()`                  | `GridApi.ts:587`                                        | already public                                                                                                           |
| `api.isAutoSaveEnabled()`            | `GridApi.ts:589`                                        | already public                                                                                                           |
| `api.getPersistenceStatus()`         | `GridApi.ts:591`                                        | already public                                                                                                           |
| `api.subscribeToPersistenceStatus()` | `GridApi.ts:593`                                        | already public                                                                                                           |
| `api.saveNow()`                      | `GridApi.ts:595`                                        | already public                                                                                                           |
| Persisted keys                       | same:431                                                | columns, columnWidths, sortModel, filterModel, themeName, groupBy, showGroupFooter, enableStickyGroupRows, pinnedColumns |
| `ColumnsPanel`                       | `packages/react/src/sidebar/panels/ColumnsPanel.tsx`    | currently owns persistence controls                                                                                      |

---

## Conceptual split

| Concern             | Answer                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- |
| **Persistence**     | Can the grid restore a serialized state? Already exists.                            |
| **Workspace views** | Can users save, switch, update, duplicate, and reset named grid layouts? This plan. |

After this plan:

- **Columns panel** — column visibility, ordering, pinning, sizing only
- **Views panel** — named views CRUD + all persistence controls (moved from Columns panel)

---

## Core types

### GridViewDefinition

```ts
export interface GridViewDefinition {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly scope: 'personal' | 'team' | 'system';
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly version: number;
	readonly state: PersistedGridState; // reuses existing type
	readonly metadata?: Record<string, unknown>;
}
```

### GridWorkspaceState

```ts
export interface GridWorkspaceState {
	readonly views: readonly GridViewDefinition[];
	readonly activeViewId: string | null;
	readonly defaultViewId: string | null;
	readonly autoSaveEnabled: boolean; // mirrors existing api.isAutoSaveEnabled()
	readonly dirty: boolean; // mirrors existing PersistenceStatus.dirty
	readonly lastSavedAt: number | null;
	readonly lastError: string | null;
	readonly loading: boolean;
}
```

### SaveViewOptions

```ts
export interface SaveViewOptions {
	readonly description?: string;
	readonly scope?: 'personal' | 'team' | 'system';
	readonly makeDefault?: boolean;
}
```

---

## Workspace adapter

```ts
export interface GridWorkspaceAdapter {
	listViews(): Promise<readonly GridViewDefinition[]>;
	getView(id: string): Promise<GridViewDefinition | null>;
	saveView(view: GridViewDefinition): Promise<void>;
	deleteView(id: string): Promise<void>;
	getDefaultView?(): Promise<string | null>;
	setDefaultView?(id: string | null): Promise<void>;
}
```

### Local storage adapter

```ts
// New — distinct from existing createLocalStorageAdapter() which persists anonymous state
createLocalStorageWorkspaceAdapter(options: {
  storageKey: string;
}): GridWorkspaceAdapter
```

The existing `createLocalStorageAdapter()` (anonymous state persistence) is unchanged.

---

## View state contents

A view's `state: PersistedGridState` uses the existing persisted keys:

- column order, widths, visibility, pinning
- sort model
- filter model
- query model (Plan 124, once available — add to persisted keys then)
- groupBy, showGroupFooter, enableStickyGroupRows
- themeName

A view must not include row data.

---

## New API additions

These sit on top of the existing persistence API, not replacing it:

```ts
api.getWorkspaceState(): GridWorkspaceState;
api.listViews(): Promise<readonly GridViewDefinition[]>;

api.saveView(name: string, options?: SaveViewOptions): Promise<GridViewDefinition>;
api.updateView(id: string, state?: PersistedGridState): Promise<void>;
api.applyView(id: string): Promise<void>;
api.deleteView(id: string): Promise<void>;
api.duplicateView(id: string, name: string): Promise<GridViewDefinition>;
api.renameView(id: string, name: string): Promise<void>;
api.setDefaultView(id: string | null): Promise<void>;
```

Existing API methods (`saveNow`, `setAutoSave`, `clearPersistedState`, etc.) are unchanged.

---

## Auto-save semantics

```
If activeViewId is set and the view is writable:
  auto-save updates the active view state.

If no active writable view:
  auto-save updates the anonymous persisted state (existing behavior).

If the active view is system/read-only:
  auto-save writes anonymous state or is disabled with a visible reason.
```

The Views panel must show which target auto-save is currently writing to.

---

## Views sidebar panel

Add `'views'` to `BuiltinSidebarPanelId` in `GridSidebar.tsx`:

```ts
export type BuiltinSidebarPanelId = 'columns' | 'filters' | 'sort' | 'themes' | 'views' | 'devtools';
```

New file: `packages/react/src/sidebar/panels/ViewsPanel.tsx`

### Panel sections

**Current view**

- active view name (or "Unsaved")
- dirty indicator
- Update current view / Save as new view / Reset to saved

**Persistence controls** (moved from ColumnsPanel)

- auto-save toggle (`api.setAutoSave`)
- save now (`api.saveNow`)
- reset persisted state (`api.clearPersistedState` + reapply defaults)
- last saved time
- last error
- persistence enabled status

**Saved views list** — each row:

- name, scope badge, updated time
- apply | rename | duplicate | delete | set as default

**Default view** — current default, set/clear actions

---

## Columns panel cleanup

Remove from `ColumnsPanel.tsx`:

- save layout
- auto-save toggle
- reset persisted layout
- clear persisted state
- persistence status display

Columns panel retains: visibility, ordering, pinning, sizing, column grouping controls.

---

## Events

```
viewSaved
viewApplied
viewDeleted
viewRenamed
workspaceStateChanged
```

Higher-level workspace events; do not replace existing persistence events.

---

## Files in scope

| File                                                          | Change                                   |
| ------------------------------------------------------------- | ---------------------------------------- |
| `packages/core/src/workspace/GridWorkspaceController.ts`      | New — workspace state + view CRUD        |
| `packages/core/src/workspace/localStorageWorkspaceAdapter.ts` | New — named-view localStorage adapter    |
| `packages/core/src/api/GridApi.ts`                            | Add workspace/view API methods           |
| `packages/core/src/api/GridEvents.ts`                         | Add workspace events                     |
| `packages/react/src/sidebar/GridSidebar.tsx`                  | Add `'views'` to `BuiltinSidebarPanelId` |
| `packages/react/src/sidebar/panels/ViewsPanel.tsx`            | New — views panel UI                     |
| `packages/react/src/sidebar/panels/ColumnsPanel.tsx`          | Remove persistence controls              |
| `packages/react/src/index.ts`                                 | Export workspace types                   |

---

## Tests

1. `createLocalStorageWorkspaceAdapter` — list / get / save / delete views
2. `api.saveView()` captures current state as a named view
3. `api.applyView()` restores column order, widths, sort, filter, group, theme
4. `api.updateView()` updates the state of an existing view
5. `api.duplicateView()` creates a new view with a copy of the state
6. `api.renameView()` updates name without changing state
7. `api.deleteView()` removes view and clears activeViewId if it was active
8. `api.setDefaultView()` sets and clears the default
9. Auto-save updates active view when one is set and writable
10. Auto-save updates anonymous state when no active writable view
11. Persistence controls no longer render in the Columns panel
12. Views panel renders persistence controls
13. View state does not include row data
14. View apply calls existing `applyPersistedState()` internally
15. System/read-only view blocks auto-save with a visible reason

---

## Completion gate

Plan 123 is complete when:

- `GridWorkspaceAdapter` interface and `createLocalStorageWorkspaceAdapter` exist
- Named views can be saved, applied, updated, deleted, duplicated, renamed
- Views sidebar panel exists with persistence controls and view list
- Columns panel no longer owns persistence controls
- Auto-save target semantics are clear and tested
- All 15 tests pass

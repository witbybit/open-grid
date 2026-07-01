# Plan 125 — Validation and Cell Capability Framework

**Status:** TODO  
**Depends on:** Plan 113 (commit kernel), Plan 114 (domain mutation executors)

---

## Mission

Unify scattered interaction permissions into a first-class capability layer. The grid already has per-cell `editable` as a boolean or callback — this plan generalises that pattern to cover all grid actions (paste, fill, copy, sort, filter, pin, resize, group, drag, select, delete, expand, export).

Existing column props (`editable`, `filterable`, `pinnable`, `movable`, `rowDrag`) must compile into capabilities automatically — no breaking changes.

---

## What already exists

| Symbol                     | File                                     | Notes                                                        |
| -------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `ColumnDef.editable`       | `packages/core/src/api/columnDef.ts:247` | `boolean \| ((params: EditableParams<TRowData>) => boolean)` |
| `EditableParams` interface | same:23                                  | `{ row, rowId, colField }`                                   |
| No other `canX` callbacks  | —                                        | No canPaste, canCopy, canSort, etc.                          |
| No `GridCapabilityManager` | —                                        | Does not exist                                               |
| No `api.can()`             | —                                        | Does not exist                                               |

---

## Required capabilities

```ts
canEdit | canSelect | canCopy | canPaste | canGroup | canFill;
canSort | canFilter | canPin | canResize | canDelete | canExpand;
canDrag | canExport;
```

---

## Existing column prop mapping

These existing props must automatically produce capability results — no user migration required:

| Existing prop                        | Capability action                 |
| ------------------------------------ | --------------------------------- |
| `column.editable` (boolean/callback) | `canEdit` / action `'edit'`       |
| `column.filterable`                  | `canFilter` / action `'filter'`   |
| `column.pinnable`                    | `canPin` / action `'pin'`         |
| `column.movable`                     | action `'moveColumn'` / `canDrag` |
| `column.rowDrag`                     | action `'rowDrag'` / `canDrag`    |

The capability manager reads these existing column props as the first layer of capability resolution before checking `canX` callbacks.

---

## Capability actions

```ts
export type GridCapabilityAction =
	| 'edit'
	| 'select'
	| 'copy'
	| 'paste'
	| 'group'
	| 'fill'
	| 'sort'
	| 'filter'
	| 'pin'
	| 'resize'
	| 'delete'
	| 'expand'
	| 'drag'
	| 'moveColumn'
	| 'rowDrag'
	| 'export';
```

---

## Capability types

```ts
export interface GridCapabilityParams<TRowData = unknown> {
	readonly action: GridCapabilityAction;
	readonly rowId?: string;
	readonly colField?: string;
	readonly row?: TRowData;
	readonly column?: ColumnDef<TRowData>;
	readonly value?: unknown;
	readonly source?: 'api' | 'keyboard' | 'mouse' | 'paste' | 'fill' | 'menu' | 'panel' | 'export';
}

export interface GridCapabilityResult {
	readonly allowed: boolean;
	readonly reason?: string;
	readonly mode?: 'enabled' | 'disabled' | 'hidden' | 'readonly';
}

export type GridCapabilityCallback<TRowData> = (params: GridCapabilityParams<TRowData>) => boolean | GridCapabilityResult;
```

Helper:

```ts
function normalizeCapabilityResult(result: boolean | GridCapabilityResult): GridCapabilityResult;
```

---

## ColumnDef additions

Add optional `canX` callbacks alongside existing props:

```ts
interface ColumnDef<TRowData> {
	// existing — unchanged
	editable?: boolean | ((params: EditableParams<TRowData>) => boolean);
	filterable?: boolean;
	pinnable?: boolean;
	movable?: boolean;
	rowDrag?: boolean;

	// new canX callbacks
	canEdit?: GridCapabilityCallback<TRowData>;
	canSelect?: GridCapabilityCallback<TRowData>;
	canCopy?: GridCapabilityCallback<TRowData>;
	canPaste?: GridCapabilityCallback<TRowData>;
	canGroup?: GridCapabilityCallback<TRowData>;
	canFill?: GridCapabilityCallback<TRowData>;
	canSort?: GridCapabilityCallback<TRowData>;
	canFilter?: GridCapabilityCallback<TRowData>;
	canPin?: GridCapabilityCallback<TRowData>;
	canResize?: GridCapabilityCallback<TRowData>;
	canDelete?: GridCapabilityCallback<TRowData>;
	canExpand?: GridCapabilityCallback<TRowData>;
	canDrag?: GridCapabilityCallback<TRowData>;
	canExport?: GridCapabilityCallback<TRowData>;
}
```

Examples:

```ts
// Lock editing for locked rows
canEdit: (params) => params.row.status !== 'Locked';

// Admin-only salary copy
canCopy: (params) => params.column.field !== 'salary' || currentUser.role === 'Admin';

// Enterprise-only pinning
canPin: () => currentUser.plan === 'enterprise';
```

---

## Grid-level capabilities

```ts
interface GridOptions<TRowData> {
	capabilities?: {
		canEdit?: GridCapabilityCallback<TRowData>;
		canSelect?: GridCapabilityCallback<TRowData>;
		canCopy?: GridCapabilityCallback<TRowData>;
		canPaste?: GridCapabilityCallback<TRowData>;
		canGroup?: GridCapabilityCallback<TRowData>;
		canFill?: GridCapabilityCallback<TRowData>;
		canSort?: GridCapabilityCallback<TRowData>;
		canFilter?: GridCapabilityCallback<TRowData>;
		canPin?: GridCapabilityCallback<TRowData>;
		canResize?: GridCapabilityCallback<TRowData>;
		canDelete?: GridCapabilityCallback<TRowData>;
		canExpand?: GridCapabilityCallback<TRowData>;
		canDrag?: GridCapabilityCallback<TRowData>;
		canExport?: GridCapabilityCallback<TRowData>;
	};
	canPerformAction?: GridCapabilityCallback<TRowData>; // generic fallback
}
```

---

## Resolution order

```
1. hard system restrictions    — loading rows cannot be edited even if canEdit returns true
2. existing column props       — editable=false, filterable=false, pinnable=false, etc.
3. column canX callback        — fine-grained per-cell/per-column
4. grid-level canX callback    — grid-wide policy
5. generic canPerformAction    — catch-all fallback
6. default                     — current behavior
```

Rules:

- Hard system restrictions can only deny; user callbacks cannot override them
- Each layer can only deny what the layers above it allowed
- Defaults preserve all existing behavior — no unintentional regressions

---

## Capability manager

New file: `packages/core/src/capabilities/GridCapabilityManager.ts`

```ts
export class GridCapabilityManager<TRowData> {
	can(action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>): GridCapabilityResult;
}
```

### API surface

```ts
api.can(action: GridCapabilityAction, params?: Partial<GridCapabilityParams>): GridCapabilityResult;

// Minimal convenience helpers
api.canEdit(rowId: string, colField: string): GridCapabilityResult;
api.canCopy(rowId?: string, colField?: string): GridCapabilityResult;
api.canPaste(rowId?: string, colField?: string): GridCapabilityResult;
api.canExport(colField?: string): GridCapabilityResult;
```

`api.can()` is the canonical method. Helpers cover the most common call sites.

---

## Integration requirements

### Editing

- Before starting edit: check `canEdit`
- Before committing value: check `canEdit` + then run validation
- `editable` column prop compiles to capability check (no code duplication)

### Paste

- Before applying each target cell: `canPaste` → validation

### Fill

- Before applying each target cell: `canFill` → validation

### Copy

- Before copying: `canCopy`
- Restricted cells are omitted from clipboard; behaviour is explicit in docs

### Export

- Before export: `canExport`
- Restricted columns/rows are omitted

### Sort / filter / pin / resize / group

- Header menu, context menu, sidebar panel, and API methods check:
  `canSort` / `canFilter` / `canPin` / `canResize` / `canGroup`
- Existing `filterable`, `pinnable`, `movable` props feed into the same checks

### Row drag

- `canDrag` + action `'rowDrag'`; existing `rowDrag` column prop feeds in

### Select / delete / expand

- `canSelect` / `canDelete` / `canExpand`

---

## Validation ordering

Capability and validation are separate layers with a defined order:

```
capability check → parser → validation → commit
```

Examples:

```
paste into capability-denied cell
  → canPaste denies
  → validation does not run

paste invalid value into allowed cell
  → canPaste allows
  → validation rejects
```

---

## UI behaviour

Capability result drives UI state:

- `mode: 'disabled'` → disabled menu item, blocked keyboard shortcut
- `mode: 'hidden'` → hidden menu item
- `mode: 'readonly'` → readonly cell styling
- `reason` → tooltip on denied action
- Disabled panel controls for pinning, sorting, filtering when `allowed: false`

CSS classes (optional, for host application styling):

```
og-cell-readonly
og-cell-action-denied
```

---

## Capability diagnostics (for Plan 122 DevTools)

```ts
export interface CapabilityDiagnostics {
	readonly deniedActions: number;
	readonly lastDeniedAction?: {
		action: GridCapabilityAction;
		rowId?: string;
		colField?: string;
		reason?: string;
	};
}
```

`GridDiagnosticsSnapshot` (Plan 122) gains an optional `capabilities?: CapabilityDiagnostics` field.

---

## Files in scope

| File                                                       | Change                                               |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `packages/core/src/capabilities/capabilityTypes.ts`        | New — all capability types                           |
| `packages/core/src/capabilities/GridCapabilityManager.ts`  | New — capability manager                             |
| `packages/core/src/api/GridApi.ts`                         | Add `api.can()` and helper methods                   |
| `packages/core/src/api/columnDef.ts`                       | Add `canX` callbacks (existing `editable` unchanged) |
| `packages/core/src/features/EditingFeatureController.ts`   | Check `canEdit` before edit start/commit             |
| `packages/core/src/features/ClipboardController.ts`        | Check `canCopy` / `canPaste`                         |
| `packages/core/src/features/FillController.ts`             | Check `canFill`                                      |
| `packages/core/src/features/GridStateFeatureController.ts` | Check `canSort` / `canFilter` / `canGroup`           |
| `packages/react/src/Grid.tsx`                              | Wire `capabilities` prop to manager                  |
| `packages/react/src/sidebar/panels/ColumnsPanel.tsx`       | Respect `canPin` / `canResize` / `canGroup`          |

---

## Tests

1. `editable=false` on column → `canEdit` denied
2. `editable` callback on column → `canEdit` result matches callback return
3. `filterable=false` → `canFilter` denied
4. `pinnable=false` → `canPin` denied
5. `movable=false` → `moveColumn` denied
6. `rowDrag=false` → `rowDrag` denied
7. Column `canEdit` callback blocks mouse edit
8. Column `canEdit` callback blocks keyboard edit
9. `canPaste` blocks paste into denied row
10. `canFill` blocks fill into denied cell
11. `canCopy` omits denied cells from clipboard
12. Grid-level `canPin` disables pin in header menu and Columns panel
13. Grid-level `canSort` blocks header click sort and `api.setSortModel()`
14. `canExport` omits denied columns from export
15. Capability denial happens before validation (denied cell skips validation entirely)
16. Validation runs when capability allows, and can still reject
17. `GridCapabilityResult.reason` is exposed to UI as tooltip
18. `api.can()` cannot be bypassed by internal code paths

---

## Completion gate

Plan 125 is complete when:

- All `canX` callbacks exist on `ColumnDef` and `GridOptions.capabilities`
- Existing `editable`, `filterable`, `pinnable`, `movable`, `rowDrag` props compile into capability checks with no breaking changes
- `GridCapabilityManager` is wired through the engine
- `api.can()` is the canonical capability check
- Editing, paste, fill, copy, export, sort, filter, pin, group, drag, select, delete, expand all use capability checks
- Capability check runs before validation
- Denial reasons are exposed to UI
- Plan 122 DevTools shows `CapabilityDiagnostics`
- All 18 tests pass

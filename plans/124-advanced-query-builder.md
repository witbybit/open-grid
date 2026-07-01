# Plan 124 — Advanced Query Builder

**Status:** TODO  
**Depends on:** Plan 059 (advanced filter types), Plan 055 (schema versioning), Plan 123 (workspace views — for query persistence)

---

## Mission

Build a cross-column nested AND/OR query layer on top of the existing column filter system. The existing `FilterModel` applies conditions per-column; this plan adds a `GridQueryModel` that can combine conditions across columns in arbitrary nested groups.

Do not replace the existing column filter system. The query model is a parallel, additive layer.

---

## What already exists

| Symbol                                                      | File                                                 | Notes                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `FilterCondition` union                                     | `packages/core/src/filterModel.ts:63`                | TextFilterCondition \| NumberFilterCondition \| DateFilterCondition \| SetFilterCondition \| SelectFilterCondition |
| `CompoundFilterCondition`                                   | same:65                                              | Per-column AND/OR between exactly two leaf conditions                                                              |
| `ColumnFilter = FilterCondition \| CompoundFilterCondition` | same:72                                              | Per-column filter type                                                                                             |
| `FilterModel = Record<string, ColumnFilter>`                | same:74                                              | Current filter state                                                                                               |
| `ColumnFilterDef<TRowData, TValue>`                         | `packages/core/src/filters/filterDef.ts:103`         | Rich filter definition per column                                                                                  |
| Filter types                                                | same:88                                              | `'text' \| 'number' \| 'date' \| 'multi-select' \| 'single-select' \| 'async-multi-select' \| ...`                 |
| `TEXT_OPS`, `NUMBER_OPS`, `DATE_OPS`                        | `packages/core/src/filterOperations.ts:36`           | Operator constant arrays                                                                                           |
| `getOpsForType()`, `getOpMeta()`                            | same                                                 | Operator metadata helpers                                                                                          |
| `isFilterableColumn()`                                      | same                                                 | Column filter check                                                                                                |
| `api.setFilterModel()`                                      | `packages/core/src/api/GridApi.ts:463`               | Already public                                                                                                     |
| `FiltersPanel`                                              | `packages/react/src/sidebar/panels/FiltersPanel.tsx` | Full filter UI with compound AND/OR per column                                                                     |

---

## Core query model types

The query model is a cross-column nested AND/OR tree — different from the per-column `CompoundFilterCondition`:

```ts
export type GridQueryNode = GridQueryGroup | GridQueryCondition;

export interface GridQueryGroup {
	readonly kind: 'group';
	readonly id: string;
	readonly operator: 'and' | 'or';
	readonly children: readonly GridQueryNode[];
}

export interface GridQueryCondition {
	readonly kind: 'condition';
	readonly id: string;
	readonly columnId: string;
	readonly operator: string; // matches existing operator string from filterOperations.ts
	readonly value?: unknown;
	readonly valueTo?: unknown; // for range operators (inRange / between)
}

export interface GridQueryModel {
	readonly version: number;
	readonly root: GridQueryGroup;
}
```

Add to grid state:

```ts
queryModel: GridQueryModel | null;
```

---

## Operator registry

Rather than duplicating `TEXT_OPS` / `NUMBER_OPS` / `DATE_OPS`, the query operator registry wraps the existing operator metadata from `filterOperations.ts`:

```ts
export interface QueryOperatorDefinition {
	readonly id: string;
	readonly label: string;
	readonly columnTypes: readonly string[];
	readonly valueArity: 0 | 1 | 2 | 'many';

	evaluate(params: QueryEvaluateParams): boolean;

	// Optional bridges back to existing filter system
	toFilterCondition?: (condition: GridQueryCondition) => ColumnFilter;
}
```

Initial operators mirror the existing sets in `filterOperations.ts`:

**Text:** equals, notEquals, contains, notContains, startsWith, endsWith, blank, notBlank  
**Number:** equals, notEquals, gt, gte, lt, lte, inRange, blank, notBlank  
**Date:** equals, before, after, inRange, blank, notBlank  
**Set/select:** in, notIn, blank, notBlank

---

## Client evaluator

```ts
// packages/core/src/query/evaluateQueryModel.ts
export function evaluateQueryModel<TRowData>(queryModel: GridQueryModel, row: TRowData, context: QueryEvaluationContext<TRowData>): boolean;
```

Rules:

- `and` group: all valid children must pass
- `or` group: at least one valid child must pass
- Invalid conditions (missing column, unknown operator) produce diagnostics and do not silently apply
- Typed value parsing reuses column parsing from `ColumnFilterDef` where possible

### Client row pipeline integration

```
source rows
→ existing filterModel          (per-column conditions, unchanged)
→ queryModel                    (new cross-column nested layer)
→ sort / group / aggregate
```

Semantics: `filterModel AND queryModel`. Both must pass.

---

## Remote row model integration

Add `queryModel` to params for both remote row model types:

**Infinite (`InfiniteDatasource`):**

```ts
getRows({
	startRow,
	endRow,
	sortModel,
	filterModel,
	queryModel, // new
	signal,
	requestId,
});
```

**Server (`ServerDatasource`):**

```ts
getPage({
	page,
	pageSize,
	sortModel,
	filterModel,
	queryModel, // new
	signal,
	requestId,
});
```

Core passes the structured `GridQueryModel`. SQL/Mongo/Prisma translation is the application's responsibility.

---

## New API additions

```ts
api.getQueryModel(): GridQueryModel | null;
api.setQueryModel(model: GridQueryModel | null): void;
api.clearQueryModel(): void;
api.evaluateQueryForRow(rowId: string): boolean;
```

**Event:** `queryModelChanged`

**Persistence:** `queryModel` added to `PersistedGridState` persisted keys (alongside existing keys at `statePersistence.ts:431`). Included in workspace view state (Plan 123).

---

## Query sidebar panel

Add `'query'` to `BuiltinSidebarPanelId`:

```ts
export type BuiltinSidebarPanelId = 'columns' | 'filters' | 'sort' | 'themes' | 'views' | 'query' | 'devtools';
```

New file: `packages/react/src/sidebar/panels/QueryPanel.tsx`

### UI features

- add condition (column picker + operator picker + value editor)
- add group (AND / OR)
- toggle AND ↔ OR on any group
- nested groups (unlimited depth)
- typed value editor — reuses existing filter input controls from `FiltersPanel`
- remove / duplicate condition or group
- clear query
- apply query
- invalid condition indicator
- save/load query through workspace view (Plan 123)

---

## Filter chips integration

Update filter chips to show query summary chips alongside existing column filter chips. Examples:

```
(status = "Open" OR priority = "High")
amount > 5000
```

Clicking a query chip opens the Query panel.

---

## Query diagnostics (for Plan 122 DevTools)

```ts
export interface QueryDiagnostics {
	readonly active: boolean;
	readonly conditionCount: number;
	readonly groupCount: number;
	readonly invalidConditions: readonly string[];
}
```

`GridDiagnosticsSnapshot` gains an optional `query?: QueryDiagnostics` field.

---

## Files in scope

| File                                                 | Change                                               |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `packages/core/src/query/GridQueryModel.ts`          | New — query model types                              |
| `packages/core/src/query/queryOperatorRegistry.ts`   | New — operator registry wrapping filterOperations.ts |
| `packages/core/src/query/evaluateQueryModel.ts`      | New — client evaluator                               |
| `packages/core/src/rows/pipeline/queryModelStage.ts` | New — pipeline stage                                 |
| `packages/core/src/persistence/statePersistence.ts`  | Add `queryModel` to persisted keys                   |
| `packages/core/src/api/GridApi.ts`                   | Add query API methods                                |
| `packages/core/src/api/GridEvents.ts`                | Add `queryModelChanged` event                        |
| `packages/core/src/infiniteRowModel.ts`              | Add `queryModel` to `getRows` params                 |
| `packages/core/src/serverPageRowModel.ts`            | Add `queryModel` to `getPage` params                 |
| `packages/react/src/sidebar/GridSidebar.tsx`         | Add `'query'` to `BuiltinSidebarPanelId`             |
| `packages/react/src/sidebar/panels/QueryPanel.tsx`   | New — query builder panel UI                         |
| `packages/react/src/components/FilterChips.tsx`      | Update to show query chip summaries                  |

---

## Tests

1. `api.setQueryModel()` / `api.getQueryModel()` / `api.clearQueryModel()`
2. AND group evaluation: all conditions must pass
3. OR group evaluation: at least one condition must pass
4. Nested AND inside OR group evaluation
5. Text operator evaluation (contains, equals, blank)
6. Number operator evaluation (gt, lte, inRange)
7. Date operator evaluation (before, after, inRange)
8. Set operator evaluation (in, notIn)
9. Invalid condition (unknown column) produces diagnostic, does not crash
10. `filterModel AND queryModel` — both must pass for a row to be included
11. Client row pipeline applies queryModel after filterModel stage
12. Infinite datasource receives `queryModel` in `getRows` params
13. Server datasource receives `queryModel` in `getPage` params
14. `queryModel` persists in view state (Plan 123)
15. Query panel add / toggle AND-OR / remove / apply flow
16. Filter chips show query summary chip

---

## Completion gate

Plan 124 is complete when:

- `GridQueryModel` / `GridQueryGroup` / `GridQueryCondition` types exist
- Operator registry exists wrapping existing `filterOperations.ts` operators
- Client evaluator integrates with the row pipeline after the filterModel stage
- Remote datasources receive `queryModel` in their params
- `'query'` is a valid `BuiltinSidebarPanelId`
- Query panel exists
- `queryModel` persists through workspace views (Plan 123)
- Filter chips show query summaries
- Plan 122 DevTools displays `QueryDiagnostics`
- All 16 tests pass

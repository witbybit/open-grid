# Plan 131: Commit Kernel Write Path Unification

## Mission

Make `changeApplier.commit(...)` the single canonical gateway for every public data write. Remove all parallel write paths. Move refresh/notification/event lifecycle out of row-model controllers and into the commit kernel.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH — touches every public data-write path
- **Depends on**: Plan 113 (unified commit kernel — completed)
- **Category**: architecture, correctness, row-model, mutation

## Problem

The grid has two competing write architectures in parallel:

1. **Good path** — `GridEngine.changeApplier.commit(...)` → executor → publish
2. **Leaking path** — `GridStore.setRows/updateRows` → row model directly

`api.setCellValue` and `api.applyTransaction` both use the commit path.  
`api.setRows` and `api.updateRows` bypass it entirely, calling row-model methods directly.

This split means:

- Different data writes have different lifecycles (history, events, invalidation)
- `ClientRowModelController` currently owns classification, refresh, formula invalidation, event dispatch, and cell notification — far too much
- `applyTransaction` misses sort/filter reconciliation that `updateRows` handles (`needsRefresh` branch is incomplete)
- `setCellValue` routes through commit but the row model still makes its own refresh decision internally
- Infinite/server cell edits duplicate or omit client cell-edit logic with no capability enforcement

## Target end state

```text
api.setRows / api.updateRows / api.applyTransaction / api.setCellValue / api.batchCellValues
  → GridEngine method (thin)
  → changeApplier.commit({ reason, domainMutations: [...] })
  → executor: capability check → structural row-model write → collect RowModelWriteResult
  → shared classifyWriteImpact(changedFieldsByRow)
  → shared reconcileRowModelWrite(rowModel, writeResult, impact)
  → GridCommitKernel publishes domains / invalidations / events / history / render
```

No public data write is allowed to bypass `changeApplier.commit`.  
Row models are structural writers only — they do not own refresh or event lifecycle.

## Non-negotiable invariants

- `changeApplier.commit(...)` is the only owner of the data-write lifecycle
- Row model structural write methods return `RowModelWriteResult` and do nothing else
- Impact classification happens once, in one shared location, for all write kinds
- `applyTransaction` update path has identical sort/filter reconciliation to `updateRows`
- Unsupported mutations fail loudly via `UnsupportedRowModelOperationError`

## Mandatory demolition

- `GridStore.setRows` calling the row model directly
- `GridStore.updateRows` calling the row model directly
- `ClientRowModelController.setCellValue` owning `needsRefresh` / `this.refresh()` / cell notification
- `ClientRowModelController.updateRows` owning formula invalidation, events, `bumpGlobalVersion`, `notifyBulkCellChange`
- `ClientRowModelController.applyTransaction` owning its own partial impact classifier
- `InfiniteRowModelController.setCellValue` owning purge decisions without capability enforcement
- `ServerPageRowModelController.setCellValue` silently mutating without capability enforcement
- Silent `?.` optional chaining on row-model commands in `store.ts`

---

## Task list

### Phase 1 — New mutation kinds and executors

- [ ] **1.1** Add `ReplaceRowsMutation<TRowData>` to `GridDomainMutation.ts`
    ```ts
    export interface ReplaceRowsMutation<TRowData = unknown> {
    	kind: 'replace-rows';
    	rows: readonly TRowData[];
    	undoable?: boolean;
    }
    ```
- [ ] **1.2** Add `BatchRowUpdateMutation<TRowData>` to `GridDomainMutation.ts`
    ```ts
    export interface BatchRowUpdateMutation<TRowData = unknown> {
    	kind: 'batch-row-update';
    	updater: (rows: TRowData[]) => TRowData[];
    	undoable?: boolean;
    }
    ```
- [ ] **1.3** Add both types to the `GridDomainMutation<TRowData>` union
- [ ] **1.4** Add `replaceRows` and `updateRows` methods to `GridEngine.ts`, each wrapping `changeApplier.commit`
- [ ] **1.5** Route `GridStore.setRows` → `this.engine.replaceRows(rows)` and `GridStore.updateRows` → `this.engine.updateRows(updater)` — delete the direct row-model calls
- [ ] **1.6** Register a `replace-rows` executor in `createDefaultGridDomainMutationExecutorRegistry` (stub that calls row model; full refactor in Phase 3)
- [ ] **1.7** Register a `batch-row-update` executor (same — stub for now)
- [ ] **1.8** Run full test suite — all tests must pass before proceeding

### Phase 2 — `RowModelWriteResult` contract

- [ ] **2.1** Define `RowModelWriteResult<TRowData>` in `rowModel.ts`
    ```ts
    export interface RowModelWriteResult<TRowData = unknown> {
    	addedNodes?: RowNode<TRowData>[];
    	removedNodes?: RowNode<TRowData>[];
    	updatedNodes?: RowNode<TRowData>[];
    	changedFieldsByRow?: Map<string, Set<string>>;
    	changedValuesByRow?: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
    	visualChange: 'none' | 'partial' | 'full';
    }
    ```
- [ ] **2.2** Define `ClientStructuralRowModel<TRowData>` interface replacing `ClientMutableRowModel`
    - `replaceRowsStructurally(rows: readonly TRowData[]): RowModelWriteResult<TRowData>`
    - `updateRowsStructurally(updater: (rows: TRowData[]) => TRowData[]): RowModelWriteResult<TRowData>`
    - `applyTransactionStructurally(tx): RowModelWriteResult<TRowData> & RowNodeTransaction<TRowData>`
    - `writeCellValueStructurally(rowId, colField, value, opts?): RowModelWriteResult<TRowData>`
    - `reconcileAfterDataWrite(writeResult, impact): RowModelRefreshResult`
- [ ] **2.3** Add `RowModelRefreshResult` type: `{ changed: boolean; reason?: string }`
- [ ] **2.4** Add `RowWriteImpact` type in `rowModel.ts`:
    ```ts
    export type RowWriteImpact =
    	| 'none'
    	| 'plain-cell-value'
    	| 'sort-key'
    	| 'filter-key'
    	| 'group-key'
    	| 'tree-parent'
    	| 'aggregation-input'
    	| 'value-getter-dependency'
    	| 'structural';
    ```
- [ ] **2.5** Run typecheck — no new errors

### Phase 3 — Refactor `ClientRowModelController` to structural methods

- [ ] **3.1** Add `replaceRowsStructurally` to `ClientRowModelController` — mutate storage, return `RowModelWriteResult`, call nothing else
- [ ] **3.2** Add `updateRowsStructurally` to `ClientRowModelController`
    - Delegates to `dataStore.updateRows(updater)`
    - Returns `RowModelWriteResult` with `updatedNodes`, `changedFieldsByRow`, `changedValuesByRow`
    - Does **not** call `this.refresh()`, `this.runtime.bumpGlobalVersion()`, formula invalidation, or event dispatch
- [ ] **3.3** Add `applyTransactionStructurally` to `ClientRowModelController`
    - Delegates to `dataStore.applyTransaction(transaction)`
    - Returns merged `RowModelWriteResult & RowNodeTransaction`
    - Does **not** classify impact or call `this.refresh()`
- [ ] **3.4** Add `writeCellValueStructurally` to `ClientRowModelController`
    - Handles valueSetter / `setValueByPath`
    - Returns `RowModelWriteResult` for the single-cell write
    - Does **not** call `this.refresh()` or `this.runtime.notifyBulkCellChange`
- [ ] **3.5** Add `reconcileAfterDataWrite(writeResult, impact)` to `ClientRowModelController`
    - Contains all current optimization logic from `updateRows` / `applyTransaction`:
        - `sort-key` → `relocateSortedRows` or `refresh('sort')`
        - `filter-key` → `filterMembershipChanged` or `refresh('filter')`
        - `group-key` / `tree-parent` / `aggregation-input` → `refresh('bulk')`
        - `plain-cell-value` / `none` → `{ changed: false }`
    - Returns `RowModelRefreshResult`
- [ ] **3.6** Add `classifyWriteImpact(changedFieldsByRow)` as a standalone function (extracted from `ClientRowModelController.classifyFieldMutation`) usable by all executors
- [ ] **3.7** Run full test suite — all tests must pass

### Phase 4 — Upgrade executors to use structural methods

- [ ] **4.1** Upgrade `replace-rows` executor:
    - Calls `rowModel.replaceRowsStructurally(rows)`
    - Calls `classifyWriteImpact(result.changedFieldsByRow)`
    - Calls `rowModel.reconcileAfterDataWrite(result, impact)`
    - Returns correct `domains`, `invalidations`, `events`, `cellChanges`
- [ ] **4.2** Upgrade `batch-row-update` executor — same pattern as 4.1
- [ ] **4.3** Upgrade `row-transaction` executor:
    - Calls `rowModel.applyTransactionStructurally(transaction)` instead of `rowModel.applyTransaction(transaction)`
    - Uses `classifyWriteImpact` and `reconcileAfterDataWrite`
    - Fixes Fix 7: transaction updates now go through the same sort/filter reconciliation as `updateRows`
- [ ] **4.4** Upgrade `cell-value` executor path through `DataMutationController`:
    - `DataMutationController.applyCellValueChange` calls `rowModel.writeCellValueStructurally(...)` instead of `rowModel.setCellValue(...)`
    - Returns enriched `CellValueChangeResult` with `changedFieldsByRow`
    - Executor runs `classifyWriteImpact` and `reconcileAfterDataWrite` after formula work
    - Fixes Fix 6: cell mutation lifecycle is fully owned by the executor, not the row model
- [ ] **4.5** Upgrade `batch-cell` executor — same pattern as 4.4
- [ ] **4.6** Run full test suite — all tests must pass

### Phase 5 — Delete old high-level row-model write paths

- [ ] **5.1** Delete `ClientRowModelController.setRows` (the old public method) — replaced by `replaceRowsStructurally`
- [ ] **5.2** Delete `ClientRowModelController.updateRows` (old method that owned full lifecycle) — replaced by `updateRowsStructurally`
- [ ] **5.3** Delete `ClientRowModelController.applyTransaction` (old method) — replaced by `applyTransactionStructurally`
- [ ] **5.4** Delete `ClientRowModelController.setCellValue` (old method) — replaced by `writeCellValueStructurally`
- [ ] **5.5** Delete `ClientMutableRowModel` interface — replaced by `ClientStructuralRowModel`
- [ ] **5.6** Delete `CellValueWritableRowModel` interface — capability is now encoded in `RowModelCapabilities.cellMutation`
- [ ] **5.7** Delete `TransactionalRowModel` interface — replaced by `ClientStructuralRowModel`
- [ ] **5.8** Run typecheck + full test suite — zero regressions

### Phase 6 — Infinite/server cell mutation capability enforcement

- [ ] **6.1** Remove `CellValueWritableRowModel` implementation from `InfiniteRowModelController`
    - The `setCellValue` method is deleted (not renamed)
    - Any infinite cell edits now fail through capability check: `cellMutation: false`
- [ ] **6.2** Remove `CellValueWritableRowModel` implementation from `ServerPageRowModelController`
    - Same as 6.1
- [ ] **6.3** Update `INFINITE_CAPABILITIES` — set `loadedRowMutation: false` (no implicit cell edit support)
- [ ] **6.4** Update `SERVER_PAGE_CAPABILITIES` — set `pageRowMutation: false`
- [ ] **6.5** Update `cell-value` executor to check capabilities before calling structural write; throw `UnsupportedRowModelOperationError` if `!caps.cellMutation`
- [ ] **6.6** Add adversarial tests: `api.setCellValue` on infinite grid throws `UnsupportedRowModelOperationError`; same for server grid
- [ ] **6.7** Run full test suite

### Phase 7 — Architecture guard updates and final cleanup

- [ ] **7.1** Update `architectureGuards.test.ts` — add assertions that:
    - `ClientRowModelController` does not have `setCellValue`, `updateRows`, `applyTransaction` as public methods
    - `ClientStructuralRowModel` interface exists and is implemented
    - `classifyWriteImpact` is exported from `rowModel.ts`
- [ ] **7.2** Add test: `api.setRows` and `api.updateRows` route through `changeApplier.commit` (spy on commit, verify call)
- [ ] **7.3** Add test: `applyTransaction` update of a sort-key field relocates rows correctly (Fix 7 regression test)
- [ ] **7.4** Add test: `setCellValue` on a sort-key field triggers visual reorder (Fix 6 regression test)
- [ ] **7.5** Verify `store.ts` stays under 1150 lines
- [ ] **7.6** Run full typecheck (`tsc --noEmit`) — zero errors
- [ ] **7.7** Run full test suite — all tests pass
- [ ] **7.8** Update `rowModel.capabilities.test.ts` to cover the new capability flags (`cellMutation`, `replaceRows`, `updateRows`)

---

## Files to change

| File                                           | Change                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/GridDomainMutation.ts`                 | Add `ReplaceRowsMutation`, `BatchRowUpdateMutation`                                                                                                             |
| `engine/GridEngine.ts`                         | Add `replaceRows()`, `updateRows()` wrapping commit                                                                                                             |
| `engine/GridDomainMutationExecutorRegistry.ts` | Register new executors; upgrade existing                                                                                                                        |
| `features/DataMutationController.ts`           | Call structural write methods; return enriched result                                                                                                           |
| `rowModel.ts`                                  | Add `RowModelWriteResult`, `RowWriteImpact`, `RowModelRefreshResult`, `ClientStructuralRowModel`; add `classifyWriteImpact`; upgrade `ClientRowModelController` |
| `store.ts`                                     | Route `setRows`/`updateRows` through engine; verify line count                                                                                                  |
| `infiniteRowModel.ts`                          | Remove `setCellValue`                                                                                                                                           |
| `serverPageRowModel.ts`                        | Remove `setCellValue`                                                                                                                                           |
| `rowModel.capabilities.test.ts`                | Add `cellMutation` capability tests                                                                                                                             |
| `engine/architectureGuards.test.ts`            | Add structural interface assertions                                                                                                                             |

## Verification gates (must all pass before plan is complete)

1. Full test suite green (77+ files, 1364+ tests)
2. TypeScript strict typecheck passes — zero errors
3. `store.ts` under 1150 lines
4. `api.setRows` and `api.updateRows` verified to route through `changeApplier.commit` (test or spy)
5. `applyTransaction` sort/filter reconciliation verified with dedicated regression test
6. `setCellValue` on infinite/server throws `UnsupportedRowModelOperationError`
7. No `?.` optional chaining on public row-model command calls in `store.ts`

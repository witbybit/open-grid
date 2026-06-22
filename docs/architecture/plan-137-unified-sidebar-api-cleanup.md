# Plan 137 — Pillar 7: Unified DataIntegrity Sidebar + API Cleanup

> **Status**: Pending
> **Depends on**: Plan 133 (legacy removal)

## Problem

### 7a — Sidebar fragmentation
Three separate sidebar panels exist for data integrity concepts:
- `'dataQuality'` — `DataQualityPanel.tsx`
- `'diff'` — separate diff panel
- `'conflicts'` — separate conflicts panel

Each has its own open/close state, its own "Run" button, its own issue list. Users have to know to open three different panels. Modules that are not configured show empty panels. There is no unified view.

### 7b — Root-level API pollution
`GridApi` exposes redundant root-level methods that duplicate `api.integrity.*`:

```ts
// Root-level (to remove):
api.validateGrid()
api.getAllValidationErrors()
api.setDiffModel()
api.clearDiffModel()
api.createTransactionStream()
api.getConflicts()
api.resolveConflict()
api.clearConflict()

// Correct namespace (keep):
api.integrity.validateGrid()
api.integrity.setDiffModel()
api.integrity.createStream()
api.integrity.getConflicts()
api.integrity.resolveConflict()
```

### 7c — Legacy validation config props
- `ColumnDef.valueValidator` — superseded by `dataIntegrity.validation.cellRules`
- `rowValidator` grid prop — superseded by `dataIntegrity.validation.rowRules`

## Tasks

### Sidebar (7a)

| Task | File | Notes |
|------|------|-------|
| Create `packages/react/src/sidebar/panels/DataIntegrityPanel.tsx` | New | Tab-based: Overview, Validation, Quality, Diff, Live Stream, Conflicts |
| Only show tabs for enabled modules | `DataIntegrityPanel.tsx` | Check `api.integrity.getSummary()` or config presence |
| Register `'dataIntegrity'` as a built-in sidebar panel | `sidebar/SidebarPanel.ts` | Next to `'dataQuality'`, `'diff'`, `'conflicts'` |
| Deprecate `'dataQuality'` panel | `DataQualityPanel.tsx` | Add `@deprecated` JSDoc, log warning if used |
| Deprecate `'diff'` and `'conflicts'` panels | Similar | One release notice |

### API cleanup (7b)

| Task | File | Notes |
|------|------|-------|
| Remove `api.validateGrid()` from `GridApi` | `api/GridApi.ts` | Use `api.integrity.validateGrid()` |
| Remove `api.getAllValidationErrors()` from `GridApi` | `api/GridApi.ts` | |
| Remove `api.setDiffModel()` / `api.clearDiffModel()` | `api/GridApi.ts` | |
| Remove `api.createTransactionStream()` | `api/GridApi.ts` | |
| Remove `api.getConflicts()` / `api.resolveConflict()` / `api.clearConflict()` | `api/GridApi.ts` | |
| Remove forwarding from `GridStore` | `store.ts` | |
| Update `ValidationManager.ts` and `store.ts` usages | Both | Wire through `api.integrity.*` |
| Remove `state.validationErrors` field | `state/GridState.ts:116` | After removing `ValidationManager.ts` |
| Delete `ValidationManager.ts` | `features/ValidationManager.ts` | After all callers migrated |

### Config props (7c)

| Task | File | Notes |
|------|------|-------|
| Remove `ColumnDef.valueValidator` | `columnDef.ts` | Breaking — check demo usage first |
| Remove `rowValidator` grid prop | `GridEngineConfig.ts` | Breaking |
| Confirm demo uses `dataIntegrity.validation` instead | `demo/` | Migration required |

## DataIntegrityPanel tab design

```
┌─ Data Integrity ──────────────────────────────────────┐
│ [Overview] [Validation] [Quality] [Diff] [Conflicts]  │
├───────────────────────────────────────────────────────┤
│ Overview tab:                                          │
│   Summary counts (errors / warnings / total)          │
│   Per-source breakdown                                 │
│   "Run All" button                                     │
│                                                        │
│ Validation tab:                                        │
│   Cell rule issues list + focus-cell button            │
│   "Run Validation" button                              │
│                                                        │
│ Quality tab:                                           │
│   Quality rule issues + Run Quality button             │
│                                                        │
│ Diff tab:                                              │
│   Diff summary, accept-all, accept per row             │
│                                                        │
│ Conflicts tab:                                         │
│   Conflict list, resolve per row                       │
└───────────────────────────────────────────────────────┘
```

## Non-negotiable

After Plan 137 is complete: `api.integrity.*` is the ONLY public namespace for all data integrity operations. There must be zero root-level `api.validate*/api.diff*/api.conflict*` methods on `GridApi`.

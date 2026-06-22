# Plan 132 — Pillar 2: Result-Aware Commits

> **Status**: Pending
> **Depends on**: Plan 131 (Pillar 1 complete)

## Problem

Feature modules (`DiffIntegrityModule`, `ConflictIntegrityModule`) call `setCellValue(rowId, colField, value): void` when accepting a diff or resolving a conflict. This is fire-and-forget — the module has no way to know whether the commit succeeded, was rejected, or triggered a validation error. This means:

- Diff state can be cleared before the underlying write actually lands
- Conflict resolution can report success when the server rejected the value
- Optimistic UI has no rollback path

## Solution

Add `commitCellValue(params): Promise<GridCommitResult>` to the integrity module deps interface. All feature-initiated writes go through this and check the result before mutating local state.

## API

```ts
interface GridCommitResult {
  success: boolean;
  rowId: string;
  colField: string;
  committedValue?: unknown;
  error?: string;
}
```

## Tasks

| Task | File | Notes |
|------|------|-------|
| Add `GridCommitResult` type | `features/dataIntegrity/integrityTypes.ts` | Export publicly |
| Add `commitCellValue` to `GridDataIntegrityManager` deps | `GridDataIntegrityManager.ts` | Wraps `setCellValue` + validation check |
| Update `DiffIntegrityModule.acceptChange()` | `modules/DiffIntegrityModule.ts` | Await result; only clear diff entry on `success: true` |
| Update `ConflictIntegrityModule.resolveConflict()` | `modules/ConflictIntegrityModule.ts` | Await result; return `rejected` status on failure |
| Wire `commitCellValue` into manager deps in `GridEngine.ts` | `engine/GridEngine.ts` | ~line 516 |
| Deprecate direct `setCellValue` dep in integrity modules | Internal | Replace with `commitCellValue` everywhere |

## Implementation sketch

```ts
// In GridDataIntegrityManager deps
commitCellValue: async (rowId, colField, value): Promise<GridCommitResult> => {
  deps.setCellValue(rowId, colField, value);
  // If validation module is active, run cell validation immediately
  if (this.validationModule?.isEnabled()) {
    const issues = await this.validationModule.validateCell(rowId, colField);
    const blocking = issues.filter(i => i.blocking);
    if (blocking.length > 0) {
      return { success: false, rowId, colField, error: blocking[0].message };
    }
  }
  return { success: true, rowId, colField, committedValue: value };
}
```

## Non-negotiable

No feature module may clear optimistic state (diff highlight, conflict marker) before receiving `success: true` from `commitCellValue`.

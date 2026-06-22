# Plan 135 — Pillar 5: Targeted Invalidation

> **Status**: Pending
> **Depends on**: Plan 131 (decoration pipeline locked to insight layer)

## Problem

When a cell-level integrity event occurs (single cell validation, single conflict resolved), `GridDataIntegrityManager.requestInsightRepaint()` calls `this.invalidation.invalidateFull('insight-decorations')` — a full repaint for a single-cell change. This is unnecessary work for grids with thousands of rows.

## Solution

Add targeted cell-level repaint for integrity decoration changes. When only a specific cell's decoration changes (validate one cell, resolve one conflict), only that cell needs rebinding.

## Existing infrastructure

`GridEngine.notifyCellChange(rowId, colField)` → `CellNotificationController` → per-cell invalidation → only that cell gets rebound.

`GridDataIntegrityManager` already has `requestTargetedRepaint` in its deps (used by `LiveStreamIntegrityModule`):

```ts
requestTargetedRepaint: (cells) => {
	for (const { rowId, colField } of cells) {
		this.notifyCellChange(rowId, colField);
	}
};
```

## Tasks

| Task                                                                         | File                                   | Notes                                                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Add `repaintCell(rowId, colField)` to `GridDataIntegrityManager`             | `GridDataIntegrityManager.ts`          | Calls `deps.requestTargetedRepaint([{ rowId, colField }])`                               |
| Update `ValidationIntegrityModule.validateCell()`                            | `modules/ValidationIntegrityModule.ts` | After `_applyIssues`, call `deps.requestRepaint([{ rowId, colField }])` not full repaint |
| Update `ConflictIntegrityModule.resolveConflict()`                           | `modules/ConflictIntegrityModule.ts`   | Targeted repaint for resolved cell                                                       |
| Update `DiffIntegrityModule.acceptChange()`                                  | `modules/DiffIntegrityModule.ts`       | Targeted repaint for accepted cell                                                       |
| Keep `requestInsightRepaint()` (full repaint) for batch operations           | `GridDataIntegrityManager.ts`          | `run()`, `clearIssues()`, `publishServerReport()` still need full repaint                |
| Architecture guard: single-cell integrity ops must not call `invalidateFull` | `architectureGuards.test.ts`           | Verify via content check                                                                 |

## Non-negotiable

Full invalidation is allowed only for batch operations (full quality scan, diff model set, server report publish). Single-cell events (validateCell, resolveConflict, acceptCellDiff) must use targeted cell invalidation.

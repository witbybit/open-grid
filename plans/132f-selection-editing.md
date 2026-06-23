# Plan 132f (Phase 7): Selection & Editing Skeleton

Parent: [`132-core-rewrite-master.md`](./132-core-rewrite-master.md) · Spec: `ARCHITECTURE.md` §3 R10–R11.

## Mission

Add row selection and the editing transaction skeleton. Editing is a transaction system (R10):
`edit.start → edit.updateDraft → edit.commit/cancel`, where `edit.commit` produces a cell-value
write through the existing `CellValueEngine` (one place owns value semantics, R8). Both domains
route through the kernel and return typed change sets.

## Files (new)

- `domains/selection/SelectionState.ts` — `SelectionState` (selected `RowId` set + anchor).
- `domains/selection/SelectionChangeSet.ts` — added/removed/previous/next.
- `domains/selection/SelectionModel.ts` — selectRows/add/deselect/toggle/range/clear → change set.
- `domains/selection/SelectionCommands.ts` — register `selection.*` on the kernel.
- `domains/editing/EditSession.ts` — `EditSession` + `EditStatus`.
- `domains/editing/EditModel.ts` — holds the single active session; start/updateDraft/cancel/commit-bookkeeping.
- `domains/editing/EditingCommands.ts` — register `editing.start/updateDraft/cancel/commit`; commit delegates to the cell engine.
- barrels + tests.

Refactor: export an applied-cell-write draft builder from `cells/CellCommands.ts` so `editing.commit`
reuses the exact same cell-write → commit mapping (no duplicated semantics).

## Invariants

- All selection/editing mutations route through the kernel; the models publish nothing (R1).
- `RangeSelectionModel` (cell ranges) is deferred — not stubbed empty. Row selection is implemented.
- `edit.commit` reuses `CellValueEngine` — value semantics are not re-implemented (R8).
- `edit.commit` on a model without `cellMutation` is `rejected`.
- Editing is one active session at a time for this skeleton; status transitions are explicit (R10).

## Task list

- [x] 7.1 `SelectionState` + `SelectionChangeSet` + `SelectionModel`.
- [x] 7.2 `SelectionCommands` (`selection.selectRows/deselectRows/toggleRow/selectRange/clear`).
- [x] 7.3 `EditSession` + `EditModel`.
- [x] 7.4 Exported `appliedCellWriteDraft` from `CellCommands`; `EditingCommands.commit` reuses it.
- [x] 7.5 Barrels + tests + `tsc --noEmit` clean + suite green.

## Result

`domains/selection/` + `domains/editing/` complete. 11 new tests (selection model + commands;
editing start/updateDraft/commit/cancel + capability reject). Core build typecheck clean; only the
7 pre-existing react failures remain. All 6 gates met. `editing.commit` delegates to
`CellValueEngine` and reuses `appliedCellWriteDraft`, so cell-write semantics are not duplicated.
`RangeSelectionModel` (cell ranges) intentionally deferred, not stubbed.

## Verification gates

1. `selection.selectRows` (replace/add), `toggleRow`, `clear` produce correct change sets + `selection.changed`.
2. Selecting already-selected rows in replace mode that matches current selection → noop.
3. `editing.start` opens a session with the cell's current value as initial+draft; `editing.start` emits `editing.started`.
4. `editing.updateDraft` then `editing.commit` writes the draft via the cell engine and emits `editing.committed` + `cells.changed`; the session closes.
5. `editing.commit` on a server/infinite model → rejected (no cellMutation).
6. `tsc --noEmit` zero errors; new tests green; only the 7 pre-existing react failures remain.

# Plan 132c (Phase 4): Cells Domain

Parent: [`132-core-rewrite-master.md`](./132-core-rewrite-master.md) · Spec: `ARCHITECTURE.md` §3 R8–R9.

## Mission

Make cell values their own domain (R8). The `CellValueEngine` owns value-application semantics
(read raw/display, apply writes, run value setters); the row model owns rows. Value setters are
truly synchronous (R9) — `(...) => boolean`, no `Promise`, with a **working** abort (not a fake
`() => {}`). Cell writes produce a typed `CellChangeSet` and route through the kernel,
capability-gated on `cellMutation`.

## Files (new, under `packages/core/src/domains/cells/`)

- `CellAddress.ts` — `CellAddress` (`rowId`, `columnId`, `field`) + branded `CellId` + `cellId()`.
- `CellValue.ts` — value role types (raw/display) — minimal for now.
- `ValueSetter.ts` — sync-only `ValueSetter<TRow>` + `ValueSetterParams` with a real `abort()`.
- `ValueParser.ts` — `ValueParser<TRow>` (text → value), optional.
- `CellChangeSet.ts` — `CellChangeSet` (`changedValuesByCell`, `changedFieldsByRow`).
- `CellValueEngine.ts` — `CellDataPort`, `CellWriteContext`, `CellWriteOutcome`, the engine.
- `CellCommands.ts` — register `cell.setValue` on the kernel, capability-gated.
- `index.ts` — barrel.
- `CellValueEngine.test.ts` — read/write/noop/abort/reject + kernel integration.

Also: add `writeRowData(rowId, nextData)` to `ClientRowStore` (whole-row replace + field diff),
and expose a `CellDataPort` from `ClientRowModel`.

## Invariants

- `ValueSetter` returns `boolean`, never `boolean | Promise<boolean>` (R9).
- `abort()` actually cancels the write — the outcome is `aborted`, nothing is persisted.
- The engine reads/writes through a `CellDataPort`; it does not reach into row-model internals.
- `cell.setValue` on a model without `cellMutation` is `rejected` (never silent).
- Outcomes are distinct: `applied | noop | aborted | rejected`.

## Task list

- [x] 4.1 `CellAddress` + `CellId`; `CellValue`; `ValueSetter` (sync + abort); `ValueParser`.
- [x] 4.2 `CellChangeSet`.
- [x] 4.3 `ClientRowStore.writeRowData`; `ClientRowModel.writeRowDataStructural` (port built in wiring).
- [x] 4.4 `CellValueEngine` (getRawValue/getDisplayValue/applyCellValue with working abort).
- [x] 4.5 `CellCommands` kernel registration, capability-gated; emits `cells.changed`; undo patch.
- [x] 4.6 Tests + `tsc --noEmit` clean + suite green.

## Result

`packages/core/src/domains/cells/` complete. 10 new tests (read raw/display incl. nested paths,
noop on unchanged, applied + change set, immutable nested write, working abort, declined setter,
transform setter, kernel `cell.setValue` applied + `cells.changed` + undo, server reject). Gate 4
(R9 sync) proven by a `@ts-expect-error` on a `Promise`-returning setter. Root typecheck clean;
all 6 gates met. To avoid a rows→cells import, `CellDataPort` is defined in cells and adapted from
a `ClientRowModel` in the wiring (`getRow` + `writeRowDataStructural`).

## Verification gates

1. `getRawValue` / `getDisplayValue` read nested field paths.
2. `applyCellValue` with no change → `noop`; with change → `applied` + `CellChangeSet`.
3. A `valueSetter` that calls `abort()` → `aborted`, value unchanged.
4. A `valueSetter` is rejected at the type level if it returns a `Promise` (compile-time, R9).
5. `cell.setValue` via kernel on client → applied, emits `cells.changed`; on infinite/server → rejected.
6. `tsc --noEmit` zero errors; new tests green.

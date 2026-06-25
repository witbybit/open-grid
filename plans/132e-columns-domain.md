# Plan 132e (Phase 6): Columns Domain

Parent: [`132-core-rewrite-master.md`](./132-core-rewrite-master.md) · Spec: `ARCHITECTURE.md` §3 R11.

## Mission

Build the columns domain: the column definitions, the mutable view state (width / visibility /
pinning / order), the derived layout snapshot, and the kernel-routed column commands. Persistent
column state is kept separate from runtime (R11). The column model also resolves value setters /
parsers for the cell engine.

## Files (new, under `packages/core/src/domains/columns/`)

- `ColumnDef.ts` — user-facing column definition (`id`, `field`, header, width bounds, hidden, pinned, sortable/filterable, valueSetter/valueParser).
- `ColumnState.ts` — persistable per-column view state (`columnId`, width, hidden, pinned, orderIndex).
- `ColumnChangeSet.ts` — typed change set (added/removed/resized/moved/visibilityChanged/pinnedChanged).
- `ColumnModel.ts` — ordered columns derived from defs + state; resize/move/setVisible/setPinned/setState → ColumnChangeSet; value-setter resolution.
- `ColumnLayout.ts` — derived layout snapshot: per-column left/width + pinned lanes + total width.
- `ColumnCommands.ts` — register `columns.resize/move/setVisible/setPinned/setState` on the kernel.
- `index.ts` — barrel.
- Tests: `ColumnModel.test.ts`, `ColumnLayout.test.ts`, `ColumnCommands.test.ts`.

## Invariants

- Column commands route through the kernel; the model publishes nothing (R1, R11).
- Persistent state (`ColumnState`) is serializable and separate from any runtime concern.
- A no-op (resize to same width, etc.) returns `noop`, not `applied`.
- The layout snapshot is a pure projection of the column model — no rendering, no business state.

## Task list

- [x] 6.1 `ColumnDef` + `ColumnState` + `ColumnChangeSet`.
- [x] 6.2 `ColumnModel` (order/width/hidden/pinned state; resize/move/setVisible/setPinned/setState; getState; getValueSetter).
- [x] 6.3 `ColumnLayout` snapshot (left offsets per lane, pinned lanes, total width).
- [x] 6.4 `ColumnCommands` kernel registration; emits `columns.changed`.
- [x] 6.5 Tests + `tsc --noEmit` clean + suite green.

## Result

`packages/core/src/domains/columns/` complete. 11 new tests across `ColumnModel.test.ts` (6),
`ColumnLayout.test.ts` (2), `ColumnCommands.test.ts` (3) — all green. Core build typecheck clean;
only the 7 pre-existing react failures remain. All 6 gates met. `ColumnModel.getValueSetter`
provides the seam the cell engine's `resolveValueSetter` consumes.

Note: the _root_ tsconfig reports 169 pre-existing errors in `fixtures/` and old `*.test.ts` files
(unrelated to this rewrite — confirmed identical count with this work stashed). The core build
config (`packages/core/tsconfig.json`, excludes tests/fixtures) is the meaningful gate and is clean.

## Verification gates

1. `resize` clamps to min/max and changes width; resize to same width → noop.
2. `move` reorders; `setVisible(false)` hides; `setPinned('left')` pins.
3. `getState()`/`setState()` round-trips order, width, hidden, pinned.
4. `ColumnLayout` gives correct left offsets and separates pinned-left/center/pinned-right lanes.
5. `columns.resize` via kernel applies, bumps `columns`, emits `columns.changed`.
6. `tsc --noEmit` zero errors; new tests green; only the 7 pre-existing react failures remain.

# Plan 132b (Phase 3): Rows Domain

Parent: [`132-core-rewrite-master.md`](./132-core-rewrite-master.md) · Spec: `ARCHITECTURE.md` §3 R3–R6.

## Mission

Build the rows domain as **structural engines** (R3): they own row storage, identity, and
structural change; they return typed `RowChangeSet`s and publish nothing. Branded row identity
(R5), authoritative capabilities (R4), and a single `RowModelPlugin` contract for client /
infinite / server. Then wire the first real row commands through the kernel, capability-gated.

## Files (new, under `packages/core/src/domains/`)

- `columns/ColumnId.ts` — minimal branded `ColumnId` (rows references it; columns domain fleshed out Phase 6).
- `rows/RowId.ts` — branded `RowId`, `VisualRowId` + constructors.
- `rows/RowModelType.ts` — `'client' | 'infinite' | 'server'`.
- `rows/RowNode.ts` — structural `RowNode<TRow>` (`id`, `sourceIndex`, `data`).
- `rows/RowModelCapabilities.ts` — the authoritative capability map + honest per-type baselines.
- `rows/RowModelError.ts` — `RowModelError`, `UnsupportedRowModelOperationError`.
- `rows/RowChangeSet.ts` — typed change set + empty/builder helpers.
- `rows/RowCommand.ts` — `RowTransaction`, `RowCommandResult`, `PipelineRefreshKind`.
- `rows/RowIdentity.ts` — `RowIdentityResolver` (branded ids, duplicate/empty rejection).
- `rows/RowModelPlugin.ts` — `RowModelQuery`, `RowModelCommandHandlers`, `RowModelPlugin`.
- `rows/client/ClientRowStore.ts` — full-dataset storage + identity index.
- `rows/client/ClientRowModel.ts` — client plugin (real structural writes).
- `rows/infinite/InfiniteRowModel.ts` — loaded-block shell; mutations throw unsupported.
- `rows/server/ServerRowModel.ts` — page shell; mutations throw unsupported.
- `rows/RowCommands.ts` — register `rows.replace` / `rows.update` / `rows.applyTransaction` on the kernel, capability-gated.
- `rows/index.ts` — barrel.
- Tests: `client/ClientRowModel.test.ts`, `RowModelCapabilities.test.ts`, `RowCommands.test.ts`.

## Invariants

- Row models never dispatch events, bump versions, notify cells, or invalidate rendering (R3).
- Capabilities are authoritative — no `'method' in rowModel` duck typing (R4). Command handlers
  exist on every plugin; unsupported ones throw `UnsupportedRowModelOperationError`. The kernel
  executor gates on capabilities BEFORE calling.
- `RowId` ≠ `VisualRowId` (R5).
- Unsupported row commands → `rejected` at the kernel; never silent no-op.
- The required pipeline refresh is _reported_ by the row command result; actual pipeline rebuild
  is Phase 5 (the row command handler records it, does not perform it).

## Task list

- [x] 3.1 Branded ids (`ColumnId`, `RowId`, `VisualRowId`), `RowModelType`, `RowNode`.
- [x] 3.2 `RowModelCapabilities` + `clientRowModelCapabilities` / `infinite…` / `server…` baselines.
- [x] 3.3 `RowModelError` + `UnsupportedRowModelOperationError`; `RowChangeSet` + helpers; `RowCommand` types.
- [x] 3.4 `RowIdentityResolver`; `RowModelPlugin` contract.
- [x] 3.5 `ClientRowStore` + `ClientRowModel` (replace/update/applyTransaction/writeCellValue → RowChangeSet).
- [x] 3.6 `InfiniteRowModel` + `ServerRowModel` shells (query over loaded/page rows; mutations throw).
- [x] 3.7 `RowCommands` kernel registration, capability-gated; emits `rows.replaced` / `rows.changed`.
- [x] 3.8 Tests + `tsc --noEmit` clean + suite green (see note).

## Result

`packages/core/src/domains/rows/` + `domains/columns/ColumnId.ts` complete. 14 new tests across
`ClientRowModel.test.ts` (5), `RowModelCapabilities.test.ts` (4), `RowCommands.test.ts` (5) — all
green. Root typecheck (incl. tests) clean. Verification gates 1–6 met: client capabilities honest
& fully mutable, infinite/server honest & throwing, `rows.replace` applies end-to-end through the
kernel, `rows.applyTransaction`/`replace` on server/infinite rejected (not noop), client
transaction change sets correct, duplicate/empty ids rejected.

**Pre-existing failure (NOT this phase):** the combined monorepo `vitest run` shows 7 failures in
`packages/react/.../gridPortalStore.adversarial.test.ts`. These reproduce at the Phase-2 baseline
with this phase stashed, and the file passes 7/7 in isolation and 82/82 in a react-only run. Root
cause: cross-package test pollution when core renderer test files and react portal tests share a
vitest worker. Tracked separately; out of scope for the core rewrite.

## Verification gates

1. Client capabilities honest (`fullDataset/replaceRows/updateRows/transactions/cellMutation` true);
   infinite/server honest (`transactions/rowOrder/cellMutation` false).
2. `rows.replace` on a client model via kernel → `applied`, emits `rows.replaced`, bumps `rows`+`pipeline`.
3. `rows.applyTransaction` on a server model via kernel → `rejected` (capability), not noop.
4. Client `applyTransaction` add/update/remove produces a correct `RowChangeSet`.
5. Duplicate/empty row ids rejected by the identity resolver.
6. `tsc --noEmit` zero errors; full suite green.

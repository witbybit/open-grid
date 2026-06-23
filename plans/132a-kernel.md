# Plan 132a (Phase 2): Grid Kernel

Parent: [`132-core-rewrite-master.md`](./132-core-rewrite-master.md) · Spec: [`ARCHITECTURE.md`](../ARCHITECTURE.md) §3 R1–R2, §6.

## Mission

Build the command-driven `GridKernel` — the single write gateway. Domains register typed command
handlers; the kernel owns the commit lifecycle: dispatch → handler → commit assembly → effect
application (version bumps, events, render invalidation) → undo recording → publication. Returns
`applied | noop | rejected`. Unsupported commands are **rejected, never silently no-op**.

## Files (all new, under `packages/core/src/kernel/`)

- `GridDomain.ts` — `GridDomainId` union.
- `GridEvent.ts` — `GridEvent`, `GridEventDraft`, `GridEventType`.
- `GridEffect.ts` — `GridEffect` (`version-bump | event | render-invalidation`), `RenderInvalidation`.
- `GridChangeSet.ts` — base `GridChangeSet` (domains extend).
- `GridCommand.ts` — `GridCommandPayloads` (augmentable map), `GridCommand`, `GridCommandMeta`, `defineCommand`.
- `GridCommandResult.ts` — `GridCommandResult` + `applied`/`noop`/`rejected` constructors.
- `GridCommit.ts` — `GridCommit`, `GridCommitDraft`, `GridCommandHandlerResult`, `GridCommandHandler`, `GridKernelContext`.
- `GridVersion.ts` — `GridVersionRegistry`.
- `GridUndoRedoEngine.ts` — undo/redo stacks fed by commit undo patches.
- `GridInvariant.ts` — `invariant()` + `GridInvariantError`.
- `GridTransaction.ts` — atomic multi-command batch (stop-on-reject; no fake rollback yet).
- `GridKernel.ts` — registry, `dispatch`, `subscribe`, version access, lifecycle events.
- `index.ts` — barrel.
- `GridKernel.test.ts` — behavior tests.

## Invariants

- Only the kernel bumps versions and emits events.
- A command with no registered handler is `rejected` (`no handler for "<type>"`), never noop.
- `rejected` is never collapsed into `noop`; `noop` is never collapsed into `applied`.
- Handlers receive a read-only context; they return drafts and never publish anything.
- Events emitted by handlers carry no `commitId`; the kernel stamps it.

## Task list

- [x] 2.1 `GridDomainId` + base change set + effect/invalidation types.
- [x] 2.2 `GridEvent` + event-type union + `GridEventDraft`.
- [x] 2.3 `GridCommand` augmentable payload map + meta + `defineCommand`.
- [x] 2.4 `GridCommandResult` + constructors.
- [x] 2.5 `GridCommit` + handler/draft/context contracts.
- [x] 2.6 `GridVersionRegistry`.
- [x] 2.7 `GridUndoRedoEngine` (record/undo/redo/canUndo/canRedo).
- [x] 2.8 `GridInvariant`.
- [x] 2.9 `GridKernel`: register, dispatch, commit assembly, effect application, publication, lifecycle events.
- [x] 2.10 `GridTransaction` batch dispatch (honest stop-on-reject; true rollback deferred to domain engines).
- [x] 2.11 Barrel + tests; `tsc --noEmit` clean; 9/9 tests green.

## Result

`packages/core/src/kernel/` complete: 12 source files + barrel + `GridKernel.test.ts` (9 tests).
Core source typecheck clean; kernel suite green. Nothing imports the kernel yet — it is wired to
domains starting Phase 3. Verification gates 1–6 all met.

## Verification gates

1. `applied` returns a commitId and version-bump effects for each dirty domain.
2. Unsupported command type → `rejected`, and a `grid.commandRejected` event is published.
3. A handler returning `noop` produces no version bump and no domain event.
4. `subscribe` receives `grid.commandApplied` with the commit id on success.
5. Undo patch from an applied commit is recorded and replayable.
6. `tsc --noEmit` zero errors; full suite green.

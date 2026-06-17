# Plan 097: Canonical Domain Command and Mutation Boundary

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.


## Mission

Replace broad store/state mutation and reaction-driven ownership with explicit domain commands. A command must mutate one authoritative model, produce a typed change set, and trigger invalidation/events from committed domain truth.

## Why this changes the project

Today, state keys, controllers, models, reaction logic, and API methods can all participate in deciding what changed. This makes version ownership and side effects ambiguous. The grid cannot become reliably incremental until mutations have one legal entry path and one committed result.

## Status

- **Priority**: P0 — foundational ownership
- **Effort**: XL
- **Risk**: HIGH — changes internal mutation flow
- **Depends on**: Plans 089–096
- **Category**: state, commands, domain models
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

`GridState` remains an important mutable coordination surface. Domain versions and reaction controllers exist, but some truth is inferred from updated keys rather than emitted by the owner that committed the mutation. Transactions can group state updates, yet they do not provide a unified semantic change set.

## Target end state

Introduce an internal command bus or direct command executor with typed commands and typed `GridChangeSet` results. Domain models commit mutations. A transaction collects change sets. Invalidation, public events, persistence dirtiness, and instrumentation derive from the committed change set—not from broad key observation.

## Non-negotiable invariants

- One command produces one atomic committed change set.
- Domain versions increment exactly once per logical commit.
- Failed commands produce no partial mutation, event, version, or invalidation.
- Public events are emitted after commit in deterministic order.
- Nested transactions cannot expose intermediate state.
- High-frequency updates do not require cloning unrelated state domains.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- Direct domain mutation from `GridApi` facade methods.
- Reaction-controller logic that infers semantic mutations from generic state keys.
- Duplicate version increments outside the owning model.
- High-frequency mutable domains stored only as top-level immutable `GridState` copies.
- Internal callers using public API methods merely to reach a model.

## Execution workstreams

### Workstream 1 — Define command and change-set contracts

- Create typed commands for rows, columns, selection, focus, editing, configuration, and viewport-affecting operations.
- Define `GridChangeSet` with affected domains, row/column IDs, structural/geometry flags, event records, and persistence impact.
- Define transaction merge rules and deterministic event ordering.
### Workstream 2 — Move ownership into models

- Move version increments into the domain model that commits the mutation.
- Make API methods dispatch commands rather than coordinating models directly.
- Make invalidation consume change sets.
- Keep public state snapshots as composed read models, not the primary mutation mechanism.
### Workstream 3 — Delete reaction ambiguity

- Remove semantic reaction paths that inspect generic updated-key arrays.
- Retain narrowly scoped observers only for external subscriptions and derived read snapshots.
- Add guards forbidding direct calls to domain mutators outside command handlers and model-internal code.

## Forbidden end state

- Adding a command bus while API methods still mutate models directly.
- Wrapping old reactions in command handlers without deleting them.
- A generic `any` command or stringly typed payload system.
- One giant command handler that becomes a new god object.
- Keeping two versioning systems.

## Verification program

- Contract tests for atomicity, failure rollback, version increments, event order, and merged transactions.
- Property tests comparing batched commands with equivalent sequential committed results.
- Allocation benchmark for 1,000 value updates and drag selection.
- Architecture guard proving API facade code cannot import mutable model implementation details except through the command executor.

## Evidence required in the PR

- Before/after architecture diagram showing ownership changes.
- List of deleted files, methods, paths, and compatibility aliases.
- Behavioral test output and benchmark output.
- Explanation of any target invariant not achieved; unresolved items block completion.

## Completion gate

- All public mutating APIs dispatch typed commands.
- Every domain version is owned by its model.
- Generic state-key reaction logic no longer determines semantic mutations.
- Value-only row updates avoid cloning unrelated grid state.
- Behavioral compatibility tests pass for reference features.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.

# Plan 104: Fault-Isolated Grid Change Commit Protocol

> A canonical mutation boundary is unsafe if an event listener, invalidation handler, history adapter, or render request can leave a change half-committed.

## Mission

Turn `GridChangeApplier` into a deterministic, fault-isolated commit protocol with explicit validation, commit phases, typed events, and well-defined failure semantics.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — changes event and commit semantics
- **Depends on**: Plan 103
- **Category**: correctness, transactions, events, history

## Current state to replace

The current apply sequence can conceptually perform:

```text
state → invalidation → versions → events → undo → render
```

If a middle operation throws, later obligations may never run. Event payload typing also loses the relationship between event type and payload, and recursive `undo`/`redo` changes risk ambiguous history graphs.

## Target commit protocol

```text
1. Validate command and preconditions
2. Compute immutable commit record
3. Commit domain state atomically
4. Publish domain versions
5. Apply invalidation plan
6. Register history record
7. Publish persistence/change notifications
8. Request rendering
9. Deliver user events through fault-isolated listeners
10. Report listener/runtime faults without rolling back committed state
```

The exact ordering may differ where justified, but it must be documented, deterministic, and tested.

## Non-negotiable invariants

- User event listeners cannot prevent render scheduling or corrupt committed state.
- A failed precondition commits nothing.
- Once state commit succeeds, all required internal completion steps execute through `finally`/fault isolation.
- Event type and payload remain linked at compile time.
- History records are non-recursive and bounded.
- Commit results expose success, no-op, rejected, and faulted outcomes explicitly.

## Mandatory demolition

- Remove casts that pair arbitrary event payloads with event keys.
- Remove recursive `GridChange.undo` / `GridChange.redo` graphs.
- Remove event delivery from the critical section if listeners can throw through it.
- Remove silent partial-commit behavior.
- Remove duplicate history registration outside the commit boundary.

## Execution workstreams

### Workstream 1 — Define commit records and results

Create types such as:

```ts
type GridCommitResult =
  | { status: 'committed'; changeId: number }
  | { status: 'noop' }
  | { status: 'rejected'; reason: string }
  | { status: 'faulted'; fault: GridRuntimeFault };
```

Define a computed internal commit record separate from the incoming command.

### Workstream 2 — Fix event typing

Use a discriminated event union derived from `GridEventPayloadMap` so wrong payloads cannot compile.

### Workstream 3 — Separate history records

Represent history as bounded inverse operations or factories, not nested changes. Define behavior for asynchronous edits and rejected commits.

### Workstream 4 — Isolate faults

Ensure event bus listeners, instrumentation sinks, persistence observers, and renderer requests report faults independently. Add a policy for whether internal invariant failures throw in development and degrade safely in production.

### Workstream 5 — Prove ordering

Add integration tests that inject failures at every phase and assert the final state, versions, history, render request, events, and fault report.

## Forbidden end state

- A broad `try/catch` hides failures without preserving required completion steps.
- Event delivery occurs before a state commit is durable.
- Listeners can cancel or partially apply ordinary commits unless cancellation is an explicit command contract.
- Undo remains embedded recursively inside changes.
- Commit order is implied by source layout but undocumented.

## Completion gate

- Every commit returns an explicit result.
- Precondition failure is atomic.
- Post-commit listener faults cannot skip rendering or history.
- Event typing requires no unsafe payload casts.
- Failure-injection tests cover every commit phase.

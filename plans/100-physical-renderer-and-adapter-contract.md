# Plan 100: Physical Renderer and Adapter Contract

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.

## Mission

Make physical slot ownership and renderer adapter behavior impossible to misunderstand. Native rendering remains the default path; framework adapters receive explicit mount/update/unmount commands keyed by mandatory physical identity generations.

## Why this changes the project

The slot renderer is the project’s strongest technical asset, but mixed logical/physical identity and custom renderer lifecycles are the easiest place for stale content, double commits, leaked subscriptions, and accidental React work.

## Status

- **Priority**: P0 — rendering correctness
- **Effort**: XL
- **Risk**: HIGH — portals and slot lifecycle
- **Depends on**: Plans 089–099
- **Category**: slots, DOM renderer, React adapter
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

The code has slot pools, lane-based cells, generations, native/imperative/React render paths, portal stores, and host bridges. Correctness has improved, but identity is threaded through multiple optional fields and multiple layers still perform reconciliation-like ownership work.

## Target end state

Define a compact `PhysicalCellIdentity` and `LogicalCellBinding`. Slot generation is mandatory for pooled cells. `SlotRenderer` alone binds logical data to physical cells. Adapters receive a command stream and may not inspect global grid state per cell. Editing uses one owner and one commit protocol.

## Non-negotiable invariants

- Physical identity is mandatory and never inferred from DOM ancestry.
- Logical identity changes do not require physical DOM creation.
- Stale async or deferred adapter work cannot affect a rebound slot.
- Native cells produce no React reconciliation.
- Exactly one subsystem owns custom renderer mount state.
- Exactly one subsystem owns edit session truth.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- Optional slot generations on pooled renderer paths.
- Per-cell subscriptions to global state.
- Adapter fallback edit commits or alternate commit APIs.
- Container-key, renderer-key, and slot-key ownership maps that duplicate the same truth.
- React reconciliation for native/default cells.
- Custom renderer managers with overlapping lifecycle responsibility.

## Execution workstreams

### Workstream 1 — Formalize identity and command stream

- Define physical slot/lane/index/generation identity separately from logical row/column identity.
- Define mount, update, move, suspend, and unmount adapter commands.
- Reject stale commands by exact physical identity equality.

### Workstream 2 — Collapse renderer ownership

- Make the slot renderer the only owner of physical binding.
- Choose one custom renderer lifecycle manager; remove parallel portal/custom/DOM ownership where responsibilities overlap.
- Make warm reuse and cache semantics explicit and bounded.

### Workstream 3 — Simplify React integration

- Use one structural subscription for adapter commands and targeted editor state delivery.
- Do not allow portal cells to call `api.getState()` for routine updates.
- Ensure React Strict Mode mount/unmount behavior is safe.
- Make adapter failure isolation and cleanup deterministic.

### Workstream 4 — Unify editing lifecycle

- One edit session owner, one commit/cancel protocol, one validation pipeline.
- Editor renderer unmount cannot invent a fallback value write.
- Async commit results are generation/session checked.

## Forbidden end state

- Adding another identity field without deleting redundant keys.
- A portal store that becomes a second grid state manager.
- Renderer-specific business logic inside `RowSlot`.
- Using React keys as the primary physical ownership mechanism.
- Allowing adapters to schedule grid frames directly.

## Verification program

- Adversarial tests for rapid slot reuse, horizontal lane changes, pinned-column moves, async renderer completion, edit commit during scroll, and host remount.
- Strict Mode tests for duplicate mount/unmount.
- Leak tests for subscriptions, DOM nodes, editor sessions, and retained row objects.
- Benchmark native-only versus 10%, 50%, and 100% custom renderer saturation.
- Assert zero new DOM nodes during steady native scroll.

## Evidence required in the PR

- Before/after architecture diagram showing ownership changes.
- List of deleted files, methods, paths, and compatibility aliases.
- Behavioral test output and benchmark output.
- Explanation of any target invariant not achieved; unresolved items block completion.

## Completion gate

- One formal physical identity type is used everywhere pooled cells cross a boundary.
- One renderer lifecycle authority remains.
- Per-cell global subscriptions are gone.
- Editing has one commit path.
- Adapter and native paths pass lifecycle, leak, and scroll benchmarks.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.

# Plan 098: Render Runtime Convergence and Demolition

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.


## Mission

Reduce rendering to one legal path: committed change set → invalidation → one frame arbiter → viewport/slot renderer → adapter flush. Delete every alternate scheduling, direct render, and hidden post-scroll path.

## Why this changes the project

The grid has the correct concepts—runtime phase, invalidation, frame coordination, slot rendering—but evolutionary layers can still make execution difficult to trace. This plan turns those concepts into one authoritative runtime rather than a family of cooperating mechanisms.

## Status

- **Priority**: P0 — rendering authority
- **Effort**: XL
- **Risk**: HIGH — central runtime rewrite
- **Depends on**: Plans 089–097
- **Category**: renderer, scheduling, invalidation
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

Render work is distributed across coordinator classes, renderer orchestration, scroll handling, portal scheduling, host bridge behavior, and deferred decoration. Even after prior consolidation, the cost of answering “who requested this frame and what is allowed now?” remains too high.

## Target end state

A single `FrameRuntime` owns browser scheduling, phase transitions, pending invalidation, scroll epochs, post-scroll work, cancellation, and frame instrumentation. Renderers perform work but cannot schedule themselves. Adapters enqueue adapter work through the runtime. No production module outside the runtime scheduler may call RAF, microtasks for rendering, or rendering timers.

## Non-negotiable invariants

- At most one browser frame callback is pending for grid rendering.
- Every frame has one phase and one monotonically increasing epoch.
- Scroll work takes priority over ordinary paint in the same frame.
- No adapter flush observes half-bound physical slots.
- No requested work silently disappears; it executes, coalesces, or is invalidated with a recorded reason.
- Destroy cancels all future runtime callbacks.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- Direct RAF/timer/microtask rendering paths outside the runtime.
- Independent paint, scroll, portal, and decoration schedulers.
- Duplicate scrolling/frame-active booleans outside `RenderRuntimeState`.
- `flushNow` usage outside tests, initial mount, and explicitly documented synchronous host operations.
- Render methods callable without an invalidation/change-set reason.
- Coordinator layers that only forward calls without owning policy.

## Execution workstreams

### Workstream 1 — Build the single arbiter

- Use one RAF registration and pending work bits/queues.
- Process scroll, paint, adapter flush, and post-scroll work in a documented order with budgets.
- Own phase transitions and epochs inside the runtime; callbacks cannot transition phases.
- Capture reason traces for every scheduled frame in diagnostics builds.
### Workstream 2 — Collapse render execution

- Merge or remove forwarding-only paint/orchestration/viewport coordinators.
- Keep separate models and renderers, but make the execution path visually obvious in code.
- Route all invalidation through typed change sets from Plan 097.
### Workstream 3 — Enforce scheduling authority

- Inject one scheduler abstraction into the runtime only.
- Add source and runtime guards forbidding browser scheduling elsewhere.
- Make post-scroll work durable, epoch-bound, cancellable, and budgeted.
- Make portal/adapter flush a named stage rather than an incidental synchronous call.

## Forbidden end state

- Keeping old coordinators behind aliases.
- One RAF per work category.
- Runtime callbacks that recursively schedule browser work directly.
- A permanent feature flag switching old/new render runtimes.
- Passing the entire store through every renderer stage.

## Verification program

- Deterministic fake-scheduler integration tests for ordering, coalescing, cancellation, destroy, new-scroll invalidation, and reentrant invalidation.
- Frame trace golden tests for initial mount, steady scroll, column resize, editing, and portal mounting.
- Browser benchmark: zero DOM creation during steady native-cell scroll; bounded writes and allocations; no duplicate RAF callbacks.
- Failure injection tests where renderer or adapter stages throw; runtime must recover to a valid phase.

## Evidence required in the PR

- Before/after architecture diagram showing ownership changes.
- List of deleted files, methods, paths, and compatibility aliases.
- Behavioral test output and benchmark output.
- Explanation of any target invariant not achieved; unresolved items block completion.

## Completion gate

- There is exactly one render scheduling authority.
- Old scheduler/coordinator paths are deleted.
- Every render can be explained from a committed change set and frame trace.
- Runtime integration tests cover ordinary, scroll, adapter, and post-scroll work.
- Steady-scroll budgets meet the benchmark manifest from Plan 091.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.

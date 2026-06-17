# Plan 102: Adversarial Correctness, Fuzzing, and Lifecycle Hardening

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.


## Mission

Prove that the consolidated engine remains correct under hostile operation ordering, random mutations, async races, renderer failures, remounts, and feature combinations. Replace happy-path confidence with adversarial evidence.

## Why this changes the project

A grid fails in production through sequences, not isolated methods: scroll during edit validation, data replacement during server loads, column movement during portal work, filter changes during transactions, and destroy during scheduled frames. These interactions must be tested intentionally.

## Status

- **Priority**: P0 — trust
- **Effort**: XL
- **Risk**: MEDIUM — test infrastructure
- **Depends on**: Plans 089–101
- **Category**: testing, correctness, lifecycle
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

The repository contains many targeted unit and architecture tests. Some guards are source-string based, and feature tests may validate local behavior without testing the complete command→model→render→adapter lifecycle.

## Target end state

Create model-based and property-based test harnesses. Maintain a simple reference model for supported semantics. Generate command sequences and compare state, visual rows, selection/focus/edit identity, rendered bindings, and lifecycle cleanup. Add deterministic fault/race injection.

## Non-negotiable invariants

- Incremental output equals reference/full-rebuild output.
- Destroy is terminal and idempotent.
- Stale async work is ignored by generation/session checks.
- No physical slot is owned by two logical cells simultaneously.
- No edit commit occurs twice.
- All emitted events correspond to committed state.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- Source-string tests used as proof of runtime semantics.
- Tests coupled to private method call order unless that order is the contract.
- Non-deterministic timers and real network dependencies in core lifecycle tests.
- Snapshots that hide incorrect semantic data.
- Ignored unhandled promises, listener leaks, and console/runtime faults.

## Execution workstreams

### Workstream 1 — Build reference models

- Flat sort/filter/select/edit reference model.
- Grouped aggregate reference model.
- Physical-slot ownership checker independent of DOM implementation.
- Server request generation and stale-response oracle.
### Workstream 2 — Generate hostile sequences

- Random row/column mutations, transactions, filter/sort changes, viewport movement, pinning, editing, undo/redo, host remount, and destroy.
- Inject async renderer/editor/server completion at every lifecycle boundary.
- Shrink failing sequences and persist them as regression cases.
### Workstream 3 — Harden lifecycle

- Run mount/destroy loops under React Strict Mode.
- Assert all scheduler callbacks, subscriptions, DOM ownership, requests, and adapter handles are released.
- Inject exceptions in each frame stage and renderer adapter command.
- Ensure runtime faults are reported without corrupting future operation where recovery is supported.

## Forbidden end state

- Only adding more example-based tests.
- Fuzzing implementation details instead of public/internal contracts.
- Suppressing discovered faults to keep random tests green.
- Allowing known flaky seeds.
- Running massive fuzz suites on every developer command rather than tiering them appropriately.

## Verification program

- Fast deterministic property tests in normal CI.
- Extended seeded fuzz runs in scheduled CI.
- Store seed, command trace, runtime trace, and minimized reproduction for failures.
- Leak detection via listener/handle counts and browser heap snapshots.
- Mutation differential tests across incremental and full-rebuild execution.

## Evidence required in the PR

- Before/after architecture diagram showing ownership changes.
- List of deleted files, methods, paths, and compatibility aliases.
- Behavioral test output and benchmark output.
- Explanation of any target invariant not achieved; unresolved items block completion.

## Completion gate

- Reference-model differential tests cover the alpha feature matrix.
- Host/runtime/adapter lifecycle passes repeated mount/destroy and failure injection.
- Known race sequences are permanent regression tests.
- Source-string tests are limited to dependency/export guards.
- No unexplained runtime faults, leaks, or flaky seeds remain.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.

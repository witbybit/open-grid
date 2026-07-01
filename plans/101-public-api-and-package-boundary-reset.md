# Plan 101: Public API and Package Boundary Reset

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.

## Mission

Use the pre-release window to reduce the public surface to a coherent, durable API. Hide implementation details, separate stable and experimental exports, and make common application workflows simple without exposing the store or runtime.

## Why this changes the project

Every accidental export becomes future maintenance debt after release. The project currently has the rare freedom to break everything. This plan spends that freedom deliberately instead of preserving POC-shaped APIs.

## Status

- **Priority**: P0 — pre-release freedom
- **Effort**: XL
- **Risk**: HIGH — intentional breaking changes
- **Depends on**: Plans 089–100
- **Category**: API, packages, TypeScript
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

Public and internal boundaries have improved, but compatibility hubs, broad types, React integration shapes, feature exports, persistence contracts, and internal escape hatches may still expose implementation details or inconsistent naming.

## Target end state

Stable packages expose: grid creation/components, column and row configuration, typed `GridApi`, documented events, stable renderer/editor contracts, and versioned persistence. Internal packages expose models/runtime only to adapters and tests. Experimental features use an explicit namespace/package and carry no compatibility promise.

## Non-negotiable invariants

- Consumers can use the grid without touching internal state or runtime objects.
- One public method exists per semantic operation.
- Public snapshots are readonly.
- Public API errors are actionable and non-corrupting.
- Experimental contracts are visibly unstable.
- Public API snapshots change only through reviewed intentional diffs.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- Public `GridStore`, engine, domain model, slot, scheduler, portal-store, or runtime-port types.
- Root barrels that re-export internal implementation types.
- Duplicate ways to perform the same operation.
- Deprecated methods retained before a first release.
- `any`-based generic escape hatches where typed contracts are practical.
- Public state objects that consumers are expected to mutate.

## Execution workstreams

### Workstream 1 — Audit consumer workflows

- Use the real application to document setup, data updates, selection, editing, filters, persistence, custom rendering, and teardown.
- Identify boilerplate, internal reach-through, unstable callbacks, and missing transactional APIs.
- Design from workflows rather than mirroring internals.

### Workstream 2 — Reset package exports

- Create explicit stable, internal, and experimental entry points.
- Remove compatibility aliases and deprecated methods.
- Add API Extractor or equivalent snapshot tests for every public package.
- Enforce no stable import can resolve an internal source file.

### Workstream 3 — Normalize contracts

- Use consistent naming and return/error semantics.
- Separate commands from snapshots and subscriptions.
- Make async operations explicit.
- Keep persistence versioned and failure-safe.
- Define lifecycle/destroy behavior for all handles.

## Forbidden end state

- Keeping old names “just in case.”
- Exposing internal models because the demo needs them.
- Creating a public generic `dispatch` API that leaks command internals.
- Using React context as the only way to access the grid API.
- Letting package barrels hide dependency cycles.

## Verification program

- Compile consumer fixtures for React and headless/core usage.
- API snapshot and TypeScript negative tests.
- Verify no consumer fixture imports internal paths.
- Migration is not required for unreleased APIs; deletion is preferred.
- Test destroy/remount, SSR, Strict Mode, persisted-state mismatch, and async operation errors.

## Evidence required in the PR

- Before/after architecture diagram showing ownership changes.
- List of deleted files, methods, paths, and compatibility aliases.
- Behavioral test output and benchmark output.
- Explanation of any target invariant not achieved; unresolved items block completion.

## Completion gate

- Stable public surface is documented and snapshotted.
- No deprecated pre-release APIs remain.
- Internal runtime/model types are absent from stable exports.
- The real application uses only stable public APIs.
- Common workflows require no internal reach-through.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.

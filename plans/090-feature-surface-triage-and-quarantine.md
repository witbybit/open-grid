# Plan 090: Feature Surface Triage and Quarantine

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.


## Mission

Stop feature breadth from controlling core architecture. Classify every feature, retain only those that validate the target engine, quarantine unstable implementations behind internal boundaries, and delete features whose cost exceeds current proof value.

## Why this changes the project

A POC benefits from broad pressure testing, but a product foundation cannot let every experiment remain equally important. Without triage, obscure feature combinations force permanent complexity into row models, rendering, state, and public APIs before the first release.

## Status

- **Priority**: P0 — scope control
- **Effort**: L
- **Risk**: MEDIUM — may remove or freeze features
- **Depends on**: Plan 089
- **Category**: product scope, features, cleanup
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

Many advanced features exist at varying maturity: grouping, tree data, aggregation, formulas, detail rows, fill, clipboard, menus, charts, sidebar, SSRM, custom filters, persistence, and more. Their architectural status and release promises are not uniformly defined.

## Target end state

Create a feature registry with four levels: foundation, reference, incubating, deferred. Foundation and reference features must conform to the architecture constitution in Plan 089 and must not block the corrective or convergence work in Plans 092–101. Incubating features are internal/experimental and cannot shape public contracts. Deferred features are removed from active exports and receive no new work.

## Non-negotiable invariants

- Foundation architecture does not depend on incubating features.
- Every exported feature has an owner, lifecycle, tests, and documentation status.
- Deferred features cannot block breaking changes.
- Feature status is visible in source, docs, and package exports.
- Optional UI features prefer plugin/adapter boundaries over core branches.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- Public exports for deferred or structurally unstable features.
- Feature-specific exceptions in core hot paths without an owner and benchmark.
- Experimental compatibility layers.
- Demo-only code imported by production packages.
- Features with no tests beyond rendering a happy-path example.
- Dead feature flags and unreachable branches.

## Execution workstreams

### Workstream 1 — Inventory and score features

- For every feature, record architectural pressure, user value, implementation maturity, test depth, performance cost, and public API leakage.
- Assign foundation/reference/incubating/deferred status.
- Choose the minimal alpha feature matrix.
### Workstream 2 — Quarantine incubating work

- Move experimental APIs behind internal exports or explicit experimental namespaces.
- Prevent incubating features from adding exceptions to foundation models.
- Require adapters/plugins for optional UI-heavy features where possible.
### Workstream 3 — Delete low-value complexity

- Remove dead branches, duplicate controllers, abandoned feature flags, and premature compatibility aliases.
- Remove features that cannot conform without distorting the target architecture; record them for later clean reimplementation.
- Shrink demos to intentional reference scenarios.

## Forbidden end state

- Marking everything “reference” to avoid deletion.
- Keeping broken features because tests already exist.
- Using feature flags as permanent architecture.
- Publishing experimental APIs from the stable root export.
- Removing pressure-test features without preserving the scenarios that exposed architecture requirements.

## Verification program

- Generate a machine-readable feature registry and validate package exports against it.
- Build the alpha feature matrix in both native and React demo apps.
- Run combination tests only for supported reference-feature pairs.
- Measure bundle impact by feature/package.
- Confirm deferred features are absent from stable public exports.

## Evidence required in the PR

- Before/after architecture diagram showing ownership changes.
- List of deleted files, methods, paths, and compatibility aliases.
- Behavioral test output and benchmark output.
- Explanation of any target invariant not achieved; unresolved items block completion.

## Completion gate

- Every feature is classified.
- Alpha reference matrix is explicit and tested.
- Incubating features cannot shape stable public contracts.
- Dead/duplicate feature infrastructure is deleted.
- Core complexity is reduced measurably by file count, export count, branch count, or dependency graph.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.

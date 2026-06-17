# Plan 103: Alpha Foundation Cut and Codebase Demolition

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.


## Mission

Create the first coherent foundation cut—not a public stable release—where the target architecture is authoritative, obsolete mechanisms are deleted, reference features pass hard gates, and the codebase is smaller and easier to explain than the POC.

## Why this changes the project

The project needs a moment where the conversation changes from “which architectural hole do we patch next?” to “which product capability do we harden or ship?” That requires a deliberate demolition and foundation milestone, not another accumulation of completed plans.

## Status

- **Priority**: P0 — convergence milestone
- **Effort**: XL
- **Risk**: HIGH — deletes compatibility and experimental rot
- **Depends on**: Plans 089–102
- **Category**: release foundation, cleanup, milestone
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

The repository contains the product of rapid successful exploration and successive course corrections. Even after individual plans land, obsolete helpers, compatibility exports, forwarding classes, dormant flags, duplicate tests, and experimental feature code can remain.

## Target end state

Cut an internal `0.1.0-foundation` milestone. The architecture constitution is true in production code. Stable/internal/experimental surfaces are separated. Only the alpha reference feature matrix is guaranteed. Build, tests, fuzzing, benchmarks, package/API snapshots, and the real application all pass from a clean checkout.

## Non-negotiable invariants

- The foundation cut is a smaller conceptual system than the POC.
- No completed migration retains an old path.
- All packages build and test from a clean checkout.
- The real application uses only supported APIs.
- Reference features satisfy correctness, lifecycle, and benchmark gates.
- Future feature work extends owners instead of adding parallel systems.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- All superseded scheduler, reaction, renderer-owner, state-version, and compatibility paths identified in Plans 089–099.
- Deprecated APIs and aliases.
- Forwarding-only classes and interfaces with one implementation and no policy value.
- Feature flags for completed architectural migrations.
- Dead code, unused exports, duplicate tests, plan-history comments, and temporary adapters.
- Experimental features that failed Plan 090 quarantine requirements.

## Execution workstreams

### Workstream 1 — Run the demolition audit

- Generate dependency graph, export graph, file/class responsibility inventory, and dead-code report.
- For every major subsystem, compare actual code to the architecture constitution.
- Delete rather than deprecate because no release compatibility exists.
### Workstream 2 — Create the foundation cut

- Produce clean package manifests, workspace configuration, build/test commands, benchmark commands, and release artifacts.
- Verify core and React packages from a clean checkout.
- Integrate the real application using only stable APIs.
- Write concise architecture, contributor, debugging, and performance docs.
### Workstream 3 — Hold the foundation review

- Explain the complete mutation and render paths from memory using code references.
- Review the codebase by owner, not file chronology.
- Reject the milestone if any responsibility has two active owners or any benchmark gate lacks evidence.
- Create the post-foundation roadmap only after this review.

## Forbidden end state

- Calling the milestone complete because plan checkboxes are marked.
- Releasing publicly before the foundation gates pass.
- Keeping deprecated code for hypothetical future users.
- Creating new features during the demolition window.
- Accepting an architecture that still requires plan-history knowledge to understand.

## Verification program

- Full clean-checkout build and test matrix.
- API/package snapshots and export audit.
- Benchmark report from Plan 091.
- Fuzz/lifecycle report from Plan 102.
- Real application smoke, interaction, persistence, and performance tests.
- Codebase metrics before/after: production LOC, exported symbols, coordinators/controllers, direct scheduler calls, compatibility aliases, and dependency cycles.

## Evidence required in the PR

- Before/after architecture diagram showing ownership changes.
- List of deleted files, methods, paths, and compatibility aliases.
- Behavioral test output and benchmark output.
- Explanation of any target invariant not achieved; unresolved items block completion.

## Completion gate

- Architecture constitution matches runtime reality.
- Plans 089–102 completion gates are independently verified.
- Obsolete paths and flags are deleted.
- Foundation package artifacts can be consumed by the real app from a clean build.
- The owner can explain the system through a small number of authoritative flows.
- The next roadmap is product hardening and release work—not another architectural rescue.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.

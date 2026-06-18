# Plan 091: Performance Baseline Laboratory and Regression Harness

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.

## Mission

Turn performance from an architectural aspiration into a reproducible laboratory with fixed scenarios, budgets, traces, and CI regression gates. No optimization or complexity is accepted without measurable evidence.

## Why this changes the project

The grid is being brutally optimized, but local micro-optimizations can increase system complexity without improving user-visible latency. A benchmark laboratory becomes the neutral authority for architectural decisions.

## Status

- **Priority**: P0 — evidence
- **Effort**: XL
- **Risk**: MEDIUM — benchmark infrastructure
- **Depends on**: Plans 089 and 090
- **Category**: performance, benchmarks, diagnostics
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

Performance tests and instrumentation exist, but scenarios, hardware normalization, budgets, production/demo separation, memory checks, and regression policy are not yet a complete product-level discipline.

## Target end state

Create a reproducible benchmark laboratory before architectural demolition begins. Capture the current baseline for the feature matrix retained by Plan 090, define scenario manifests and measurement protocols, and make the harness the evidence source used throughout Plans 092–103. Lightweight regression gates land now; final release budgets are enforced by Plan 103.

## Non-negotiable invariants

- A pre-convergence baseline is captured before Plans 092–100 change hot paths.
- Performance is measured in representative browser scenarios, not inferred from code shape.
- Correctness and memory are part of performance acceptance.
- Diagnostics can be compiled/configured to near-zero production overhead.
- Every hot-path optimization records a before/after result.
- Benchmark regressions require an explicit reviewed baseline update.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- Ad hoc stopwatch tests in unit suites presented as reliable performance evidence.
- Production hot-path counters that are always enabled solely for benchmarks.
- Benchmarks mixed with demo code or dependent on network variability.
- Claims based on one row count or one browser.
- Optimizations with no before/after record.
- Unbounded diagnostic arrays or retained traces.

## Execution workstreams

### Workstream 1 — Build canonical scenarios

- 10k, 100k, and 1m flat rows.
- Wide grid with horizontal virtualization and pinning.
- Variable-height rows.
- Grouping/aggregation and tree expansion.
- 1k and 10k updates/sec batches.
- Native, mixed, and full custom-renderer saturation.
- SSRM block scrolling with latency and stale responses.

### Workstream 2 — Define budgets

- Frame CPU percentiles, long frames, DOM creates/removes, cell writes, allocations, heap retention, mount counts, update latency, initial render, and bundle size.
- Define hard correctness budgets such as zero steady-scroll DOM creation for native rows.
- Define environment metadata and acceptable variance.

### Workstream 3 — Capture the pre-convergence baseline

- Run every retained foundation/reference scenario before Plans 092–100 begin.
- Store raw results, environment metadata, traces, and the current known bottlenecks.
- Record which numbers are informational and which are immediate correctness budgets.
- Do not treat the POC baseline as a permanent performance target; it is comparison evidence.

### Workstream 4 — Automate regression analysis

- Produce machine-readable benchmark output and visual traces.
- Give Plans 092–100 a stable command for before/after comparison.
- Compare against committed baselines with statistical tolerance.
- Require architecture plans affecting hot paths to name the scenarios they must improve or preserve.
- Run lightweight gates in CI and full browser matrix on scheduled/release runs.

## Forbidden end state

- Gaming benchmarks through unrealistic overscan or disabled features.
- Optimizing only average FPS.
- Accepting memory growth because frame time is low.
- Comparing numbers from uncontrolled environments as exact.
- Adding data structures that improve one benchmark while making common cases worse without a policy decision.

## Verification program

- Commit benchmark manifests, generated fixtures, harnesses, and baseline schema.
- Validate trace metrics against instrumentation tests.
- Run Chrome stable as the primary gate plus Firefox/Safari-equivalent scheduled checks where available.
- Add memory leak scenarios across mount/destroy, scrolling, editing, renderer replacement, and SSRM refresh.
- Publish a benchmark report artifact for every release candidate.

## Evidence required in the PR

- Benchmark scenario manifest and fixture inventory.
- Environment-normalized baseline report with raw machine-readable output.
- Trace samples for scroll, updates, grouping, renderer saturation, and lifecycle scenarios.
- CI/scheduled-run configuration and documented variance policy.
- Known benchmark limitations and any scenarios intentionally deferred.

## Completion gate

- Canonical scenarios run reproducibly.
- The pre-convergence baseline is committed with environment metadata.
- Lightweight correctness/performance budgets are machine-checked.
- Plans 092–100 can produce comparable before/after evidence.
- Final alpha budgets are explicitly deferred to and enforced by Plan 103.
- The project can answer “is this faster?” with evidence rather than architectural intuition.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.

# Plan 099: Row Model and Derived Data Authority

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.


## Mission

Establish one authoritative row-data model and one derived visual-row model with explicit incremental contracts. Remove mixed ownership between stores, pipelines, controllers, maps, and renderer-facing arrays.

## Why this changes the project

Rows are the semantic centre of the grid. If source order, row identity, grouping, aggregation, filtering, sorting, tree parentage, pagination, and SSRM blocks do not have explicit owners, every later optimization creates correctness risk.

## Status

- **Priority**: P0 — data correctness and scalability
- **Effort**: XL
- **Risk**: HIGH — row pipeline and mutation paths
- **Depends on**: Plans 089–098
- **Category**: rows, grouping, aggregation, SSRM
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

The current row system has strong concepts—raw rows, nodes, visual rows, dependency classification, pipeline stages, incremental mutation paths—but retains full-array/maps assumptions and multiple derived indexes. Client and server models share renderer infrastructure but can drift in lifecycle semantics.

## Target end state

Define a `RowDataModel` interface for source truth and a `VisualRowModel` interface for derived truth. Client and server implementations obey the same read contract but own different loading/mutation semantics. Derived indexes are encapsulated, versioned, and updated through explicit mutation plans. The renderer reads a stable row-window interface, never raw pipeline internals.

## Non-negotiable invariants

- Row ID, visual-row ID, source position, visual position, and physical slot are separate types/concepts.
- Every derived row result is a deterministic function of source truth plus model configuration.
- Incremental and full rebuild paths produce identical visual output.
- Aggregates are model truth, never renderer truth.
- Stale server responses cannot mutate the current model generation.
- No renderer depends on client- or server-specific internals.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- Renderer access to mutable row arrays or internal pipeline maps.
- Per-mutation reconstruction of source-index maps.
- Classification results that are ignored by downstream row-model execution.
- Aggregation/group/tree truth stored only in rendered cells.
- Client and server row models exposing incompatible lifecycle behavior through shared APIs.
- Full pipeline refresh as an undocumented fallback.

## Execution workstreams

### Workstream 1 — Define row-model contracts

- Specify source identity, visual identity, stable source order, loading states, row count semantics, and mutation capabilities.
- Separate client mutation support from server cache/block operations.
- Define renderer-facing window and lookup APIs with version guarantees.
### Workstream 2 — Encapsulate the derived pipeline

- Make filter, sort, group/tree, aggregate, flatten, and paginate stages explicit and independently testable.
- Create typed mutation plans: value patch, reposition, membership change, aggregate recompute, hierarchy relocation, insert/remove, and full rebuild.
- Require every fallback to report why incremental execution was unsafe.
### Workstream 3 — Choose scalable index structures

- Benchmark arrays/maps against chunked or paged alternatives at 10k, 100k, and 1m rows.
- Maintain stable source order on nodes/data store rather than rebuilding it.
- Update only affected index ranges where arrays remain appropriate.
- Keep the first implementation simple unless benchmarks prove a different structure is required.
### Workstream 4 — Unify client/server renderer semantics

- Define placeholders, loading rows, unknown counts, refresh/purge, and stale request handling.
- Ensure the viewport consumes the same visual-row contract.
- Add race tests for server requests and model replacement.

## Forbidden end state

- Creating a universal row model full of optional methods and branches.
- Optimizing for one million rows by making the 10k-row path incomprehensible without evidence.
- Keeping public arrays mutable for convenience.
- Using renderer callbacks to repair row-model correctness.
- Calling a path incremental when it still performs hidden full rebuilds without diagnostics.

## Verification program

- Differential tests: random mutation sequences must produce the same result as a fresh full pipeline rebuild.
- Fuzz grouping, tree, aggregation, sort/filter dependencies, pagination, and insert/remove combinations.
- SSRM race tests for stale loads, overlapping requests, cache purge, and destroy.
- Benchmarks at 10k/100k/1m rows with single update, 100 updates, insert/remove, sort relocation, and group aggregate updates.
- Memory snapshots for row nodes, indexes, and server blocks.

## Evidence required in the PR

- Before/after architecture diagram showing ownership changes.
- List of deleted files, methods, paths, and compatibility aliases.
- Behavioral test output and benchmark output.
- Explanation of any target invariant not achieved; unresolved items block completion.

## Completion gate

- Renderer-facing row access is model-agnostic.
- Every mutation classification has a defined execution strategy.
- Differential fuzz tests pass.
- Source-order rebuilding is eliminated from hot mutations.
- Full rebuild fallbacks are measured and diagnostically visible.
- Client and server row models share one stable renderer contract.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.

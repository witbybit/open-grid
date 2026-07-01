# Plan 108: Behavioral Contract Tests and Fuzz Expansion

## Mission

Replace semantic confidence based on source-string guards with runtime proofs, model-based tests, deterministic failure injection, and lifecycle fuzzing.

## Status

- **Priority**: P1
- **Effort**: XL
- **Risk**: LOW to production, HIGH test-discovery value
- **Depends on**: Plans 103–105 and Plan 107 tooling
- **Category**: correctness, testing, fuzzing, lifecycle

## Keep source guards only for

- forbidden imports;
- direct state-write allowlists;
- direct RAF/timer policies;
- public export boundaries;
- deprecated API names;
- package dependency direction.

## Runtime contracts to prove

- one command produces one commit and one render request;
- state, versions, events, history, invalidation, and persistence remain coherent;
- aggregation and derived dependencies stay correct under random transactions;
- portal generations reject stale updates;
- host mount failure cleans up bindings;
- scroll phases cannot get stuck or produce runaway RAF loops;
- asynchronous server results cannot overwrite newer generations;
- edit lifecycle remains correct during slot recycling;
- apply/restore persisted state cannot partially mutate on rejection;
- renderer exceptions do not leak DOM, subscriptions, or host bindings.

## Fuzz programs

1. Flat row reference-model fuzzing under insert/update/remove/sort/filter.
2. Group/tree expansion and aggregation mutation fuzzing.
3. Selection/focus/edit operations while rows reorder.
4. Mount/unmount/remount and strict-mode-like lifecycle repetition.
5. SSRM out-of-order response, abort, retry, and stale-generation fuzzing.
6. Portal mount/update/unmount with slot reassignment.
7. Persistence round-trip and incompatible-schema rejection.

All randomized suites must accept explicit seeds and print minimal reproduction data.

## Completion gate

- Critical architecture guarantees are proved by runtime tests, not source strings.
- Fuzz suites run deterministically in CI with a bounded fast set and a scheduled extended set.
- Every discovered bug adds a minimized permanent regression case.
- Resource accounting returns to zero after lifecycle suites.

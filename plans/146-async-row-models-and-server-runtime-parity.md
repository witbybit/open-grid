# Plan 146: Make Async, Infinite, and Server-Oriented Row Models Feel First-Class

## Mission

Unify behavior across client, infinite, and server-oriented data flows so selection, integrity, invalidation, scrolling, and update semantics remain coherent regardless of where rows come from.

## Why now

A grid can look excellent in client mode and still lose serious users if async and server-backed scenarios feel second-class. Real products need viewport churn, loading, partial availability, streaming updates, and server ownership to compose cleanly with the same grid behaviors users expect in local mode.

## Focus areas

- selection/focus continuity across loading boundaries
- consistent invalidation and projection semantics across row models
- edit/write rejection semantics when rows are partial, stale, or remote-owned
- loading placeholders and viewport churn without stale DOM or state corruption
- server/infinite parity for integrity overlays and capability checks
- push/update readiness for the later SSRM work

## Architecture emphasis

- row-model differences must stay behind explicit runtime contracts
- visual correctness must not depend on client-only shortcuts
- async loading should integrate with the same commit/invalidation discipline as local writes
- server parity should reduce special cases, not multiply them

## Related backlog

- extends Plan 034 (`server-grid-polish-foundation`)
- should precede or absorb the hardest prerequisites for Plan 064 (`ssrm-server-push-filter-sort`)
- should compose with Plans 140, 142, and 143 rather than creating side channels

## Done criteria

- client, infinite, and server-style scenarios share clear behavioral guarantees for selection, editing, integrity, and invalidation
- adversarial tests cover async viewport churn, partial row availability, and stale update handling
- no row model relies on direct-write or renderer-owned escape hatches
- later server-push and richer server-side features can build on one explicit parity baseline

# Plan 109: Store Compatibility Hub and Boundary Demolition

## Mission

Remove `store.ts` as the conceptual and dependency centre of core. Make each subsystem import contracts from the domain that owns them, and reduce the store to composition—or eliminate it from public mental models entirely.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MEDIUM — broad import migration
- **Depends on**: Plans 103 and 106
- **Category**: dependency architecture, package boundaries, cleanup

## Target dependency direction

```text
api → domain command interfaces
features/controllers → owning domain contracts
renderer → renderer contracts + read-only domain views
react adapter → private host capability
composition root/store → assembles domains
```

No domain imports a broad compatibility barrel to discover unrelated types.

## Mandatory demolition

- Production imports from `store.ts` in features, models, rows, renderer, events, persistence, and utilities.
- Re-export chains that hide true ownership.
- Duplicate type declarations retained for compatibility.
- Public use of `GridStore` or reverse lookup helpers.
- Circular dependency workarounds caused by the compatibility hub.

## Execution workstreams

1. Generate an import graph and list every `store.ts` consumer.
2. Move types to owning modules without introducing generic “types” dumping grounds.
3. Convert directories incrementally with a shrinking allowlist.
4. Split composition responsibilities from public API facade responsibilities.
5. Add dependency-cycle and forbidden-import CI gates.
6. Delete compatibility exports when the final consumer is migrated.

## Completion gate

- `store.ts` is either a small composition root or removed.
- Internal implementation modules import owning domain contracts directly.
- The adapter does not expose reverse store lookup to applications.
- Dependency graph contains no new cycles and fewer broad hubs.

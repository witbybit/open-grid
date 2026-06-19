# Plan 116: Persistence Commit Restore and Schema Hardening

## Mission

Make persisted state fully versioned, validated, fault-reported, and restored only through the commit kernel.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — restore semantics affect startup correctness and user data
- **Depends on**: Plans 113–115
- **Category**: persistence, schema, restore, batching

## Problem

Persistence contracts are better than before Plan 112, but they still need final closure:

- schema version must become mandatory
- restore must be one explicit commit/commit batch, not an internal hydration special case
- malformed or unsupported payloads should report runtime faults, not soft console warnings
- restore should suppress intermediate autosave/history/render churn

## Target end state

Persisted state remains separate from runtime/public state:

```text
InternalGridState
GridStateSnapshot
PersistedGridState
```

Mandatory versioned persisted contract:

```ts
interface PersistedGridState {
	v: number;
	state: SerializedGridState;
}
```

Explicit restore API:

```ts
api.applyPersistedGridState(...)
```

## Non-negotiable invariants

- missing version is rejected
- unsupported version is rejected
- malformed payload is rejected
- restore validates the full blob before any commit
- restore produces one logical commit/render boundary
- restore does not directly hydrate live runtime state after startup

## Mandatory demolition

- optional persisted schema version
- `console.warn`-based persistence diagnostics
- direct runtime-state hydration during restore
- intermediate restore states visible to consumers

## Execution workstreams

### 1. Harden schema contract

Require:

- `v`
- `state`
- strict validation before application

### 2. Route restore through the kernel

Restore through one explicit commit or batched commit path with:

- intermediate history suppression
- intermediate autosave suppression
- batched rendering
- explicit result reporting

### 3. Strengthen runtime fault reporting

Reject invalid blobs through runtime-fault reporting rather than console warnings.

### 4. Normalize persisted/public/runtime separation

Ensure persistence structures do not alias or extend public/runtime state contracts.

## Verification

- unversioned persistence is rejected
- unsupported schema is rejected
- restore produces one logical commit/render boundary
- restore does not emit partial intermediate history/autosave
- persisted blobs cannot carry runtime-only fields

## Completion gate

- persisted state is mandatory-versioned and strictly validated
- restore enters through the commit kernel
- persistence contracts are fully separate from runtime and public snapshot contracts

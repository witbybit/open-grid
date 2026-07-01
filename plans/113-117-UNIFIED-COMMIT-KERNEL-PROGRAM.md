# Unified Commit Kernel Program — Plans 113–117

## Why this program exists

Plan 112 closed the alpha foundation cut for the current architecture, but the mutation path is still split across multiple owners.

The next program converges:

- runtime-state commits
- cell-data commits
- row-data commits
- history ownership
- persistence restore
- public snapshot/runtime closure
- the permanent private runtime composition root

## Program goal

After Plan 117, the normal mutation story must be:

```text
API intent
→ typed domain command
→ GridCommit
→ GridCommitKernel
→ state/data mutation
→ domain versions
→ declared invalidation
→ history
→ events
→ FrameCoordinator
```

There must be no parallel manual mutation pipelines for:

- editing
- fill
- batch updates
- row transactions
- row ordering
- persistence restore
- feature-owned history registration

## Execution order

1. **113 — Unified Grid Commit Kernel**
2. **114 — Typed Domain Mutation Executors**
3. **115 — Public Snapshot and Runtime State Closure**
4. **116 — Persistence Commit Restore and Schema Hardening**
5. **117 — Private Runtime Composition Root**

## Global invariants

- `GridCommitKernel` is the only owner of logical commits.
- Domain mutations are typed, inspectable, and testable.
- History is kernel-owned.
- Invalidation is fully declared.
- Public listeners never expose mutable runtime state.
- Persistence restore never hydrates live state directly.
- Adapters do not recover the concrete runtime root from public API.

## Completion gate

This program is complete only when:

> Every runtime-state, cell-data, row-data, batch, fill, transaction, ordering, undo, redo, and persistence mutation enters through one typed commit kernel, produces one unambiguous result, registers history through one owner, declares all invalidation explicitly, and exposes no mutable runtime state through the stable API.

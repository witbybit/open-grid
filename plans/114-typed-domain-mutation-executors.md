# Plan 114: Typed Domain Mutation Executors

## Mission

Introduce typed domain mutation executors so cell and row mutation semantics are inspectable, testable, and prepared before commit instead of being discovered ad hoc after mutation.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH — touches editing, fill, transactions, ordering, and history
- **Depends on**: Plan 113
- **Category**: data mutation, row model, validation, history

### Progress notes

- introduced `GridDomainMutation`, `GridCommitContext`, `PreparedDomainMutation`, `AppliedDomainMutation`, and executor/registry interfaces
- `GridCommitKernel` now accepts `domainMutations` and resolves typed executors before publication
- `row-order` is the first production executor-backed mutation and now supports inverse history through the kernel
- `row-transaction` now routes through a typed executor and `commitDetailed(...)`, preserving `RowNodeTransaction` results for engine/store callers
- `cell-value` and `batch-cell` now route through typed executors, and cell/batch inverse history is constructed from shared executor-layer helpers instead of controller-specific helper methods

## Problem

If `GridCommitKernel` absorbs all mutation semantics directly, it becomes another god object. The kernel should own commit protocol, not row-model implementation details.

## Target end state

Typed domain mutations exist:

```ts
type GridDomainMutation<TRowData> =
	| CellValueMutation<TRowData>
	| BatchCellMutation<TRowData>
	| RowTransactionMutation<TRowData>
	| RowOrderMutation<TRowData>;
```

And they are handled by typed executors:

```ts
interface GridDomainMutationExecutor<TRowData, TMutation extends GridDomainMutation<TRowData>> {
	validate(mutation: TMutation, context: GridCommitContext<TRowData>): GridMutationValidationResult;
	prepare(mutation: TMutation, context: GridCommitContext<TRowData>): PreparedDomainMutation<TRowData>;
	apply(prepared: PreparedDomainMutation<TRowData>, context: GridCommitContext<TRowData>): AppliedDomainMutation<TRowData>;
}
```

## Non-negotiable invariants

- domain mutations are typed, not arbitrary callbacks
- `prepare()` computes inverses, affected domains, invalidations, and events before commit
- batch semantics precisely describe committed and rejected subsets

## Mandatory demolition

- arbitrary per-feature mutation callbacks inside logical commit records
- duplicate row/cell mutation pipelines beside executors
- manual inverse-history construction in feature controllers

## Execution workstreams

### 1. Define mutation types

- `CellValueMutation`
- `BatchCellMutation`
- `RowTransactionMutation`
- `RowOrderMutation`

### 2. Build executor interfaces and context

Define:

- `GridCommitContext`
- `PreparedDomainMutation`
- `AppliedDomainMutation`
- `GridMutationValidationResult`
- `GridMutationRejection`

### 3. Implement cell-value executor

It must own:

- value setter and validation
- formulas and dependents
- row-impact classification
- precise invalidation/event derivation
- inverse mutation generation

### 4. Implement batch-cell executor

Support:

- `atomic: true`
- `atomic: false`
- committed subset reporting
- exact history for committed subset only

### 5. Implement row-transaction and row-order executors

They must own:

- row identity validation
- row-node creation/removal
- row-model structural impact classification
- inverse transaction/order generation

## Verification

- single-cell mutation commit and inverse history
- atomic batch rejection
- partial non-atomic batch reporting
- row transaction rollback before commit
- row-order undo/redo
- formula/sort/filter/group/aggregation consequences after a cell mutation

## Completion gate

- cell, batch, transaction, and order mutations all use typed executors
- the kernel no longer contains row-model implementation detail logic inline
- history and invalidation for domain mutations come from executor preparation/applied results

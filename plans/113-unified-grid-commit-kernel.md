# Plan 113: Unified Grid Commit Kernel

## Mission

Replace split logical-commit coordination with one authoritative `GridCommitKernel` that can commit runtime-state changes, row-data changes, or both.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH — touches the mutation center of the grid
- **Depends on**: Plan 112
- **Category**: architecture, commits, correctness, history, events

### Progress notes

- `SpreadsheetFillEngine` now routes logical fill writes through `batchCellValues(...)` instead of owning custom undo registration
- `DataMutationController` no longer registers history directly with `CommandHistory`; history now registers through `GridChangeApplier`
- executable history replay is covered in `GridChangeApplier.test.ts`
- async edit commit now registers undo history only after save success, so failed saves do not leak undo entries
- row-order publication now routes through `GridEngine.setRowOrder(...)` instead of `RowDragController` mutating the row model and dispatching events directly
- persisted state restore now batches replayed API operations and clears history on success so hydration does not create synthetic undo entries

## Problem

The grid foundation is stronger after Plan 112, but commit ownership is still not fully unified:

- state commits and data commits do not yet share one authoritative protocol
- some feature flows still coordinate side effects manually
- callers cannot yet treat every logical mutation as one `GridCommit`

## Target end state

```text
API intent
→ typed command
→ GridCommit
→ GridCommitKernel.commit(...)
→ state/data mutation
→ domain publication
→ invalidation
→ history
→ render scheduling
→ event delivery
```

## Non-negotiable invariants

- `GridCommitKernel` is the only owner of logical commits
- a commit may contain runtime state, domain data, or both
- `committed` always means the logical mutation happened
- `rejected` and `failed-before-commit` guarantee no mutation
- feature controllers do not manually coordinate history, invalidation, render requests, or event delivery after commit

## Mandatory demolition

- parallel logical commit paths beside the kernel
- feature-owned history registration
- feature-owned post-commit render/event/invalidation assembly
- ambiguous logical commit outcomes

## Execution workstreams

### 1. Define the new commit model

Introduce:

```ts
interface GridCommit<TRowData> {
	reason: GridCommitReason;
	state?: GridStateUpdater<TRowData>;
	domainMutations?: readonly GridDomainMutation<TRowData>[];
	domains?: readonly GridDomain[];
	invalidations?: readonly GridInvalidation[];
	events?: readonly GridCommitEvent<TRowData>[];
	history?: GridHistoryRecord<TRowData>;
	preconditions?: readonly GridCommitPrecondition<TRowData>[];
	requestRender?: boolean;
}
```

### 2. Evolve `GridChangeApplier` into `GridCommitKernel`

Target shape:

```ts
class GridCommitKernel<TRowData> {
	commit(change: GridCommit<TRowData>): GridCommitResult;
}
```

### 3. Normalize commit results

Use:

```ts
type GridCommitResult =
	| { status: 'committed'; changeId: number; faults: readonly RuntimeFault[]; rejectedMutations?: readonly GridMutationRejection[] }
	| { status: 'noop' }
	| { status: 'rejected'; reason: string; rejections?: readonly GridMutationRejection[] }
	| { status: 'failed-before-commit'; fault: RuntimeFault };
```

### 4. Make history kernel-owned

Only the kernel may register history after a successful forward commit.

### 5. Migrate first logical operations

Convert these flows first:

1. single-cell edit
2. async edit commit
3. batch cell updates
4. paste
5. fill

## Verification

- one committed result per logical operation
- rejected/failed-before-commit never mutate state or data
- committed-with-publication-fault remains `committed`
- one history record per logical operation
- feature controllers stop calling manual post-commit coordination paths

## Completion gate

- `GridCommitKernel` exists and is the only owner of logical commits
- first-class edit/batch/paste/fill flows enter through `GridCommit`
- feature controllers no longer manually assemble history/invalidation/render publication

// Grid Kernel — the command-driven write gateway (ARCHITECTURE.md §3).
export { GridKernel } from './GridKernel.js';
export type { GridDomainId } from './GridDomain.js';
export { GRID_DOMAIN_IDS } from './GridDomain.js';

export type { GridCommand, GridCommandMeta, GridCommandPayloads, GridCommandSource, GridCommandType } from './GridCommand.js';
export { defineCommand } from './GridCommand.js';

export type { GridCommandResult } from './GridCommandResult.js';
export { appliedResult, isApplied, noopResult, rejectedResult } from './GridCommandResult.js';

export type { GridCommandHandler, GridCommandHandlerResult, GridCommit, GridCommitDraft, GridKernelContext, GridUndoPatch } from './GridCommit.js';
export { handlerApplied, handlerNoop, handlerRejected } from './GridCommit.js';

export type { GridChangeSet } from './GridChangeSet.js';
export type { GridEffect, RenderInvalidation } from './GridEffect.js';
export { RENDER_INVALIDATION_NONE } from './GridEffect.js';
export type { GridEvent, GridEventDraft, GridEventListener, GridEventType } from './GridEvent.js';

export { GridInvariantError, invariant } from './GridInvariant.js';
export { GridVersionRegistry } from './GridVersion.js';
export type { GridVersionSnapshot } from './GridVersion.js';
export { GridUndoRedoEngine } from './GridUndoRedoEngine.js';
export type { GridUndoEntry } from './GridUndoRedoEngine.js';

export { dispatchTransaction } from './GridTransaction.js';
export type { GridTransactionResult } from './GridTransaction.js';

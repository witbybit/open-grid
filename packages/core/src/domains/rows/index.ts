// Rows domain — structural row engines (ARCHITECTURE.md §3 R3–R6).
export type { RowId, VisualRowId } from './RowId.js';
export { asRowId, asVisualRowId } from './RowId.js';
export type { RowModelType } from './RowModelType.js';
export type { RowNode } from './RowNode.js';
export { createRowNode } from './RowNode.js';

export type { RowModelCapabilities } from './RowModelCapabilities.js';
export { clientRowModelCapabilities, infiniteRowModelCapabilities, serverRowModelCapabilities } from './RowModelCapabilities.js';

export { RowModelError, UnsupportedRowModelOperationError } from './RowModelError.js';

export type { RowChangeSet, RowChangeSetParts } from './RowChangeSet.js';
export { emptyRowChangeSet, isFieldOnlyChange, rowChangeSet } from './RowChangeSet.js';

export type { PipelineRefreshKind, RowCommandResult, RowTransaction } from './RowCommand.js';

export { RowIdentityResolver } from './RowIdentity.js';
export type { GetRowId } from './RowIdentity.js';

export type { RowModelCommandHandlers, RowModelPlugin, RowModelQuery } from './RowModelPlugin.js';
export { unsupportedCommandHandlers } from './unsupportedCommands.js';

export { ClientRowModel } from './client/ClientRowModel.js';
export { ClientRowStore } from './client/ClientRowStore.js';
export { InfiniteRowModel } from './infinite/InfiniteRowModel.js';
export { ServerRowModel } from './server/ServerRowModel.js';

export { registerRowCommands } from './RowCommands.js';

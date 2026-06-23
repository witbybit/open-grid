// Columns domain — column defs, view state, layout, and commands (ARCHITECTURE.md §3 R11).
export type { ColumnId } from './ColumnId.js';
export { asColumnId } from './ColumnId.js';
export type { ColumnDef, ColumnPin } from './ColumnDef.js';
export { DEFAULT_COLUMN_MIN_WIDTH, DEFAULT_COLUMN_WIDTH } from './ColumnDef.js';
export type { ColumnState } from './ColumnState.js';
export type { ColumnChangeSet, ColumnChangeSetParts } from './ColumnChangeSet.js';
export { columnChangeSet, isEmptyColumnChange } from './ColumnChangeSet.js';
export { ColumnModel } from './ColumnModel.js';
export type { ColumnLane, ColumnLayout, ColumnLayoutEntry } from './ColumnLayout.js';
export { computeColumnLayout } from './ColumnLayout.js';
export { registerColumnCommands } from './ColumnCommands.js';

// Selection domain — row selection (ARCHITECTURE.md §3 R11).
export type { SelectionState } from './SelectionState.js';
export { EMPTY_SELECTION } from './SelectionState.js';
export type { SelectionChangeSet } from './SelectionChangeSet.js';
export { isEmptySelectionChange, SelectionModel } from './SelectionModel.js';
export { registerSelectionCommands } from './SelectionCommands.js';

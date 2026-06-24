// Cells domain — cell value semantics as their own domain (ARCHITECTURE.md §3 R8–R9).
export type { CellAddress, CellId } from './CellAddress.js';
export { addressId, cellId, createCellAddress } from './CellAddress.js';
export type { CellValueParts } from './CellValue.js';
export type { CellChangeSet, CellValueChange } from './CellChangeSet.js';
export type { ValueSetter, ValueSetterParams } from './ValueSetter.js';
export type { ValueParser, ValueParserParams } from './ValueParser.js';
export type { ValueFormatter, ValueFormatterParams, ValueGetter, ValueGetterParams } from './ValueGetter.js';
export { CellValueEngine } from './CellValueEngine.js';
export type { CellColumnAccess, CellDataPort, CellWriteContext, CellWriteOutcome } from './CellValueEngine.js';
export { appliedCellWriteDraft, registerCellCommands } from './CellCommands.js';
export type { CellCommandHost, CellCommandOptions } from './CellCommands.js';

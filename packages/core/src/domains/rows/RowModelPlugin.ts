import type { ColumnId } from '../columns/ColumnId.js';
import type { RowCommandResult, RowTransaction } from './RowCommand.js';
import type { RowId } from './RowId.js';
import type { RowModelCapabilities } from './RowModelCapabilities.js';
import type { RowModelType } from './RowModelType.js';
import type { RowNode } from './RowNode.js';

/**
 * Read-only access to the rows a model currently holds. For client this is the full dataset; for
 * infinite/server it is the loaded/page subset. Reads are cheap and side-effect free.
 */
export interface RowModelQuery<TRow> {
	/** Total logical row count. For infinite/server this may exceed the number of loaded rows. */
	getRowCount(): number;
	/** Number of rows actually held in memory right now. */
	getLoadedRowCount(): number;
	getRowByIndex(sourceIndex: number): RowNode<TRow> | null;
	getRowById(id: RowId): RowNode<TRow> | null;
	/** The rows currently held, in source order. */
	getLoadedRows(): readonly RowNode<TRow>[];
	hasRow(id: RowId): boolean;
}

/**
 * The structural write surface (ARCHITECTURE.md §3 R3). Every handler exists on every plugin —
 * we do not use optional methods, because presence checks are duck typing (R4 forbids it). A
 * plugin that does not support an operation throws {@link UnsupportedRowModelOperationError} from
 * the handler; the kernel executor gates on {@link RowModelCapabilities} and returns `rejected`
 * before the handler is ever reached.
 *
 * Handlers apply local storage changes and return a {@link RowCommandResult}. They publish
 * nothing, bump no versions, notify no cells.
 */
export interface RowModelCommandHandlers<TRow> {
	replaceRows(rows: readonly TRow[]): RowCommandResult<TRow>;
	updateRows(updater: (rows: TRow[]) => TRow[]): RowCommandResult<TRow>;
	applyTransaction(tx: RowTransaction<TRow>): RowCommandResult<TRow>;
	writeCellValue(rowId: RowId, columnId: ColumnId, field: string, value: unknown): RowCommandResult<TRow>;
}

/**
 * A row model plugin: a structural engine of one {@link RowModelType} (ARCHITECTURE.md §3 R3–R4).
 */
export interface RowModelPlugin<TRow> {
	readonly type: RowModelType;
	readonly capabilities: RowModelCapabilities;
	readonly query: RowModelQuery<TRow>;
	readonly commands: RowModelCommandHandlers<TRow>;
}

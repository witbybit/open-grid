/**
 * Commands are the only way to change grid state (ARCHITECTURE.md §3 R1). A command is an
 * immutable, serializable intent dispatched to the kernel. Domains register handlers for the
 * command types they own.
 *
 * The payload map is an open interface that each domain augments via declaration merging, e.g.
 *
 *   declare module '../kernel/GridCommand.js' {
 *     interface GridCommandPayloads {
 *       'cell.setValue': { rowId: RowId; columnId: ColumnId; value: unknown };
 *     }
 *   }
 *
 * This keeps `dispatch` fully typed for known command types while still allowing dynamic types.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GridCommandPayloads {}

export type GridCommandType = (keyof GridCommandPayloads & string) | (string & {});

export type GridCommandSource = 'api' | 'keyboard' | 'mouse' | 'paste' | 'fill' | 'menu' | 'panel' | 'export' | 'undo' | 'redo' | 'internal';

export interface GridCommandMeta {
	readonly source?: GridCommandSource;
	/** When false, the command is not recorded on the undo stack even if it produces an undo patch. */
	readonly undoable?: boolean;
	/** Set when the command is part of a multi-command transaction. */
	readonly transactionId?: string;
}

/** The payload type for a known command, or `unknown` for a dynamic one. */
type PayloadOf<K extends GridCommandType> = K extends keyof GridCommandPayloads ? GridCommandPayloads[K] : unknown;

export interface GridCommand<K extends GridCommandType = GridCommandType> {
	readonly type: K;
	readonly payload: PayloadOf<K>;
	readonly meta?: GridCommandMeta;
}

export function defineCommand<K extends GridCommandType>(type: K, payload: PayloadOf<K>, meta?: GridCommandMeta): GridCommand<K> {
	return meta ? { type, payload, meta } : { type, payload };
}

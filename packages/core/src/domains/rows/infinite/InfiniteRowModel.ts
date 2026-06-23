import { RowIdentityResolver } from '../RowIdentity.js';
import type { GetRowId } from '../RowIdentity.js';
import type { RowId } from '../RowId.js';
import { infiniteRowModelCapabilities } from '../RowModelCapabilities.js';
import type { RowModelCapabilities } from '../RowModelCapabilities.js';
import type { RowModelCommandHandlers, RowModelPlugin, RowModelQuery } from '../RowModelPlugin.js';
import type { RowModelType } from '../RowModelType.js';
import { createRowNode } from '../RowNode.js';
import type { RowNode } from '../RowNode.js';
import { unsupportedCommandHandlers } from '../unsupportedCommands.js';

/**
 * Infinite row model SHELL (ARCHITECTURE.md §3 R6, "Row Model Types"). Owns loaded blocks only —
 * not a full dataset. Block loading via a datasource, the block cache, and placeholder/loading
 * visual rows land in later phases; this shell provides the structural contract and honest
 * capabilities so the kernel can gate against it today.
 *
 * It supports no structural writes, no transactions, no row order, and no cell mutation — those
 * command handlers throw.
 */
export class InfiniteRowModel<TRow> implements RowModelPlugin<TRow> {
	readonly type: RowModelType = 'infinite';
	readonly capabilities: RowModelCapabilities = infiniteRowModelCapabilities;

	private loaded: RowNode<TRow>[] = [];
	private byId = new Map<RowId, RowNode<TRow>>();
	private totalRowCount = 0;
	private readonly identity: RowIdentityResolver<TRow>;

	constructor(getRowId?: GetRowId<TRow>) {
		this.identity = new RowIdentityResolver<TRow>(getRowId);
	}

	/**
	 * Internal block-load hook (NOT a kernel write — loading is runtime state, R11). The datasource
	 * integration in a later phase drives this; here it lets the shell hold loaded rows for query.
	 */
	setLoadedBlock(rows: readonly TRow[], startIndex: number, totalRowCount: number): void {
		this.totalRowCount = totalRowCount;
		for (let i = 0; i < rows.length; i++) {
			const sourceIndex = startIndex + i;
			const id = this.identity.idOf(rows[i]!, sourceIndex);
			const node = createRowNode(id, sourceIndex, rows[i]!);
			this.loaded[sourceIndex] = node;
			this.byId.set(id, node);
		}
	}

	readonly query: RowModelQuery<TRow> = {
		getRowCount: () => this.totalRowCount,
		getLoadedRowCount: () => this.byId.size,
		getRowByIndex: (index) => this.loaded[index] ?? null,
		getRowById: (id) => this.byId.get(id) ?? null,
		getLoadedRows: () => this.loaded.filter((n): n is RowNode<TRow> => n != null),
		hasRow: (id) => this.byId.has(id),
	};

	readonly commands: RowModelCommandHandlers<TRow> = unsupportedCommandHandlers<TRow>('infinite');
}

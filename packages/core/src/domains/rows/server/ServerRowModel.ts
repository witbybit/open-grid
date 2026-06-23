import { RowIdentityResolver } from '../RowIdentity.js';
import type { GetRowId } from '../RowIdentity.js';
import type { RowId } from '../RowId.js';
import { serverRowModelCapabilities } from '../RowModelCapabilities.js';
import type { RowModelCapabilities } from '../RowModelCapabilities.js';
import type { RowModelCommandHandlers, RowModelPlugin, RowModelQuery } from '../RowModelPlugin.js';
import type { RowModelType } from '../RowModelType.js';
import { createRowNode } from '../RowNode.js';
import type { RowNode } from '../RowNode.js';
import { unsupportedCommandHandlers } from '../unsupportedCommands.js';

/**
 * Server row model SHELL (ARCHITECTURE.md §3 R6, "Row Model Types"). Owns the current page/window
 * only. Datasource-backed page navigation, page size, and page refresh land in later phases; this
 * shell provides the structural contract and honest capabilities.
 *
 * It supports no structural writes, no transactions, no row order, and no cell mutation — those
 * command handlers throw.
 */
export class ServerRowModel<TRow> implements RowModelPlugin<TRow> {
	readonly type: RowModelType = 'server';
	readonly capabilities: RowModelCapabilities = serverRowModelCapabilities;

	private page: RowNode<TRow>[] = [];
	private byId = new Map<RowId, RowNode<TRow>>();
	private totalRowCount = 0;
	private readonly identity: RowIdentityResolver<TRow>;

	constructor(getRowId?: GetRowId<TRow>) {
		this.identity = new RowIdentityResolver<TRow>(getRowId);
	}

	/**
	 * Internal page-load hook (NOT a kernel write — page loading is runtime state, R11). `pageStart`
	 * is the source index of the first row on the page.
	 */
	setPage(rows: readonly TRow[], pageStart: number, totalRowCount: number): void {
		this.totalRowCount = totalRowCount;
		this.page = rows.map((data, i) => {
			const sourceIndex = pageStart + i;
			return createRowNode(this.identity.idOf(data, sourceIndex), sourceIndex, data);
		});
		this.byId = new Map(this.page.map((node) => [node.id, node]));
	}

	readonly query: RowModelQuery<TRow> = {
		getRowCount: () => this.totalRowCount,
		getLoadedRowCount: () => this.page.length,
		getRowByIndex: (index) => this.page.find((n) => n.sourceIndex === index) ?? null,
		getRowById: (id) => this.byId.get(id) ?? null,
		getLoadedRows: () => this.page,
		hasRow: (id) => this.byId.has(id),
	};

	readonly commands: RowModelCommandHandlers<TRow> = unsupportedCommandHandlers<TRow>('server');
}

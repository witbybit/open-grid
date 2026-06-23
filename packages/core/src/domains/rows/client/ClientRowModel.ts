import type { ColumnId } from '../../columns/ColumnId.js';
import { isFieldOnlyChange } from '../RowChangeSet.js';
import type { RowChangeSet } from '../RowChangeSet.js';
import type { PipelineRefreshKind, RowCommandResult, RowTransaction } from '../RowCommand.js';
import type { GetRowId } from '../RowIdentity.js';
import type { RowId } from '../RowId.js';
import { clientRowModelCapabilities } from '../RowModelCapabilities.js';
import type { RowModelCapabilities } from '../RowModelCapabilities.js';
import type { RowModelCommandHandlers, RowModelPlugin, RowModelQuery } from '../RowModelPlugin.js';
import type { RowModelType } from '../RowModelType.js';
import type { RowNode } from '../RowNode.js';
import { ClientRowStore } from './ClientRowStore.js';

/**
 * The client row model: a structural engine over a full in-memory dataset (ARCHITECTURE.md §3
 * R3–R4). Fully mutable. It reports the pipeline refresh a write requires but performs none of it,
 * and it publishes nothing.
 *
 * Field-only writes report `requiredPipelineRefresh: 'none'`: the SHARED impact classifier in the
 * pipeline domain upgrades that to sort/filter/group from `changedFieldsByRow`. The row model does
 * not classify — that is the pipeline's job (R7).
 */
export class ClientRowModel<TRow> implements RowModelPlugin<TRow> {
	readonly type: RowModelType = 'client';
	readonly capabilities: RowModelCapabilities = clientRowModelCapabilities;

	private readonly store: ClientRowStore<TRow>;

	constructor(getRowId?: GetRowId<TRow>) {
		this.store = new ClientRowStore<TRow>(getRowId);
	}

	readonly query: RowModelQuery<TRow> = {
		getRowCount: () => this.store.getRowCount(),
		getLoadedRowCount: () => this.store.getRowCount(),
		getRowByIndex: (index) => this.store.getRowByIndex(index),
		getRowById: (id) => this.store.getRowById(id),
		getLoadedRows: () => this.store.getRows(),
		hasRow: (id) => this.store.hasRow(id),
	};

	readonly commands: RowModelCommandHandlers<TRow> = {
		replaceRows: (rows) => applied(this.store.replace(rows), 'full'),
		updateRows: (updater) => {
			const changes = this.store.update(updater);
			return applied(changes, refreshFor(changes));
		},
		applyTransaction: (tx: RowTransaction<TRow>) => {
			const changes = this.store.applyTransaction(tx);
			return applied(changes, refreshFor(changes));
		},
		writeCellValue: (rowId: RowId, columnId: ColumnId, field: string, value: unknown) => {
			const changes = this.store.writeCell(rowId, columnId, field, value);
			return applied(changes, 'none');
		},
	};

	/** Direct read access for tests / internal selectors. */
	getRows(): readonly RowNode<TRow>[] {
		return this.store.getRows();
	}
}

function refreshFor(changes: RowChangeSet): PipelineRefreshKind {
	// Structural changes always force a full pipeline rebuild; field-only writes defer to the
	// shared classifier, which inspects changedFieldsByRow.
	return isFieldOnlyChange(changes) ? 'none' : 'full';
}

function applied<TRow>(rowChanges: RowChangeSet<TRow>, requiredPipelineRefresh: PipelineRefreshKind): RowCommandResult<TRow> {
	return { status: 'applied', rowChanges, requiredPipelineRefresh };
}

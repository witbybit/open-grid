import { asColumnId } from '../../columns/ColumnId.js';
import type { ColumnId } from '../../columns/ColumnId.js';
import { rowChangeSet } from '../RowChangeSet.js';
import type { RowChangeSet } from '../RowChangeSet.js';
import type { RowTransaction } from '../RowCommand.js';
import { RowIdentityResolver } from '../RowIdentity.js';
import type { GetRowId } from '../RowIdentity.js';
import type { RowId } from '../RowId.js';
import { createRowNode } from '../RowNode.js';
import type { RowNode } from '../RowNode.js';

/**
 * Full-dataset, in-memory storage for the client row model (ARCHITECTURE.md §3 R3). Owns the
 * source-order node array and the id→node index. Every write returns a {@link RowChangeSet}
 * describing exactly what changed; the store publishes nothing and knows nothing about the
 * pipeline, events, versions, or rendering.
 */
export class ClientRowStore<TRow> {
	private nodes: RowNode<TRow>[] = [];
	private byId = new Map<RowId, RowNode<TRow>>();
	private readonly identity: RowIdentityResolver<TRow>;

	constructor(getRowId?: GetRowId<TRow>) {
		this.identity = new RowIdentityResolver<TRow>(getRowId);
	}

	// ── Query ────────────────────────────────────────────────────────────────────

	getRowCount(): number {
		return this.nodes.length;
	}

	getRowByIndex(sourceIndex: number): RowNode<TRow> | null {
		return this.nodes[sourceIndex] ?? null;
	}

	getRowById(id: RowId): RowNode<TRow> | null {
		return this.byId.get(id) ?? null;
	}

	getRows(): readonly RowNode<TRow>[] {
		return this.nodes;
	}

	hasRow(id: RowId): boolean {
		return this.byId.has(id);
	}

	// ── Writes ────────────────────────────────────────────────────────────────────

	/** Replace the entire dataset. Returns added=new nodes, removed=old nodes (full reset). */
	replace(rows: readonly TRow[]): RowChangeSet<TRow> {
		const ids = this.identity.resolveAll(rows, 'replaceRows');
		const removed = this.nodes;
		const next = rows.map((data, index) => createRowNode(ids[index]!, index, data));
		this.commit(next);
		return rowChangeSet({ added: next, removed });
	}

	/** Run an updater over a mutable copy of the current row data, then reconcile by id. */
	update(updater: (rows: TRow[]) => TRow[]): RowChangeSet<TRow> {
		const draft = this.nodes.map((node) => node.data);
		const nextData = updater(draft);
		return this.reconcile(nextData, 'updateRows');
	}

	applyTransaction(tx: RowTransaction<TRow>): RowChangeSet<TRow> {
		const removeIds = new Set<RowId>();
		for (const r of tx.remove ?? []) {
			removeIds.add(this.idOfRemoveTarget(r));
		}

		const updateById = new Map<RowId, TRow>();
		for (const data of tx.update ?? []) {
			updateById.set(this.identity.idOf(data, 0), data);
		}

		// Build next source array: existing rows (minus removed, with updates applied) then adds.
		const kept: TRow[] = [];
		for (const node of this.nodes) {
			if (removeIds.has(node.id)) continue;
			kept.push(updateById.get(node.id) ?? node.data);
		}

		const adds = tx.add ?? [];
		const insertAt = tx.addIndex ?? kept.length;
		const nextData = [...kept.slice(0, insertAt), ...adds, ...kept.slice(insertAt)];

		return this.reconcile(nextData, 'applyTransaction');
	}

	/** Write a single cell value by field path, immutably. Returns a field-only change set. */
	writeCell(rowId: RowId, columnId: ColumnId, field: string, value: unknown): RowChangeSet<TRow> {
		const node = this.byId.get(rowId);
		if (!node) {
			throw new Error(`ClientRowStore.writeCell: no row with id "${rowId}".`);
		}
		const nextData = setByPath(node.data, field, value);
		const nextNode = createRowNode(rowId, node.sourceIndex, nextData);
		this.nodes = this.nodes.map((n) => (n.id === rowId ? nextNode : n));
		this.byId.set(rowId, nextNode);

		const changedFieldsByRow = new Map<RowId, ReadonlySet<ColumnId>>([[rowId, new Set([columnId])]]);
		return rowChangeSet({ updated: [nextNode], changedFieldsByRow });
	}

	// ── Internals ───────────────────────────────────────────────────────────────────

	/** Diff `nextData` against current storage by id, commit, and produce the change set. */
	private reconcile(nextData: readonly TRow[], context: string): RowChangeSet<TRow> {
		const ids = this.identity.resolveAll(nextData, context);
		const nextNodes = nextData.map((data, index) => createRowNode(ids[index]!, index, data));
		const nextIds = new Set(ids);

		const added: RowNode<TRow>[] = [];
		const updated: RowNode<TRow>[] = [];
		const changedFieldsByRow = new Map<RowId, ReadonlySet<ColumnId>>();

		for (const node of nextNodes) {
			const prev = this.byId.get(node.id);
			if (!prev) {
				added.push(node);
				continue;
			}
			if (prev.data !== node.data) {
				const changed = changedFields(prev.data, node.data);
				if (changed.size > 0) {
					updated.push(node);
					changedFieldsByRow.set(node.id, changed);
				}
			}
		}

		const removed: RowNode<TRow>[] = [];
		for (const node of this.nodes) {
			if (!nextIds.has(node.id)) removed.push(node);
		}

		this.commit(nextNodes);
		return rowChangeSet({ added, removed, updated, changedFieldsByRow });
	}

	private commit(nextNodes: RowNode<TRow>[]): void {
		this.nodes = nextNodes;
		this.byId = new Map(nextNodes.map((node) => [node.id, node]));
	}

	private idOfRemoveTarget(target: TRow | RowId): RowId {
		// A RowId is a branded string; a row object is anything else.
		if (typeof target === 'string') return target as RowId;
		return this.identity.idOf(target as TRow, 0);
	}
}

/** Top-level fields whose value differs between two row objects, as ColumnIds. */
function changedFields<TRow>(prev: TRow, next: TRow): Set<ColumnId> {
	const out = new Set<ColumnId>();
	const keys = new Set<string>([...objectKeys(prev), ...objectKeys(next)]);
	for (const key of keys) {
		if ((prev as Record<string, unknown>)[key] !== (next as Record<string, unknown>)[key]) {
			out.add(asColumnId(key));
		}
	}
	return out;
}

function objectKeys(value: unknown): string[] {
	return value && typeof value === 'object' ? Object.keys(value) : [];
}

/** Immutably set a (possibly dotted) field path on a row object, returning a new object. */
function setByPath<TRow>(row: TRow, field: string, value: unknown): TRow {
	if (!field.includes('.')) {
		return { ...(row as Record<string, unknown>), [field]: value } as TRow;
	}
	const [head, ...rest] = field.split('.');
	const child = (row as Record<string, unknown>)[head!];
	return {
		...(row as Record<string, unknown>),
		[head!]: setByPath(child ?? {}, rest.join('.'), value),
	} as TRow;
}

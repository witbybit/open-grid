import type { ColumnId } from '../columns/ColumnId.js';
import type { RowChangeSet } from '../rows/RowChangeSet.js';
import type { RowId } from '../rows/RowId.js';
import type { RowNode } from '../rows/RowNode.js';
import type { CellAddress, CellId } from './CellAddress.js';
import { cellId } from './CellAddress.js';
import type { CellChangeSet, CellValueChange } from './CellChangeSet.js';
import type { ValueSetter } from './ValueSetter.js';
import type { ValueFormatter, ValueGetter } from './ValueGetter.js';

/**
 * The minimal structural surface the cell value engine needs from a row model (ARCHITECTURE.md §3
 * R8). The engine owns value-application semantics; the row model owns rows. Defining the port here
 * keeps the rows domain free of any cells import — the wiring adapts a row model to this port.
 */
export interface CellDataPort<TRow> {
	getRow(rowId: RowId): RowNode<TRow> | null;
	/** Persist a row's next data wholesale; returns the structural change set (field diff). */
	persist(rowId: RowId, nextData: TRow): RowChangeSet<TRow>;
}

export interface CellWriteContext<TRow> {
	/** When present, the column's value setter decides how the value is applied. */
	readonly valueSetter?: ValueSetter<TRow>;
}

/**
 * Optional per-column read semantics the engine resolves for value reads (ARCHITECTURE.md §3 R8).
 * The columns domain supplies these; the engine stays decoupled from column storage.
 */
export interface CellColumnAccess<TRow> {
	getValueGetter(columnId: ColumnId): ValueGetter<TRow> | undefined;
	getValueFormatter(columnId: ColumnId): ValueFormatter<TRow> | undefined;
}

export type CellWriteOutcome =
	| {
			readonly status: 'applied';
			readonly changeSet: CellChangeSet;
			readonly rowChanges: RowChangeSet;
			readonly oldValue: unknown;
			readonly newValue: unknown;
	  }
	| { readonly status: 'noop'; readonly reason: string }
	| { readonly status: 'aborted'; readonly reason: string }
	| { readonly status: 'rejected'; readonly reason: string };

/**
 * Owns cell value semantics (ARCHITECTURE.md §3 R8). Reads raw/display values and applies writes,
 * optionally through a synchronous, abortable value setter (R9). It performs no events, versions,
 * notifications, or rendering — it returns a {@link CellChangeSet} and lets the kernel publish.
 */
export class CellValueEngine<TRow> {
	constructor(
		private readonly port: CellDataPort<TRow>,
		private readonly columns?: CellColumnAccess<TRow>
	) {}

	/** Raw value: the column's value getter if it has one, else the field read. */
	getRawValue(address: CellAddress): unknown {
		const node = this.port.getRow(address.rowId);
		if (!node) return undefined;
		const getter = this.columns?.getValueGetter(address.columnId);
		if (getter) return getter({ row: node.data, field: address.field, columnId: address.columnId });
		return getByPath(node.data, address.field);
	}

	/** Display value: the column's value formatter applied to the raw value, else the raw value. */
	getDisplayValue(address: CellAddress): unknown {
		const node = this.port.getRow(address.rowId);
		if (!node) return undefined;
		const raw = this.getRawValue(address);
		const formatter = this.columns?.getValueFormatter(address.columnId);
		return formatter ? formatter({ value: raw, row: node.data, field: address.field, columnId: address.columnId }) : raw;
	}

	applyCellValue(address: CellAddress, value: unknown, ctx: CellWriteContext<TRow> = {}): CellWriteOutcome {
		const node = this.port.getRow(address.rowId);
		if (!node) {
			return { status: 'rejected', reason: `no row with id "${address.rowId}"` };
		}

		const oldValue = getByPath(node.data, address.field);
		let nextData: TRow;

		if (ctx.valueSetter) {
			const clone = shallowClone(node.data);
			let aborted = false;
			const didSet = ctx.valueSetter({
				row: clone,
				value,
				oldValue,
				columnId: address.columnId,
				field: address.field,
				abort: () => {
					aborted = true;
				},
			});
			if (aborted) {
				return { status: 'aborted', reason: 'write aborted by value setter' };
			}
			if (!didSet) {
				return { status: 'noop', reason: 'value setter declined the write' };
			}
			nextData = clone;
		} else {
			if (Object.is(value, oldValue)) {
				return { status: 'noop', reason: 'value unchanged' };
			}
			nextData = setByPath(node.data, address.field, value);
		}

		const rowChanges = this.port.persist(address.rowId, nextData);
		if (rowChanges.changedFieldsByRow.size === 0) {
			return { status: 'noop', reason: 'value unchanged' };
		}

		const newValue = getByPath(nextData, address.field);
		const changeSet = buildCellChangeSet(address, oldValue, newValue, rowChanges.changedFieldsByRow);
		return { status: 'applied', changeSet, rowChanges, oldValue, newValue };
	}
}

function buildCellChangeSet(
	address: CellAddress,
	oldValue: unknown,
	newValue: unknown,
	changedFieldsByRow: ReadonlyMap<RowId, ReadonlySet<ColumnId>>
): CellChangeSet {
	const changedValuesByCell = new Map<CellId, CellValueChange>([[cellId(address.rowId, address.columnId), { oldValue, newValue }]]);
	return { domain: 'cells', changedValuesByCell, changedFieldsByRow };
}

function shallowClone<TRow>(row: TRow): TRow {
	return (row && typeof row === 'object' ? { ...(row as Record<string, unknown>) } : row) as TRow;
}

function getByPath(row: unknown, field: string): unknown {
	if (!field.includes('.')) {
		return (row as Record<string, unknown> | null | undefined)?.[field];
	}
	let cursor: unknown = row;
	for (const key of field.split('.')) {
		if (cursor == null || typeof cursor !== 'object') return undefined;
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return cursor;
}

function setByPath<TRow>(row: TRow, field: string, value: unknown): TRow {
	if (!field.includes('.')) {
		return { ...(row as Record<string, unknown>), [field]: value } as TRow;
	}
	const [head, ...rest] = field.split('.');
	const child = (row as Record<string, unknown>)[head!];
	return {
		...(row as Record<string, unknown>),
		[head!]: setByPath((child ?? {}) as Record<string, unknown>, rest.join('.'), value),
	} as TRow;
}

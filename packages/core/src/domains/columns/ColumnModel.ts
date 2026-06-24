import type { ValueSetter } from '../cells/ValueSetter.js';
import type { ValueFormatter, ValueGetter } from '../cells/ValueGetter.js';
import { columnChangeSet } from './ColumnChangeSet.js';
import type { ColumnChangeSet } from './ColumnChangeSet.js';
import { DEFAULT_COLUMN_MIN_WIDTH, DEFAULT_COLUMN_WIDTH } from './ColumnDef.js';
import type { ColumnDef, ColumnPin } from './ColumnDef.js';
import { asColumnId } from './ColumnId.js';
import type { ColumnId } from './ColumnId.js';
import type { ColumnState } from './ColumnState.js';

interface ResolvedColumn<TRow> {
	readonly id: ColumnId;
	readonly def: ColumnDef<TRow>;
	readonly field: string;
	width: number;
	hidden: boolean;
	pinned: ColumnPin;
}

/**
 * Owns the column definitions and their mutable view state (order / width / visibility / pinning).
 * Structural engine (ARCHITECTURE.md §3 R11): each command applies local state and returns a
 * {@link ColumnChangeSet}; it publishes nothing. Persistent state is exposed via {@link getState}.
 */
export class ColumnModel<TRow = unknown> {
	private readonly columns = new Map<ColumnId, ResolvedColumn<TRow>>();
	private order: ColumnId[] = [];

	constructor(defs: readonly ColumnDef<TRow>[]) {
		for (const def of defs) {
			const id = asColumnId(def.id);
			this.columns.set(id, {
				id,
				def,
				field: def.field ?? def.id,
				width: clampWidth(def, def.width ?? DEFAULT_COLUMN_WIDTH),
				hidden: def.hidden ?? false,
				pinned: def.pinned ?? null,
			});
			this.order.push(id);
		}
	}

	// ── Query ────────────────────────────────────────────────────────────────────

	getColumnIds(): readonly ColumnId[] {
		return this.order;
	}

	getField(columnId: ColumnId): string | null {
		return this.columns.get(columnId)?.field ?? null;
	}

	/** Display header text for a column (falls back to its field). */
	getHeader(columnId: ColumnId): string {
		const col = this.columns.get(columnId);
		if (!col) return String(columnId);
		return col.def.header ?? col.field;
	}

	isSortable(columnId: ColumnId): boolean {
		return this.columns.get(columnId)?.def.sortable ?? true;
	}

	getWidth(columnId: ColumnId): number | null {
		return this.columns.get(columnId)?.width ?? null;
	}

	isHidden(columnId: ColumnId): boolean {
		return this.columns.get(columnId)?.hidden ?? false;
	}

	getPinned(columnId: ColumnId): ColumnPin {
		return this.columns.get(columnId)?.pinned ?? null;
	}

	/** Visible columns in order. */
	getVisibleColumnIds(): ColumnId[] {
		return this.order.filter((id) => !this.columns.get(id)!.hidden);
	}

	getValueSetter(columnId: ColumnId): ValueSetter<TRow> | undefined {
		return this.columns.get(columnId)?.def.valueSetter;
	}

	getValueGetter(columnId: ColumnId): ValueGetter<TRow> | undefined {
		return this.columns.get(columnId)?.def.valueGetter;
	}

	getValueFormatter(columnId: ColumnId): ValueFormatter<TRow> | undefined {
		return this.columns.get(columnId)?.def.valueFormatter;
	}

	getState(): ColumnState[] {
		return this.order.map((id, orderIndex) => {
			const col = this.columns.get(id)!;
			return { columnId: id, width: col.width, hidden: col.hidden, pinned: col.pinned, orderIndex };
		});
	}

	// ── Commands ───────────────────────────────────────────────────────────────────

	resize(columnId: ColumnId, width: number): ColumnChangeSet {
		const col = this.columns.get(columnId);
		if (!col) return columnChangeSet({});
		const next = clampWidth(col.def, width);
		if (next === col.width) return columnChangeSet({});
		col.width = next;
		return columnChangeSet({ resized: [columnId] });
	}

	move(columnId: ColumnId, toIndex: number): ColumnChangeSet {
		const from = this.order.indexOf(columnId);
		if (from === -1) return columnChangeSet({});
		const clamped = Math.max(0, Math.min(toIndex, this.order.length - 1));
		if (clamped === from) return columnChangeSet({});
		this.order.splice(from, 1);
		this.order.splice(clamped, 0, columnId);
		return columnChangeSet({ moved: [columnId] });
	}

	setVisible(columnId: ColumnId, visible: boolean): ColumnChangeSet {
		const col = this.columns.get(columnId);
		if (!col || col.hidden === !visible) return columnChangeSet({});
		col.hidden = !visible;
		return columnChangeSet({ visibilityChanged: [columnId] });
	}

	setPinned(columnId: ColumnId, pinned: ColumnPin): ColumnChangeSet {
		const col = this.columns.get(columnId);
		if (!col || col.pinned === pinned) return columnChangeSet({});
		col.pinned = pinned;
		return columnChangeSet({ pinnedChanged: [columnId] });
	}

	/** Apply a full persisted state. Returns the union of everything that changed. */
	setState(state: readonly ColumnState[]): ColumnChangeSet {
		const resized: ColumnId[] = [];
		const visibilityChanged: ColumnId[] = [];
		const pinnedChanged: ColumnId[] = [];
		let orderChanged = false;

		const ordered = [...state].sort((a, b) => a.orderIndex - b.orderIndex);
		const nextOrder: ColumnId[] = [];

		for (const entry of ordered) {
			const col = this.columns.get(entry.columnId);
			if (!col) continue;
			nextOrder.push(entry.columnId);
			const width = clampWidth(col.def, entry.width);
			if (width !== col.width) {
				col.width = width;
				resized.push(entry.columnId);
			}
			if (entry.hidden !== col.hidden) {
				col.hidden = entry.hidden;
				visibilityChanged.push(entry.columnId);
			}
			if (entry.pinned !== col.pinned) {
				col.pinned = entry.pinned;
				pinnedChanged.push(entry.columnId);
			}
		}

		// Append any columns missing from the incoming state, preserving their relative order.
		for (const id of this.order) {
			if (!nextOrder.includes(id)) nextOrder.push(id);
		}
		if (nextOrder.length === this.order.length && nextOrder.some((id, i) => id !== this.order[i])) {
			orderChanged = true;
		}
		this.order = nextOrder;

		return columnChangeSet({
			resized,
			visibilityChanged,
			pinnedChanged,
			moved: orderChanged ? nextOrder : [],
		});
	}
}

function clampWidth<TRow>(def: ColumnDef<TRow>, width: number): number {
	const min = def.minWidth ?? DEFAULT_COLUMN_MIN_WIDTH;
	const max = def.maxWidth ?? Number.POSITIVE_INFINITY;
	return Math.max(min, Math.min(width, max));
}

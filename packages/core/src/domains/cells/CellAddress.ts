import type { ColumnId } from '../columns/ColumnId.js';
import type { RowId } from '../rows/RowId.js';

/**
 * Branded cell identity (ARCHITECTURE.md §3 R5). A `CellId` uniquely identifies one data cell
 * (row × column). Distinct from `RowId`/`ColumnId` at the type level.
 */
export type CellId = string & { readonly __brand: 'CellId' };

// A control character (US, 0x1F) that cannot appear in a normal id, so row/column ids cannot collide.
const CELL_ID_SEPARATOR = String.fromCharCode(0x1f);

export function cellId(rowId: RowId, columnId: ColumnId): CellId {
	return `${rowId}${CELL_ID_SEPARATOR}${columnId}` as CellId;
}

/**
 * The full coordinate of a data cell. `field` is the data path the column reads/writes (it may be
 * dotted, e.g. `address.city`); `columnId` is the column's identity. The two are separate because
 * several columns can read overlapping fields and a column's field can differ from its id.
 */
export interface CellAddress {
	readonly rowId: RowId;
	readonly columnId: ColumnId;
	readonly field: string;
}

export function createCellAddress(rowId: RowId, columnId: ColumnId, field: string): CellAddress {
	return { rowId, columnId, field };
}

export function addressId(address: CellAddress): CellId {
	return cellId(address.rowId, address.columnId);
}

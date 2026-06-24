import { describe, expect, it } from 'vitest';
import { asColumnId } from '../columns/ColumnId.js';
import { ClientRowModel } from '../rows/client/ClientRowModel.js';
import { createCellAddress } from './CellAddress.js';
import { CellValueEngine } from './CellValueEngine.js';
import type { CellColumnAccess, CellDataPort } from './CellValueEngine.js';
import { asRowId } from '../rows/RowId.js';

interface Product {
	id: string;
	price: number;
	qty: number;
}

const seed: Product[] = [{ id: 'p1', price: 10, qty: 3 }];

function makeEngine(columns: Partial<CellColumnAccess<Product>>) {
	const model = new ClientRowModel<Product>((r) => r.id);
	model.commands.replaceRows(seed);
	const port: CellDataPort<Product> = {
		getRow: (id) => model.query.getRowById(id),
		persist: (id, data) => model.writeRowDataStructural(id, data),
	};
	const access: CellColumnAccess<Product> = {
		getValueGetter: columns.getValueGetter ?? (() => undefined),
		getValueFormatter: columns.getValueFormatter ?? (() => undefined),
	};
	return new CellValueEngine<Product>(port, access);
}

const priceAddr = createCellAddress(asRowId('p1'), asColumnId('price'), 'price');
const totalAddr = createCellAddress(asRowId('p1'), asColumnId('total'), 'total');

describe('CellValueEngine value getters & formatters (ARCHITECTURE.md §3 R8)', () => {
	it('a value getter computes the raw value, overriding the field read', () => {
		const engine = makeEngine({
			getValueGetter: (columnId) =>
				String(columnId) === 'total' ? ({ row }) => row.price * row.qty : undefined,
		});
		expect(engine.getRawValue(totalAddr)).toBe(30); // 10 * 3, no `total` field exists
		expect(engine.getRawValue(priceAddr)).toBe(10); // plain field read
	});

	it('a value formatter shapes the display value without changing the raw value', () => {
		const engine = makeEngine({
			getValueFormatter: (columnId) =>
				String(columnId) === 'price' ? ({ value }) => `$${Number(value).toFixed(2)}` : undefined,
		});
		expect(engine.getRawValue(priceAddr)).toBe(10);
		expect(engine.getDisplayValue(priceAddr)).toBe('$10.00');
	});

	it('formatter receives the getter-computed value', () => {
		const engine = makeEngine({
			getValueGetter: () => ({ row }) => row.price * row.qty,
			getValueFormatter: () => ({ value }) => `${value} units$`,
		});
		expect(engine.getDisplayValue(totalAddr)).toBe('30 units$');
	});
});

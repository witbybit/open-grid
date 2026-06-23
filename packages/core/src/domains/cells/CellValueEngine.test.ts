import { describe, expect, it } from 'vitest';
import { GridKernel } from '../../kernel/GridKernel.js';
import type { GridEvent } from '../../kernel/GridEvent.js';
import { asColumnId } from '../columns/ColumnId.js';
import { ClientRowModel } from '../rows/client/ClientRowModel.js';
import { serverRowModelCapabilities } from '../rows/RowModelCapabilities.js';
import { asRowId } from '../rows/RowId.js';
import { createCellAddress } from './CellAddress.js';
import { registerCellCommands } from './CellCommands.js';
import { CellValueEngine } from './CellValueEngine.js';
import type { CellDataPort } from './CellValueEngine.js';
import type { ValueSetter } from './ValueSetter.js';

interface Person {
	id: string;
	name: string;
	age: number;
	address: { city: string };
}

const seed: Person[] = [
	{ id: 'a', name: 'Ann', age: 30, address: { city: 'Oslo' } },
	{ id: 'b', name: 'Bob', age: 25, address: { city: 'Rome' } },
];

function makeEngine() {
	const model = new ClientRowModel<Person>((r) => r.id);
	model.commands.replaceRows(seed);
	const port: CellDataPort<Person> = {
		getRow: (id) => model.query.getRowById(id),
		persist: (id, data) => model.writeRowDataStructural(id, data),
	};
	return { model, engine: new CellValueEngine<Person>(port) };
}

const nameAddr = createCellAddress(asRowId('a'), asColumnId('name'), 'name');
const cityAddr = createCellAddress(asRowId('a'), asColumnId('city'), 'address.city');

describe('CellValueEngine — value semantics (ARCHITECTURE.md §3 R8)', () => {
	it('reads raw and display values, including nested field paths', () => {
		const { engine } = makeEngine();
		expect(engine.getRawValue(nameAddr)).toBe('Ann');
		expect(engine.getDisplayValue(cityAddr)).toBe('Oslo');
	});

	it('applying an unchanged value is a noop', () => {
		const { engine } = makeEngine();
		expect(engine.applyCellValue(nameAddr, 'Ann').status).toBe('noop');
	});

	it('applying a changed value is applied and produces a cell change set', () => {
		const { engine, model } = makeEngine();
		const outcome = engine.applyCellValue(nameAddr, 'Anna');
		expect(outcome.status).toBe('applied');
		if (outcome.status !== 'applied') return;
		expect(outcome.oldValue).toBe('Ann');
		expect(outcome.newValue).toBe('Anna');
		expect(outcome.changeSet.changedFieldsByRow.get(asRowId('a'))?.has(asColumnId('name'))).toBe(true);
		expect(model.query.getRowById(asRowId('a'))?.data.name).toBe('Anna');
	});

	it('writes nested field paths immutably', () => {
		const { engine, model } = makeEngine();
		const before = model.query.getRowById(asRowId('a'))?.data.address;
		const outcome = engine.applyCellValue(cityAddr, 'Bergen');
		expect(outcome.status).toBe('applied');
		expect(model.query.getRowById(asRowId('a'))?.data.address.city).toBe('Bergen');
		expect(before?.city).toBe('Oslo'); // original nested object not mutated
	});
});

describe('CellValueEngine — value setters (ARCHITECTURE.md §3 R9)', () => {
	it('a value setter that calls abort() cancels the write — nothing is persisted', () => {
		const { engine, model } = makeEngine();
		const setter: ValueSetter<Person> = ({ abort }) => {
			abort();
			return true;
		};
		const outcome = engine.applyCellValue(nameAddr, 'Zed', { valueSetter: setter });
		expect(outcome.status).toBe('aborted');
		expect(model.query.getRowById(asRowId('a'))?.data.name).toBe('Ann');
	});

	it('a value setter that returns false declines the write (noop)', () => {
		const { engine, model } = makeEngine();
		const setter: ValueSetter<Person> = () => false;
		const outcome = engine.applyCellValue(nameAddr, 'Zed', { valueSetter: setter });
		expect(outcome.status).toBe('noop');
		expect(model.query.getRowById(asRowId('a'))?.data.name).toBe('Ann');
	});

	it('a value setter can transform the write (e.g. uppercase) before persisting', () => {
		const { engine, model } = makeEngine();
		const setter: ValueSetter<Person> = ({ row, value }) => {
			row.name = String(value).toUpperCase();
			return true;
		};
		const outcome = engine.applyCellValue(nameAddr, 'anna', { valueSetter: setter });
		expect(outcome.status).toBe('applied');
		expect(model.query.getRowById(asRowId('a'))?.data.name).toBe('ANNA');
	});

	it('value setter type is synchronous — a Promise return is a compile error (R9)', () => {
		// @ts-expect-error a ValueSetter must return boolean, never Promise<boolean>
		const asyncSetter: ValueSetter<Person> = async () => true;
		expect(typeof asyncSetter).toBe('function');
	});
});

describe('registerCellCommands — kernel integration (ARCHITECTURE.md §3 R1, R8)', () => {
	it('cell.setValue on a client model applies, emits cells.changed, and is undoable', () => {
		const kernel = new GridKernel();
		const { model, engine } = makeEngine();
		registerCellCommands(kernel, model, engine);
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));

		const result = kernel.dispatch({ type: 'cell.setValue', payload: { address: nameAddr, value: 'Anna' } });
		expect(result.status).toBe('applied');
		expect(events.some((e) => e.type === 'cells.changed')).toBe(true);
		expect(model.query.getRowById(asRowId('a'))?.data.name).toBe('Anna');

		expect(kernel.canUndo()).toBe(true);
		const undo = kernel.undo();
		expect(undo.status).toBe('applied');
		expect(model.query.getRowById(asRowId('a'))?.data.name).toBe('Ann');
	});

	it('cell.setValue on a server model is rejected (no cellMutation), never silent', () => {
		const kernel = new GridKernel();
		const { engine } = makeEngine(); // engine unused — capability gate rejects first
		registerCellCommands(kernel, { type: 'server', capabilities: serverRowModelCapabilities }, engine);

		const result = kernel.dispatch({ type: 'cell.setValue', payload: { address: nameAddr, value: 'X' } });
		expect(result.status).toBe('rejected');
		if (result.status === 'rejected') expect(result.reason).toMatch(/cellMutation.*unsupported/);
	});
});

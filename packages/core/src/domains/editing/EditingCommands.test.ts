import { describe, expect, it } from 'vitest';
import { GridKernel } from '../../kernel/GridKernel.js';
import type { GridEvent } from '../../kernel/GridEvent.js';
import { asColumnId } from '../columns/ColumnId.js';
import { createCellAddress } from '../cells/CellAddress.js';
import { CellValueEngine } from '../cells/CellValueEngine.js';
import type { CellDataPort } from '../cells/CellValueEngine.js';
import { ClientRowModel } from '../rows/client/ClientRowModel.js';
import { serverRowModelCapabilities } from '../rows/RowModelCapabilities.js';
import { asRowId } from '../rows/RowId.js';
import { EditModel } from './EditModel.js';
import { registerEditingCommands } from './EditingCommands.js';

interface Person {
	id: string;
	name: string;
}

const seed: Person[] = [{ id: 'a', name: 'Ann' }];
const nameAddr = createCellAddress(asRowId('a'), asColumnId('name'), 'name');

function setup() {
	const kernel = new GridKernel();
	const model = new ClientRowModel<Person>((r) => r.id);
	model.commands.replaceRows(seed);
	const port: CellDataPort<Person> = {
		getRow: (id) => model.query.getRowById(id),
		persist: (id, data) => model.writeRowDataStructural(id, data),
	};
	const engine = new CellValueEngine<Person>(port);
	const editModel = new EditModel();
	registerEditingCommands(kernel, model, editModel, engine);
	return { kernel, rowModel: model, editModel, engine };
}

describe('Editing transaction (ARCHITECTURE.md §3 R10)', () => {
	it('start opens a session seeded with the cell value and emits editing.started', () => {
		const { kernel, editModel } = setup();
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));

		const result = kernel.dispatch({ type: 'editing.start', payload: { address: nameAddr } });
		expect(result.status).toBe('applied');
		expect(editModel.isEditing()).toBe(true);
		expect(editModel.getActive()?.initialValue).toBe('Ann');
		expect(editModel.getActive()?.draftValue).toBe('Ann');
		expect(events.some((e) => e.type === 'editing.started')).toBe(true);
	});

	it('updateDraft then commit writes the draft via the cell engine and closes the session', () => {
		const { kernel, rowModel, editModel } = setup();
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));

		kernel.dispatch({ type: 'editing.start', payload: { address: nameAddr } });
		kernel.dispatch({ type: 'editing.updateDraft', payload: { value: 'Anna' } });
		const commit = kernel.dispatch({ type: 'editing.commit', payload: {} });

		expect(commit.status).toBe('applied');
		expect(rowModel.query.getRowById(asRowId('a'))?.data.name).toBe('Anna');
		expect(editModel.isEditing()).toBe(false);
		expect(events.some((e) => e.type === 'editing.committed')).toBe(true);
		expect(events.some((e) => e.type === 'cells.changed')).toBe(true);
	});

	it('cancel closes the session without writing', () => {
		const { kernel, rowModel, editModel } = setup();
		kernel.dispatch({ type: 'editing.start', payload: { address: nameAddr } });
		kernel.dispatch({ type: 'editing.updateDraft', payload: { value: 'Zed' } });
		const cancel = kernel.dispatch({ type: 'editing.cancel', payload: {} });

		expect(cancel.status).toBe('applied');
		expect(editModel.isEditing()).toBe(false);
		expect(rowModel.query.getRowById(asRowId('a'))?.data.name).toBe('Ann');
	});

	it('updateDraft with no active session is rejected; commit with none is a noop', () => {
		const { kernel } = setup();
		expect(kernel.dispatch({ type: 'editing.updateDraft', payload: { value: 'x' } }).status).toBe('rejected');
		expect(kernel.dispatch({ type: 'editing.commit', payload: {} }).status).toBe('noop');
	});

	it('commit on a model without cellMutation is rejected (server)', () => {
		const kernel = new GridKernel();
		const { engine } = setup(); // engine only needed structurally; capability gate rejects first
		const editModel = new EditModel();
		registerEditingCommands(kernel, { type: 'server', capabilities: serverRowModelCapabilities }, editModel, engine);

		kernel.dispatch({ type: 'editing.start', payload: { address: nameAddr } });
		const commit = kernel.dispatch({ type: 'editing.commit', payload: {} });
		expect(commit.status).toBe('rejected');
		if (commit.status === 'rejected') expect(commit.reason).toMatch(/cellMutation/);
	});
});

import { describe, expect, it } from 'vitest';
import { GridKernel } from '../../kernel/GridKernel.js';
import type { GridEvent } from '../../kernel/GridEvent.js';
import { ClientRowModel } from './client/ClientRowModel.js';
import { ServerRowModel } from './server/ServerRowModel.js';
import { InfiniteRowModel } from './infinite/InfiniteRowModel.js';
import { registerRowCommands } from './RowCommands.js';

interface Person {
	id: string;
	name: string;
}

const getRowId = (row: Person) => row.id;
const seed: Person[] = [
	{ id: 'a', name: 'Ann' },
	{ id: 'b', name: 'Bob' },
];

describe('registerRowCommands — kernel ⇆ row model (ARCHITECTURE.md §3 R1, R3, R4)', () => {
	it('rows.replace on a client model applies, emits rows.replaced, bumps rows + pipeline', () => {
		const kernel = new GridKernel();
		const model = new ClientRowModel<Person>(getRowId);
		registerRowCommands(kernel, model);
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));

		const result = kernel.dispatch({ type: 'rows.replace', payload: { rows: seed } });

		expect(result.status).toBe('applied');
		expect(kernel.getVersion('rows')).toBe(1);
		expect(kernel.getVersion('pipeline')).toBe(1);
		expect(events.map((e) => e.type)).toContain('rows.replaced');
		expect(model.query.getRowCount()).toBe(2);
	});

	it('a no-op update (identical data) returns noop, not applied, and bumps nothing', () => {
		const kernel = new GridKernel();
		const model = new ClientRowModel<Person>(getRowId);
		registerRowCommands(kernel, model);
		kernel.dispatch({ type: 'rows.replace', payload: { rows: seed } });

		const result = kernel.dispatch({ type: 'rows.update', payload: { updater: (rows) => rows } });

		expect(result.status).toBe('noop');
		expect(kernel.getVersion('rows')).toBe(1); // unchanged from the replace
	});

	it('rows.applyTransaction on a SERVER model is rejected (capability), never silent', () => {
		const kernel = new GridKernel();
		registerRowCommands(kernel, new ServerRowModel<Person>(getRowId));
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));

		const result = kernel.dispatch({ type: 'rows.applyTransaction', payload: { transaction: { add: [] } } });

		expect(result.status).toBe('rejected');
		if (result.status === 'rejected') expect(result.reason).toMatch(/transactions.*unsupported/);
		expect(events.some((e) => e.type === 'grid.commandRejected')).toBe(true);
	});

	it('rows.replace on an INFINITE model is rejected (capability)', () => {
		const kernel = new GridKernel();
		registerRowCommands(kernel, new InfiniteRowModel<Person>(getRowId));
		const result = kernel.dispatch({ type: 'rows.replace', payload: { rows: seed } });
		expect(result.status).toBe('rejected');
	});

	it('a field-only update bumps rows but not pipeline (deferred to the Phase 5 classifier)', () => {
		const kernel = new GridKernel();
		const model = new ClientRowModel<Person>(getRowId);
		registerRowCommands(kernel, model);
		kernel.dispatch({ type: 'rows.replace', payload: { rows: seed } });

		const result = kernel.dispatch({
			type: 'rows.update',
			payload: { updater: (rows) => (rows as Person[]).map((r) => (r.id === 'a' ? { ...r, name: 'Anna' } : r)) },
		});

		expect(result.status).toBe('applied');
		expect(kernel.getVersion('rows')).toBe(2);
		expect(kernel.getVersion('pipeline')).toBe(1); // not bumped by a field-only write
	});
});

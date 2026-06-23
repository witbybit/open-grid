import { describe, expect, it } from 'vitest';
import { GridKernel } from '../../kernel/GridKernel.js';
import type { GridEvent } from '../../kernel/GridEvent.js';
import { asColumnId } from './ColumnId.js';
import { ColumnModel } from './ColumnModel.js';
import { registerColumnCommands } from './ColumnCommands.js';

const A = asColumnId('a');

function setup() {
	const kernel = new GridKernel();
	const model = new ColumnModel([
		{ id: 'a', width: 100 },
		{ id: 'b', width: 120 },
	]);
	registerColumnCommands(kernel, model);
	return { kernel, model };
}

describe('registerColumnCommands — kernel integration (ARCHITECTURE.md §3 R1, R11)', () => {
	it('columns.resize applies, bumps columns, emits columns.changed', () => {
		const { kernel, model } = setup();
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));

		const result = kernel.dispatch({ type: 'columns.resize', payload: { columnId: A, width: 200 } });

		expect(result.status).toBe('applied');
		expect(kernel.getVersion('columns')).toBe(1);
		expect(events.some((e) => e.type === 'columns.changed')).toBe(true);
		expect(model.getWidth(A)).toBe(200);
	});

	it('resizing to the same width is a noop, not applied', () => {
		const { kernel } = setup();
		const result = kernel.dispatch({ type: 'columns.resize', payload: { columnId: A, width: 100 } });
		expect(result.status).toBe('noop');
		expect(kernel.getVersion('columns')).toBe(0);
	});

	it('columns.move and columns.setPinned route through the kernel', () => {
		const { kernel, model } = setup();
		expect(kernel.dispatch({ type: 'columns.move', payload: { columnId: A, toIndex: 1 } }).status).toBe('applied');
		expect(kernel.dispatch({ type: 'columns.setPinned', payload: { columnId: A, pinned: 'left' } }).status).toBe('applied');
		expect(model.getPinned(A)).toBe('left');
	});
});

import { describe, expect, it } from 'vitest';
import { GridKernel } from '../../kernel/GridKernel.js';
import type { GridEvent } from '../../kernel/GridEvent.js';
import { asRowId } from '../rows/RowId.js';
import { SelectionModel } from './SelectionModel.js';
import { registerSelectionCommands } from './SelectionCommands.js';

const A = asRowId('a');
const B = asRowId('b');
const C = asRowId('c');

function setup() {
	const kernel = new GridKernel();
	const model = new SelectionModel();
	registerSelectionCommands(kernel, model);
	return { kernel, model };
}

describe('SelectionModel — row selection (ARCHITECTURE.md §3 R11)', () => {
	it('selectRows replace then add accumulates and tracks the anchor', () => {
		const model = new SelectionModel();
		model.selectRows([A, B]);
		expect([...model.getState().selectedRowIds]).toEqual([A, B]);
		model.selectRows([C], 'add');
		expect([...model.getState().selectedRowIds]).toEqual([A, B, C]);
		expect(model.getState().anchorRowId).toBe(C);
	});

	it('toggleRow flips membership', () => {
		const model = new SelectionModel();
		model.toggleRow(A);
		expect(model.isSelected(A)).toBe(true);
		model.toggleRow(A);
		expect(model.isSelected(A)).toBe(false);
	});

	it('replace produces correct added/removed against the previous selection', () => {
		const model = new SelectionModel();
		model.selectRows([A, B]);
		const change = model.selectRows([B, C]);
		expect(change.addedRows).toEqual([C]);
		expect(change.removedRows).toEqual([A]);
	});
});

describe('registerSelectionCommands — kernel integration (R1)', () => {
	it('selection.selectRows applies, bumps selection, emits selection.changed', () => {
		const { kernel, model } = setup();
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));

		const result = kernel.dispatch({ type: 'selection.selectRows', payload: { rowIds: [A, B] } });
		expect(result.status).toBe('applied');
		expect(kernel.getVersion('selection')).toBe(1);
		expect(events.some((e) => e.type === 'selection.changed')).toBe(true);
		expect(model.getState().selectedRowIds.size).toBe(2);
	});

	it('selecting the same set again is a noop', () => {
		const { kernel } = setup();
		kernel.dispatch({ type: 'selection.selectRows', payload: { rowIds: [A] } });
		const again = kernel.dispatch({ type: 'selection.selectRows', payload: { rowIds: [A] } });
		expect(again.status).toBe('noop');
	});

	it('selection.clear empties the selection', () => {
		const { kernel, model } = setup();
		kernel.dispatch({ type: 'selection.selectRows', payload: { rowIds: [A, B] } });
		expect(kernel.dispatch({ type: 'selection.clear', payload: {} }).status).toBe('applied');
		expect(model.getState().selectedRowIds.size).toBe(0);
	});
});

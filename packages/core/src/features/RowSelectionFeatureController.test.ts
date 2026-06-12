import { describe, it, expect, vi } from 'vitest';
import { RowSelectionFeatureController } from './RowSelectionFeatureController.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

interface TestRow {
	id: string;
	name: string;
}

function makeStore(): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 150 },
		],
		getRowId: (row) => row.id,
	});
}

function makeController(store: GridStore<TestRow>): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: [
			{ id: '1', name: 'Alpha' },
			{ id: '2', name: 'Beta' },
			{ id: '3', name: 'Gamma' },
		],
		columns: store.getState().columns,
	});
}

function getFeatureContext(store: GridStore<TestRow>): GridFeatureContext<TestRow> {
	const engine = (store as any).engine;
	return {
		columns: engine.columns,
		getState: () => engine.stateManager.getState(),
		applyChange: (change) => engine.changeApplier.apply(change),
	};
}

describe('RowSelectionFeatureController', () => {
	describe('replace gesture', () => {
		it('replaces selectedRowIds', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new RowSelectionFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1', '2'] });
			expect(store.getState().selectedRowIds).toEqual(['1', '2']);

			ctrl.dispose();
			store.destroy();
		});

		it('emits rowSelectionChanged with correct payload', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new RowSelectionFeatureController(getFeatureContext(store), () => store.getRowModel());
			const listener = vi.fn();
			store.addEventListener(GridEventName.rowSelectionChanged, listener);

			feature.applyRowSelectionGesture({ kind: 'replace', rowIds: ['2'], source: 'pointer' });

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					payload: expect.objectContaining({
						selectedRowIds: ['2'],
						addedRowIds: ['2'],
						removedRowIds: [],
						source: 'pointer',
					}),
				})
			);

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('select gesture', () => {
		it('adds rowIds to selection', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new RowSelectionFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1'] });
			feature.applyRowSelectionGesture({ kind: 'select', rowIds: ['3'] });

			expect(store.getState().selectedRowIds).toContain('1');
			expect(store.getState().selectedRowIds).toContain('3');

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('deselect gesture', () => {
		it('removes rowIds from selection', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new RowSelectionFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1', '2'] });
			feature.applyRowSelectionGesture({ kind: 'deselect', rowIds: ['1'] });

			expect(store.getState().selectedRowIds).not.toContain('1');
			expect(store.getState().selectedRowIds).toContain('2');

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('toggle gesture', () => {
		it('toggles a single row on and off', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new RowSelectionFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.applyRowSelectionGesture({ kind: 'toggle', rowIds: ['2'] });
			expect(store.getState().selectedRowIds).toContain('2');

			feature.applyRowSelectionGesture({ kind: 'toggle', rowIds: ['2'] });
			expect(store.getState().selectedRowIds).not.toContain('2');

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('selectAll gesture', () => {
		it('selects all data rows', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new RowSelectionFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.applyRowSelectionGesture({ kind: 'selectAll' });

			expect(store.getState().selectedRowIds).toContain('1');
			expect(store.getState().selectedRowIds).toContain('2');
			expect(store.getState().selectedRowIds).toContain('3');

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('clear gesture', () => {
		it('clears selection', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new RowSelectionFeatureController(getFeatureContext(store), () => store.getRowModel());

			feature.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1', '2'] });
			feature.applyRowSelectionGesture({ kind: 'clear' });

			expect(store.getState().selectedRowIds).toHaveLength(0);

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('no-op case', () => {
		it('returns null and no event when nothing changes', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new RowSelectionFeatureController(getFeatureContext(store), () => store.getRowModel());
			const listener = vi.fn();
			store.addEventListener(GridEventName.rowSelectionChanged, listener);

			// Select '1' then select '1' again (no change)
			feature.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1'] });
			listener.mockClear();

			const result = feature.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1'] });

			expect(result).toBeNull();
			expect(listener).not.toHaveBeenCalled();

			ctrl.dispose();
			store.destroy();
		});
	});
});

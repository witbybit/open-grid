// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';

/**
 * DOM-level regression coverage for the delegated click/mousedown listeners on the viewport
 * container (SelectionPaintManager.onViewportClick/onViewportMouseDown) — added alongside Plan 154
 * Task 10's centralization of what used to be per-cell/per-checkbox/per-drag-handle listeners in
 * rowCellBinder.ts. No DOM-dispatch-level tests existed for these interactions before this pass, so
 * these lock in the pre-existing behavior the centralization must preserve.
 */

interface Row {
	id: string;
	name: string;
}

function mountGrid(opts: { checkboxSelection?: boolean; canDrag?: boolean; rowSelectionMode?: 'single' | 'multiple' } = {}) {
	const columns: ColumnDef<Row>[] = [];
	if (opts.checkboxSelection) {
		columns.push({ field: 'checkbox', header: '', width: 40, checkboxSelection: true } as any);
	}
	columns.push({
		field: 'name',
		header: 'Name',
		width: 150,
		...(opts.canDrag ? { canDrag: () => true } : {}),
	} as any);

	const store = new GridStore<Row>({
		columns,
		defaultRowHeight: 40,
		defaultColWidth: 150,
		getRowId: (row) => row.id,
		rowSelection: { mode: opts.rowSelectionMode ?? 'multiple' },
	} as any);
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: Array.from({ length: 10 }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}` })),
		columns: store.getState().columns,
	});
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 300,
		bottom: 400,
		width: 300,
		height: 400,
		toJSON: () => ({}),
	} as DOMRect);
	document.body.appendChild(container);

	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	return { store, controller, container, renderer };
}

function cleanup(grid: ReturnType<typeof mountGrid>): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
}

function click(el: Element, opts: MouseEventInit = {}): void {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...opts }));
}

function mousedown(el: Element, opts: MouseEventInit = {}): void {
	el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...opts }));
}

function cellFor(container: HTMLElement, rowId: string, field: string): HTMLElement {
	const el = container.querySelector(`.og-cell[data-row-id="${rowId}"][data-col-field="${field}"]`);
	if (!el) throw new Error(`cell not found for ${rowId}/${field}`);
	return el as HTMLElement;
}

describe('SelectionPaintManager — delegated viewport click/mousedown', () => {
	it('clicking a data cell replaces the selection with that row (requires a checkbox column present)', () => {
		// onDataCellClick's own gate — pre-existing behavior, not something Task 10 changes: cell-click
		// row selection is only active when the grid has a checkboxSelection column defined somewhere.
		const grid = mountGrid({ checkboxSelection: true });
		click(cellFor(grid.container, 'row-1', 'name'));
		expect(grid.store.getState().selectedRowIds).toEqual(['row-1']);
		cleanup(grid);
	});

	it('ctrl-clicking a second data cell toggles it into the selection (multi mode)', () => {
		const grid = mountGrid({ checkboxSelection: true });
		click(cellFor(grid.container, 'row-1', 'name'));
		click(cellFor(grid.container, 'row-2', 'name'), { ctrlKey: true });
		expect(new Set(grid.store.getState().selectedRowIds)).toEqual(new Set(['row-1', 'row-2']));
		cleanup(grid);
	});

	it('clicking the checkbox toggles that row on, independent of cell-click replace semantics', () => {
		const grid = mountGrid({ checkboxSelection: true });
		const checkbox = cellFor(grid.container, 'row-3', 'checkbox').querySelector('input.og-row-checkbox') as HTMLInputElement;
		click(checkbox);
		expect(grid.store.getState().selectedRowIds).toContain('row-3');
		cleanup(grid);
	});

	it('shift-clicking a second checkbox selects the range between anchor and target', () => {
		const grid = mountGrid({ checkboxSelection: true });
		const cb1 = cellFor(grid.container, 'row-1', 'checkbox').querySelector('input.og-row-checkbox') as HTMLInputElement;
		click(cb1);

		const cb4 = cellFor(grid.container, 'row-4', 'checkbox').querySelector('input.og-row-checkbox') as HTMLInputElement;
		click(cb4, { shiftKey: true });

		expect(new Set(grid.store.getState().selectedRowIds)).toEqual(new Set(['row-1', 'row-2', 'row-3', 'row-4']));
		cleanup(grid);
	});

	it('clicking the checkbox does not also trigger cell-click replace semantics on the same cell', () => {
		const grid = mountGrid({ checkboxSelection: true });
		click(cellFor(grid.container, 'row-1', 'name'));
		const cb3 = cellFor(grid.container, 'row-3', 'checkbox').querySelector('input.og-row-checkbox') as HTMLInputElement;
		click(cb3);
		// If checkbox clicks fell through to cell-click handling too, this would replace-select to
		// just ['row-3'] instead of toggling it into the existing selection.
		expect(new Set(grid.store.getState().selectedRowIds)).toEqual(new Set(['row-1', 'row-3']));
		cleanup(grid);
	});

	it('mousedown on the drag handle stops propagation and does not disturb selection', () => {
		const grid = mountGrid({ canDrag: true, checkboxSelection: true });
		click(cellFor(grid.container, 'row-1', 'name'));
		const handle = grid.container.querySelector('.og-drag-handle') as HTMLElement;
		expect(handle).not.toBeNull();

		const bubbledToDocument = vi.fn();
		document.addEventListener('mousedown', bubbledToDocument);
		mousedown(handle);
		document.removeEventListener('mousedown', bubbledToDocument);

		expect(bubbledToDocument).not.toHaveBeenCalled();
		expect(grid.store.getState().selectedRowIds).toEqual(['row-1']);
		cleanup(grid);
	});

	it('clicking inside an ignored target (e.g. an input) does not trigger row selection', () => {
		const grid = mountGrid();
		const cell = cellFor(grid.container, 'row-1', 'name');
		const input = document.createElement('input');
		cell.appendChild(input);
		click(input);
		expect(grid.store.getState().selectedRowIds).toEqual([]);
		cleanup(grid);
	});
});

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { asColumnId, asRowId, createCellAddress, createGrid } from '@open-grid/core/next';
import type { GridApi } from '@open-grid/core/next';
import { GridApiProvider, useGridApi } from './GridContext.js';
import { KernelGrid } from './KernelGrid.js';

afterEach(cleanup);

interface Person {
	id: string;
	name: string;
	age: number;
}

const columns = [
	{ id: 'name', field: 'name', width: 120 },
	{ id: 'age', field: 'age', width: 80 },
];

function makeApi(count: number): GridApi<Person> {
	const api = createGrid<Person>({ columns, getRowId: (r) => r.id, rowHeight: 40 });
	api.rows.replace(Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `N${i}`, age: i })));
	return api;
}

describe('KernelGrid — paints the render plan (ARCHITECTURE.md §3 R12–R13)', () => {
	it('renders only the windowed rows (virtualization), not all of them', () => {
		render(<KernelGrid api={makeApi(100)} height={200} width={400} />);
		const rows = screen.getAllByTestId('grid-row');
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.length).toBeLessThan(20); // ~6 rows for a 200px viewport at 40px each
		expect(rows[0]!.getAttribute('data-row-id')).toBe('r0');
		expect(screen.getByText('N0')).toBeTruthy();
	});

	it('re-renders when an external cell write commits through the kernel', () => {
		const api = makeApi(8);
		render(<KernelGrid api={api} height={400} width={400} />);
		expect(screen.getByText('N0')).toBeTruthy();
		act(() => {
			api.cells.setValue(createCellAddress(asRowId('r0'), asColumnId('name'), 'name'), 'CHANGED');
		});
		expect(screen.getByText('CHANGED')).toBeTruthy();
	});

	it('updates the visible window on scroll', () => {
		render(<KernelGrid api={makeApi(100)} height={200} width={400} />);
		const grid = screen.getByTestId('kernel-grid');
		const before = screen.getAllByTestId('grid-row').map((r) => r.getAttribute('data-row-id'));
		act(() => {
			grid.scrollTop = 2000;
			fireEvent.scroll(grid);
		});
		const after = screen.getAllByTestId('grid-row').map((r) => r.getAttribute('data-row-id'));
		expect(after).not.toEqual(before);
		expect(after[0]).toBe('r50'); // 2000 / 40
	});
});

describe('KernelGrid — headers & custom renderers (133a)', () => {
	it('renders a header cell per visible column with its header text', () => {
		render(<KernelGrid api={makeApi(5)} height={200} width={400} />);
		const headers = screen.getAllByTestId('grid-header-cell');
		expect(headers.map((h) => h.getAttribute('data-col-id'))).toEqual(['name', 'age']);
		expect(headers[0]!.textContent).toContain('name');
	});

	it('clicking a sortable header cycles sort asc → desc, reordering painted rows', () => {
		render(<KernelGrid api={makeApi(5)} height={400} width={400} />);
		const header = () => screen.getAllByTestId('grid-header-cell').find((h) => h.getAttribute('data-col-id') === 'age')!;
		const rowIds = () => screen.getAllByTestId('grid-row').map((r) => r.getAttribute('data-row-id'));

		// rows have age = index, so ascending == r0..r4 (already), descending reverses
		act(() => fireEvent.click(header())); // asc
		expect(header().getAttribute('data-sort')).toBe('asc');
		act(() => fireEvent.click(header())); // desc
		expect(header().getAttribute('data-sort')).toBe('desc');
		expect(rowIds()[0]).toBe('r4');
	});

	it('uses a custom cell renderer for its column', () => {
		render(
			<KernelGrid
				api={makeApi(3)}
				height={400}
				width={400}
				cellRenderers={{ name: ({ value }) => <strong data-testid="custom">{`<<${String(value)}>>`}</strong> }}
			/>,
		);
		const custom = screen.getAllByTestId('custom');
		expect(custom[0]!.textContent).toBe('<<N0>>');
	});
});

describe('GridContext (ARCHITECTURE.md "React adapter exposes GridApi")', () => {
	function TypeProbe() {
		return <span data-testid="type">{useGridApi<Person>().rowModel.getType()}</span>;
	}

	it('useGridApi returns the API inside a provider', () => {
		render(
			<GridApiProvider api={makeApi(1)}>
				<TypeProbe />
			</GridApiProvider>,
		);
		expect(screen.getByTestId('type').textContent).toBe('client');
	});

	it('useGridApi throws outside a provider', () => {
		expect(() => render(<TypeProbe />)).toThrow(/within a GridApiProvider/);
	});

	it('rowModelType is fixed at mount — changing the prop does not recreate the API', () => {
		const base = { columns, getRowId: (r: Person) => r.id } as const;
		const { rerender } = render(
			<KernelGrid options={{ ...base, rowModelType: 'client' }} height={100} width={100}>
				<TypeProbe />
			</KernelGrid>,
		);
		expect(screen.getByTestId('type').textContent).toBe('client');
		rerender(
			<KernelGrid options={{ ...base, rowModelType: 'server' }} height={100} width={100}>
				<TypeProbe />
			</KernelGrid>,
		);
		expect(screen.getByTestId('type').textContent).toBe('client'); // unchanged
	});
});

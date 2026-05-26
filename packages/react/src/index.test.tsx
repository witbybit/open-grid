// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import {
	GridProvider,
	PortalCell,
	PortalManager,
	OpenGrid,
	useGridNavigationController,
	useGridKeySelector,
	useGridApi,
	useGridSelector,
	useClientGrid,
} from './index.js';
import { createGridApiFacade } from './gridApiFacade.js';

// Mock ResizeObserver for jsdom environment
class MockResizeObserver {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}
globalThis.ResizeObserver = MockResizeObserver;

interface TestRow {
	id: string;
	name: string;
}

function createTestGrid<TRowData>(store: GridStore<TRowData>) {
	return {
		store,
		api: createGridApiFacade(store),
	};
}

const SelectorInspector = () => {
	const focused = useGridSelector((s) => s.focusedCell);
	const dataVersion = useGridKeySelector('dataVersion', (s) => s.dataVersion);
	const store = new GridStore<TestRow>({
		columns: [{ field: 'name', header: 'Name', width: 100 }],
	});
	const api = useGridApi<TestRow>();

	return (
		<div>
			<span data-testid='focused-cell'>{focused ? `${focused.rowId}:${focused.colField}` : 'none'}</span>
			<span data-testid='data-version'>{dataVersion}</span>
			<span data-testid='store-exists'>{store ? 'yes' : 'no'}</span>
			<span data-testid='api-exists'>{api ? 'yes' : 'no'}</span>
		</div>
	);
};

const NavigationControllerOwner = ({ onCellValueChanged }: { onCellValueChanged: (rowId: string, colField: string, val: unknown) => void }) => {
	useGridNavigationController<TestRow>({ onCellValueChanged });
	return null;
};

const ApiSurfaceInspector = () => {
	const api = useGridApi<TestRow>();
	return (
		<div>
			<span data-testid='api-frozen'>{Object.isFrozen(api) ? 'yes' : 'no'}</span>
			<span data-testid='api-engine'>{'engine' in (api as unknown as Record<string, unknown>) ? 'yes' : 'no'}</span>
			<span data-testid='api-register-row-model'>{'registerRowModel' in (api as unknown as Record<string, unknown>) ? 'yes' : 'no'}</span>
			<button data-testid='move-column' onClick={() => api.moveColumn('name', 0)}>
				Move
			</button>
			<button data-testid='disable-reorder' onClick={() => api.setColumnReorderEnabled(false)}>
				Disable
			</button>
		</div>
	);
};

describe('React Adapter (v2 API and Architecture)', () => {
	it('should provide context and support selector hooks', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});

		const grid = createTestGrid(store);

		render(
			<GridProvider grid={grid}>
				<SelectorInspector />
			</GridProvider>
		);

		expect(screen.getByTestId('store-exists').textContent).toBe('yes');
		expect(screen.getByTestId('api-exists').textContent).toBe('yes');
		expect(screen.getByTestId('focused-cell').textContent).toBe('none');
		expect(screen.getByTestId('data-version').textContent).toBe('2'); // starts at 1, +1 after ClientRowModelController refresh

		// Focus cell and verify selector updates
		act(() => {
			store.setFocusedCell('1', 'name');
		});
		expect(screen.getByTestId('focused-cell').textContent).toBe('1:name');

		// Update rows and verify key selector updates
		act(() => {
			controller.setRows([{ id: '1', name: 'Product B' }]);
		});
		expect(screen.getByTestId('data-version').textContent).toBe('3');

		controller.dispose();
	});

	it('should expose a frozen public API facade instead of the mutable store internals', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 100 },
			],
		});
		const grid = createTestGrid(store);

		render(
			<GridProvider grid={grid}>
				<ApiSurfaceInspector />
			</GridProvider>
		);

		expect(screen.getByTestId('api-frozen').textContent).toBe('yes');
		expect(screen.getByTestId('api-engine').textContent).toBe('no');
		expect(screen.getByTestId('api-register-row-model').textContent).toBe('no');

		fireEvent.click(screen.getByTestId('move-column'));
		expect(store.getState().columns.map((column) => column.field)).toEqual(['name', 'id']);

		fireEvent.click(screen.getByTestId('disable-reorder'));
		expect(store.getState().enableColumnReorder).toBe(false);
	});

	it('should render custom cell renderer via PortalCell', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellRenderer: ({ value }) => <span data-testid='custom-renderer'>{String(value)}!!!</span>,
				},
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);

		const colDef = store.getColumnDef('name')!;
		const node = store.getRowModel()!.getRowNode(0)!;

		render(
			<GridProvider grid={grid}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={false} isLoading={false} />
			</GridProvider>
		);

		expect(screen.getByTestId('custom-renderer').textContent).toBe('Product A!!!');
		controller.dispose();
	});

	it('should render default text input when editing and no custom editor via PortalCell', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);

		const colDef = store.getColumnDef('name')!;
		const node = store.getRowModel()!.getRowNode(0)!;

		// Set active edit state
		act(() => {
			store.setState({
				activeEdit: { rowId: '1', colField: 'name' },
			});
		});

		render(
			<GridProvider grid={grid}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByRole('textbox') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.value).toBe('Product A');

		// Commit edit by blurring
		fireEvent.change(input, { target: { value: 'Product B' } });
		fireEvent.blur(input);

		expect(store.getCellValue('1', 'name')).toBe('Product B');
		controller.dispose();
	});

	it('should not commit an in-progress edit just because the portal unmounts', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);

		const colDef = store.getColumnDef('name')!;
		const node = store.getRowModel()!.getRowNode(0)!;

		act(() => {
			store.setState({
				activeEdit: { rowId: '1', colField: 'name' },
			});
		});

		const rendered = render(
			<GridProvider grid={grid}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = within(rendered.container).getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Product B' } });
		rendered.unmount();

		expect(store.getCellValue('1', 'name')).toBe('Product A');
		controller.dispose();
	});

	it('should commit an in-progress edit when editStopped is dispatched without cancellation', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);

		const colDef = store.getColumnDef('name')!;
		const node = store.getRowModel()!.getRowNode(0)!;

		act(() => {
			store.setState({
				activeEdit: { rowId: '1', colField: 'name' },
			});
		});

		const rendered = render(
			<GridProvider grid={grid}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = within(rendered.container).getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Product B' } });

		act(() => {
			store.stopEditing(false);
		});

		expect(store.getCellValue('1', 'name')).toBe('Product B');
		controller.dispose();
	});

	it('should render custom cell editor via PortalCell', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellEditor: ({ value, onChange, onCommit }) => (
						<input
							data-testid='custom-editor'
							value={String(value)}
							onChange={(e) => onChange(e.target.value)}
							onBlur={() => onCommit()}
						/>
					),
				},
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});

		const grid = createTestGrid(store);

		const colDef = store.getColumnDef('name')!;
		const node = store.getRowModel()!.getRowNode(0)!;

		// Set active edit state
		act(() => {
			store.setState({
				activeEdit: { rowId: '1', colField: 'name' },
			});
		});

		render(
			<GridProvider grid={grid}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByTestId('custom-editor') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.value).toBe('Product A');

		// Commit edit
		fireEvent.change(input, { target: { value: 'Product B' } });
		fireEvent.blur(input);

		expect(store.getCellValue('1', 'name')).toBe('Product B');
		controller.dispose();
	});

	it('should render portals inside PortalManager', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellRenderer: ({ value }) => <span data-testid='portal-content'>{String(value)}</span>,
				},
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);

		const container = document.createElement('div');
		document.body.appendChild(container);

		const colDef = store.getColumnDef('name');
		const node = store.getRowModel()!.getRowNode(0)!;

		const portals = new Map();
		portals.set('1:name', {
			cellKey: '1:name',
			container,
			value: 'Product A',
			node,
			col: colDef,
		});

		render(<PortalManager portals={portals} grid={grid} />);

		expect(screen.getByTestId('portal-content').textContent).toBe('Product A');

		document.body.removeChild(container);
		controller.dispose();
	});

	it('should dispose navigation controller event listeners on unmount', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Cell Content' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);

		const onCellValueChanged = vi.fn();

		const { unmount } = render(
			<GridProvider grid={grid}>
				<NavigationControllerOwner onCellValueChanged={onCellValueChanged} />
			</GridProvider>
		);

		unmount();

		act(() => {
			store.setCellValue('1', 'name', 'After unmount');
		});

		expect(onCellValueChanged).not.toHaveBeenCalled();
		controller.dispose();
	});

	it('should mount OpenGrid component and setup rendering container', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);

		const { container, unmount } = render(<OpenGrid grid={grid} pinLeftColumns={1} enableNavigation={true} />);

		// Verify that a div element with relative position has been rendered inside OpenGrid
		const openGridDiv = container.firstElementChild as HTMLElement;
		expect(openGridDiv).toBeDefined();
		expect(openGridDiv.style.position).toBe('relative');

		unmount();
		controller.dispose();
	});

	it('should keep custom renderer portals mounted when renderer columns are reordered', async () => {
		const store = new GridStore<{ id: string; severity: string; service: string }>({
			columns: [
				{ field: 'id', header: 'ID', width: 80 },
				{
					field: 'severity',
					header: 'Severity',
					width: 120,
					cellRenderer: ({ value }) => <span data-testid='severity-renderer'>{String(value)}</span>,
				},
				{
					field: 'service',
					header: 'Service',
					width: 120,
					cellRenderer: ({ value }) => <span data-testid='service-renderer'>{String(value)}</span>,
				},
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: '1', severity: 'CRITICAL', service: 'Auth' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);

		const { unmount } = render(<OpenGrid grid={grid} enableNavigation={false} />);

		await screen.findByText('CRITICAL');
		await screen.findByText('Auth');

		act(() => {
			grid.api.moveColumn('severity', 2);
		});

		await waitFor(() => {
			expect(screen.getByText('CRITICAL')).toBeDefined();
			expect(screen.getByText('Auth')).toBeDefined();
		});

		unmount();
		controller.dispose();
	});

	it('should expose precise cell click params and dispatch cellClicked event', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);
		const onCellClick = vi.fn();
		const eventListener = vi.fn();
		const unsubscribe = store.addEventListener('cellClicked', eventListener);

		const { container, unmount } = render(<OpenGrid grid={grid} enableNavigation={false} onCellClick={onCellClick} />);

		await waitFor(() => {
			expect(container.querySelector('.og-cell[data-col-field="name"]')).not.toBeNull();
		});

		fireEvent.click(container.querySelector('.og-cell[data-col-field="name"]')!);

		expect(onCellClick).toHaveBeenCalledWith(
			expect.objectContaining({
				rowId: '1',
				rowIndex: 0,
				row: { id: '1', name: 'Product A' },
				colField: 'name',
				colIndex: 0,
				value: 'Product A',
				api: grid.api,
			})
		);
		expect(eventListener).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'cellClicked',
				payload: expect.objectContaining({ rowId: '1', colField: 'name' }),
			})
		);

		unsubscribe();
		unmount();
		controller.dispose();
	});

	it('should not mix stale native text with custom renderer content after column topology changes', async () => {
		const customColumns = [
			{
				field: 'risk',
				header: 'Risk',
				width: 120,
				cellRenderer: ({ value }: { value: unknown }) => <span data-testid='risk-renderer'>Risk {String(value)}</span>,
			},
		];
		const nativeColumns = [{ field: 'col_999', header: 'Col 999', width: 120 }];
		const store = new GridStore<{ id: string; risk: string; col_999: string }>({
			columns: customColumns,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: '1', risk: 'LOW', col_999: 'Val 999' }],
			columns: customColumns,
		});
		const grid = createTestGrid(store);

		const { unmount } = render(<OpenGrid grid={grid} enableNavigation={false} />);

		await screen.findByText('Risk LOW');

		act(() => {
			store.setState({ columns: nativeColumns });
		});

		await screen.findByText('Val 999');

		act(() => {
			store.setState({ columns: customColumns });
		});

		await waitFor(() => {
			expect(screen.getByTestId('risk-renderer').textContent).toBe('Risk LOW');
			expect(screen.queryByText('Val 999')).toBeNull();
		});

		unmount();
		controller.dispose();
	});

	it('should not register navigation when navigation is disabled', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});
		const grid = createTestGrid(store);

		const { unmount } = render(<OpenGrid grid={grid} enableNavigation={false} />);

		expect(store.getPlugin('navigation')).toBeNull();

		unmount();
		controller.dispose();
	});

	it('should use selector equality to avoid rerenders for equivalent selected values', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const grid = createTestGrid(store);

		const renderSpy = vi.fn();

		const EqualityInspector = () => {
			const selected = useGridSelector(
				(state) => ({ version: state.dataVersion }),
				(left, right) => left.version === right.version
			);
			renderSpy(selected);
			return <span data-testid='selector-version'>{selected.version}</span>;
		};

		render(
			<GridProvider grid={grid}>
				<EqualityInspector />
			</GridProvider>
		);

		expect(renderSpy).toHaveBeenCalledTimes(1);

		act(() => {
			store.setFocusedCell('1', 'name');
		});

		expect(renderSpy).toHaveBeenCalledTimes(1);
	});

	it('should keep useClientGrid store stable when callers pass inline columns', () => {
		const stores: Array<GridStore<TestRow>> = [];

		const HookHarness = ({ label }: { label: string }) => {
			const grid = useClientGrid<TestRow>({
				rows: [{ id: '1', name: label }],
				columns: [{ field: 'name', header: 'Name', width: 100 }],
			});
			stores.push(grid.store);
			return <span data-testid='store-count'>{stores.length}</span>;
		};

		const { rerender, unmount } = render(<HookHarness label='Product A' />);
		rerender(<HookHarness label='Product B' />);

		expect(stores.length).toBeGreaterThanOrEqual(2);
		expect(stores[0]).toBe(stores[stores.length - 1]);

		unmount();
	});
});

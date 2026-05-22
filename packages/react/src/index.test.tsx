// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GridStore, GridNavigationController, ClientRowModelController } from '@open-grid/core';
import {
	GridProvider,
	PortalCell,
	PortalManager,
	OpenGrid,
	useGridNavigationController,
	useGridKeySelector,
	useGridStore,
	useGridApi,
	useGridSelector,
} from './index.js';

// Mock ResizeObserver for jsdom environment
class MockResizeObserver {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}
globalThis.ResizeObserver = MockResizeObserver as any;

interface TestRow {
	id: string;
	name: string;
}

const SelectorInspector = () => {
	const focused = useGridSelector((s) => s.focusedCell);
	const dataVersion = useGridKeySelector('dataVersion', (s) => s.dataVersion);
	const store = useGridStore<TestRow>();
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

describe('React Adapter (v2 API and Architecture)', () => {
	it('should provide context and support selector hooks', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});

		render(
			<GridProvider store={store}>
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

		const colDef = store.getColumnDef('name');
		const node = store.getRowModel()!.getRowNode(0)!;

		render(
			<GridProvider store={store}>
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

		const colDef = store.getColumnDef('name');
		const node = store.getRowModel()!.getRowNode(0)!;

		// Set active edit state
		act(() => {
			store.setState({
				activeEdit: { rowId: '1', colField: 'name' },
			});
		});

		render(
			<GridProvider store={store}>
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

		const colDef = store.getColumnDef('name');
		const node = store.getRowModel()!.getRowNode(0)!;

		// Set active edit state
		act(() => {
			store.setState({
				activeEdit: { rowId: '1', colField: 'name' },
			});
		});

		render(
			<GridProvider store={store}>
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

		render(<PortalManager portals={portals} store={store} />);

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
		const onCellValueChanged = vi.fn();

		const { unmount } = render(
			<GridProvider store={store}>
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

		const { container, unmount } = render(<OpenGrid store={store} pinLeftColumns={1} enableNavigation={true} />);

		// Verify that a div element with relative position has been rendered inside OpenGrid
		const openGridDiv = container.firstElementChild as HTMLElement;
		expect(openGridDiv).toBeDefined();
		expect(openGridDiv.style.position).toBe('relative');

		unmount();
		controller.dispose();
	});
});

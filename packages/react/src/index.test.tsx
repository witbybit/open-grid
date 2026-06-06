// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { createClientGrid, type ClientGridOptions } from '@open-grid/core';
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
	useServerGrid,
} from './index.js';
import { createPortalStore } from './GridPortal.js';

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

function createTestGrid<TRowData>(options: ClientGridOptions<TRowData>) {
	return {
		api: createClientGrid(options),
	};
}

const SelectorInspector = () => {
	const focused = useGridSelector((s) => s.selection.focus);
	const dataVersion = useGridKeySelector('dataVersion', (s) => s.dataVersion);
	const api = useGridApi<TestRow>();

	return (
		<div>
			<span data-testid='focused-cell'>{focused ? `${focused.rowId}:${focused.colField}` : 'none'}</span>
			<span data-testid='data-version'>{dataVersion}</span>
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
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		render(
			<GridProvider api={grid.api}>
				<SelectorInspector />
			</GridProvider>
		);

		expect(screen.getByTestId('api-exists').textContent).toBe('yes');
		expect(screen.getByTestId('focused-cell').textContent).toBe('none');
		expect(screen.getByTestId('data-version').textContent).toBe('2');

		act(() => {
			grid.api.selectCell({ rowId: '1', colField: 'name' });
		});
		expect(screen.getByTestId('focused-cell').textContent).toBe('1:name');

		act(() => {
			grid.api.setRows([{ id: '1', name: 'Product B' }]);
		});
		expect(screen.getByTestId('data-version').textContent).toBe('3');

		grid.api.destroy();
	});

	it('should expose a frozen public API facade instead of the mutable store internals', () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 100 },
			],
		});

		render(
			<GridProvider api={grid.api}>
				<ApiSurfaceInspector />
			</GridProvider>
		);

		expect(screen.getByTestId('api-frozen').textContent).toBe('yes');
		expect(screen.getByTestId('api-engine').textContent).toBe('no');
		expect(screen.getByTestId('api-register-row-model').textContent).toBe('no');

		fireEvent.click(screen.getByTestId('move-column'));
		expect(grid.api.getState().columns.map((column) => column.field)).toEqual(['name', 'id']);

		fireEvent.click(screen.getByTestId('disable-reorder'));
		expect(grid.api.getState().enableColumnReorder).toBe(false);

		grid.api.destroy();
	});

	it('should render custom cell renderer via PortalCell', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellRenderer: ({ value }) => <span data-testid='custom-renderer'>{String(value)}!!!</span>,
				},
			],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = grid.api.getDataRowNodeAtVisualIndex(0)!;

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={false} isLoading={false} />
			</GridProvider>
		);

		expect(screen.getByTestId('custom-renderer').textContent).toBe('Product A!!!');
		grid.api.destroy();
	});

	it('should pass lifecycle metadata to custom cell renderers', () => {
		const rendererProps: Record<string, unknown>[] = [];
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellRenderer: (props) => {
						rendererProps.push(props as unknown as Record<string, unknown>);
						return <span data-testid='custom-renderer-phase'>{String(props.phase)}</span>;
					},
				},
			],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = grid.api.getDataRowNodeAtVisualIndex(0)!;

		render(
			<GridProvider api={grid.api}>
				<PortalCell
					rowId='1'
					colField='name'
					value='Product A'
					col={colDef}
					node={node}
					isEditing={false}
					isLoading={false}
					phase='scroll-idle'
					isScrolling={false}
				/>
			</GridProvider>
		);

		expect(screen.getByTestId('custom-renderer-phase').textContent).toBe('scroll-idle');
		expect(rendererProps[0]).toEqual(
			expect.objectContaining({
				colId: 'name',
				phase: 'scroll-idle',
				isScrolling: false,
				isEditing: false,
				isFocused: false,
			})
		);
		grid.api.destroy();
	});

	it('should render default text input when editing and no custom editor via PortalCell', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = grid.api.getDataRowNodeAtVisualIndex(0)!;

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByRole('textbox') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.value).toBe('Product A');

		fireEvent.change(input, { target: { value: 'Product B' } });
		fireEvent.blur(input);

		expect(grid.api.getCellValue('1', 'name')).toBe('Product B');
		grid.api.destroy();
	});

	it('should not commit an in-progress edit just because the portal unmounts', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = grid.api.getDataRowNodeAtVisualIndex(0)!;

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		const rendered = render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = within(rendered.container).getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Product B' } });
		rendered.unmount();

		expect(grid.api.getCellValue('1', 'name')).toBe('Product A');
		grid.api.destroy();
	});

	it('should commit an in-progress edit when editStopped is dispatched without cancellation', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = grid.api.getDataRowNodeAtVisualIndex(0)!;

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		const rendered = render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = within(rendered.container).getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Product B' } });

		act(() => {
			grid.api.stopEditing(false);
		});

		expect(grid.api.getCellValue('1', 'name')).toBe('Product B');
		grid.api.destroy();
	});

	it('should render custom cell editor via PortalCell', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
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

		const colDef = grid.api.getColumnDef('name')!;
		const node = grid.api.getDataRowNodeAtVisualIndex(0)!;

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByTestId('custom-editor') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.value).toBe('Product A');

		fireEvent.change(input, { target: { value: 'Product B' } });
		fireEvent.blur(input);

		expect(grid.api.getCellValue('1', 'name')).toBe('Product B');
		grid.api.destroy();
	});

	it('should commit custom cell editors immediately on Enter from the portal shell', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellEditor: ({ value, onChange }) => (
						<div data-testid='custom-editor-root' tabIndex={0}>
							<input data-testid='custom-editor-input' value={String(value)} onChange={(e) => onChange(e.target.value)} />
						</div>
					),
				},
			],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = grid.api.getDataRowNodeAtVisualIndex(0)!;

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByTestId('custom-editor-input') as HTMLInputElement;

		fireEvent.change(input, { target: { value: 'Product B' } });
		fireEvent.keyDown(input, { key: 'Enter' });

		expect(grid.api.getCellValue('1', 'name')).toBe('Product B');
		expect(grid.api.getState().activeEdit).toBeNull();

		grid.api.destroy();
	});

	it('should render portals inside PortalManager', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellRenderer: ({ value }) => <span data-testid='portal-content'>{String(value)}</span>,
				},
			],
		});

		const container = document.createElement('div');
		document.body.appendChild(container);

		const colDef = grid.api.getColumnDef('name');
		const node = grid.api.getDataRowNodeAtVisualIndex(0)!;

		const portals = new Map();
		portals.set('1:name', {
			cellKey: '1:name',
			container,
			value: 'Product A',
			node,
			col: colDef,
		});

		render(<PortalManager portals={portals} api={grid.api} />);

		expect(screen.getByTestId('portal-content').textContent).toBe('Product A');

		document.body.removeChild(container);
		grid.api.destroy();
	});

	it('should render only the latest cell portal for a recycled container', () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: '1', name: 'Old' },
				{ id: '2', name: 'New' },
			],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellRenderer: ({ value }) => <span data-testid='portal-content'>{String(value)}</span>,
				},
			],
		});
		const container = document.createElement('div');
		document.body.appendChild(container);
		const colDef = grid.api.getColumnDef('name');
		const portals = new Map();
		portals.set('1:name', {
			cellKey: '1:name',
			container,
			value: 'Old',
			node: grid.api.getRowNodeById('1')!,
			col: colDef,
			isEditing: false,
			isLoading: false,
		});
		portals.set('2:name', {
			cellKey: '2:name',
			container,
			value: 'New',
			node: grid.api.getRowNodeById('2')!,
			col: colDef,
			isEditing: false,
			isLoading: false,
		});

		render(<PortalManager portals={portals} api={grid.api} />);

		expect(screen.getAllByTestId('portal-content')).toHaveLength(1);
		expect(screen.getByTestId('portal-content').textContent).toBe('New');

		document.body.removeChild(container);
		grid.api.destroy();
	});

	it('should replace recycled cell portal store entries without retaining stale container owners', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: '1', name: 'Old' },
				{ id: '2', name: 'New' },
			],
			columns: [{ field: 'name', header: 'Name', width: 100, cellRenderer: () => null }],
		});
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');
		const colDef = grid.api.getColumnDef('name')!;

		store.mountCell('1:name', container, 'Old', grid.api.getRowNodeById('1')!, colDef, false, false);
		store.mountCell('2:name', container, 'New', grid.api.getRowNodeById('2')!, colDef, false, false);
		await act(async () => {
			await Promise.resolve();
		});

		expect(Array.from(store.getSnapshot().portals.keys())).toEqual(['2:name']);

		store.unmountCell('1:name', container);
		await act(async () => {
			await Promise.resolve();
		});
		expect(Array.from(store.getSnapshot().portals.keys())).toEqual(['2:name']);

		grid.api.destroy();
	});

	it('should update cell data without triggering global store change listeners', async () => {
		const store = createPortalStore<TestRow>();
		const listener = vi.fn();
		store.subscribe(listener);

		const cellListener = vi.fn();
		const cellKey = '1:name';
		const container = document.createElement('div');
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const colDef = grid.api.getColumnDef('name')!;

		// Mount cell first (structural change)
		store.mountCell(cellKey, container, 'Old', grid.api.getRowNodeById('1')!, colDef, false, false);
		await act(async () => {
			await Promise.resolve();
		});
		expect(listener).toHaveBeenCalledTimes(1);

		// Subscribe to cell
		const unsubscribeCell = store.subscribeToCell!(cellKey, cellListener);

		// Update cell data only (non-structural change)
		store.mountCell(cellKey, container, 'New', grid.api.getRowNodeById('1')!, colDef, false, false);

		// The global store listener should NOT have been called again (remains 1)
		expect(listener).toHaveBeenCalledTimes(1);
		// But the cell-specific listener SHOULD have been called!
		expect(cellListener).toHaveBeenCalledTimes(1);

		// Clean up
		unsubscribeCell();
		grid.api.destroy();
	});

	it('should dispose navigation controller event listeners on unmount', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Cell Content' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const onCellValueChanged = vi.fn();

		const { unmount } = render(
			<GridProvider api={grid.api}>
				<NavigationControllerOwner onCellValueChanged={onCellValueChanged} />
			</GridProvider>
		);

		unmount();

		act(() => {
			grid.api.setCellValue('1', 'name', 'After unmount');
		});

		expect(onCellValueChanged).not.toHaveBeenCalled();
		grid.api.destroy();
	});

	it('should mount OpenGrid component and setup rendering container', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const { container, unmount } = render(<OpenGrid api={grid.api} pinLeftColumns={1} enableNavigation={true} />);

		// Verify that a div element with relative position has been rendered inside OpenGrid
		const openGridDiv = container.firstElementChild as HTMLElement;
		expect(openGridDiv).toBeDefined();
		expect(openGridDiv.style.position).toBe('relative');

		unmount();
		grid.api.destroy();
	});

	it('should keep custom renderer portals mounted when renderer columns are reordered', async () => {
		const grid = createTestGrid<{ id: string; severity: string; service: string }>({
			rows: [{ id: '1', severity: 'CRITICAL', service: 'Auth' }],
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

		const { unmount } = render(<OpenGrid api={grid.api} enableNavigation={false} />);

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
		grid.api.destroy();
	});

	it('should expose precise cell click params and dispatch cellClicked event', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const onCellClick = vi.fn();
		const eventListener = vi.fn();
		const unsubscribe = grid.api.addEventListener('cellClicked', eventListener);

		const { container, unmount } = render(<OpenGrid api={grid.api} enableNavigation={false} onCellClick={onCellClick} />);

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
		grid.api.destroy();
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
		const grid = createTestGrid<{ id: string; risk: string; col_999: string }>({
			rows: [{ id: '1', risk: 'LOW', col_999: 'Val 999' }],
			columns: customColumns,
			getRowId: (row) => row.id,
		});

		const { unmount } = render(<OpenGrid api={grid.api} enableNavigation={false} />);

		await screen.findByText('Risk LOW');

		act(() => {
			grid.api.setColumns(nativeColumns);
		});

		await screen.findByText('Val 999');

		act(() => {
			grid.api.setColumns(customColumns);
		});

		await waitFor(() => {
			expect(screen.getByTestId('risk-renderer').textContent).toBe('Risk LOW');
			expect(screen.queryByText('Val 999')).toBeNull();
		});

		unmount();
		grid.api.destroy();
	});

	it('should not register navigation when navigation is disabled', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const { container, unmount } = render(<OpenGrid api={grid.api} enableNavigation={false} />);

		fireEvent.mouseDown(container.querySelector('.og-cell[data-col-field="name"]')!);
		expect(grid.api.getState().selection.focus).toBeNull();

		unmount();
		grid.api.destroy();
	});

	it('should use selector equality to avoid rerenders for equivalent selected values', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

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
			<GridProvider api={grid.api}>
				<EqualityInspector />
			</GridProvider>
		);

		expect(renderSpy).toHaveBeenCalledTimes(1);

		act(() => {
			grid.api.selectCell({ rowId: '1', colField: 'name' });
		});

		expect(renderSpy).toHaveBeenCalledTimes(1);
		grid.api.destroy();
	});

	it('should keep useClientGrid api stable when callers pass inline columns', () => {
		const apis: Array<ReturnType<typeof useClientGrid<TestRow>>> = [];

		const HookHarness = ({ label }: { label: string }) => {
			const api = useClientGrid<TestRow>({
				rows: [{ id: '1', name: label }],
				columns: [{ field: 'name', header: 'Name', width: 100 }],
			});
			apis.push(api);
			return <span data-testid='api-count'>{apis.length}</span>;
		};

		const { rerender, unmount } = render(<HookHarness label='Product A' />);
		rerender(<HookHarness label='Product B' />);

		expect(apis.length).toBeGreaterThanOrEqual(2);
		expect(apis[0]).toBe(apis[apis.length - 1]);

		unmount();
	});

	it('should keep hook-created server grids alive through React StrictMode effect replay', async () => {
		const datasource = {
			getRows: vi.fn(async ({ startRow, endRow }: { startRow: number; endRow: number }) => ({
				rows: Array.from({ length: endRow - startRow }, (_, index) => ({
					id: `${startRow + index}`,
					name: `Server Row ${startRow + index}`,
				})),
				totalCount: 100,
			})),
		};

		const StrictServerHarness = () => {
			const api = useServerGrid<TestRow>({
				datasource,
				blockSize: 20,
				columns: [{ field: 'name', header: 'Name', width: 140 }],
			});

			return <OpenGrid api={api} enableNavigation={false} />;
		};

		const { unmount } = render(
			<React.StrictMode>
				<StrictServerHarness />
			</React.StrictMode>
		);

		await screen.findByText('Server Row 0');
		expect(datasource.getRows).toHaveBeenCalled();

		unmount();
	});

	it('should rerender custom cell renderer when cell value is programmatically updated', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellRenderer: ({ value }) => <span data-testid='custom-renderer-programmatic'>{String(value)}</span>,
				},
			],
		});

		const { unmount } = render(<OpenGrid api={grid.api} enableNavigation={false} />);

		await screen.findByText('Product A');
		expect(screen.getByTestId('custom-renderer-programmatic').textContent).toBe('Product A');

		act(() => {
			grid.api.setCellValue('1', 'name', 'Product Updated');
		});

		await waitFor(() => {
			expect(screen.getByTestId('custom-renderer-programmatic').textContent).toBe('Product Updated');
		});

		unmount();
		grid.api.destroy();
	});

	it('should route arrow navigation only to the active nested detail grid', async () => {
		const parentGrid = createTestGrid<TestRow>({
			rows: [
				{ id: 'p1', name: 'Parent A' },
				{ id: 'p2', name: 'Parent B' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			initialState: {
				rowModelConfig: {
					type: 'client',
					masterDetail: {
						enabled: true,
						expandedRowIds: { p1: true },
						defaultDetailHeight: 120,
					},
				},
			},
		});
		const childGrid = createTestGrid<TestRow>({
			rows: [
				{ id: 'c1', name: 'Child A' },
				{ id: 'c2', name: 'Child B' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
		});

		const { unmount } = render(
			<OpenGrid api={parentGrid.api} enableNavigation detailRowRenderer={() => <OpenGrid api={childGrid.api} enableNavigation />} />
		);

		act(() => {
			parentGrid.api.selectCell({ rowId: 'p1', colField: 'name' });
		});

		const childCell = (await screen.findByText('Child A')).closest('.og-cell') as HTMLElement;
		fireEvent.mouseDown(childCell);
		fireEvent.click(childCell);
		expect(childGrid.api.getState().selection.focus).toEqual({ rowId: 'c1', colField: 'name' });

		fireEvent.keyDown(window, { key: 'ArrowDown' });

		expect(parentGrid.api.getState().selection.focus).toEqual({ rowId: 'p1', colField: 'name' });
		expect(childGrid.api.getState().selection.focus).toEqual({ rowId: 'c2', colField: 'name' });

		unmount();
		parentGrid.api.destroy();
		childGrid.api.destroy();
	});

	it('should keep expanded detail row renderers bound to their own row portal hosts', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: 'p1', name: 'Parent A' },
				{ id: 'p2', name: 'Parent B' },
				{ id: 'p3', name: 'Parent C' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			initialState: {
				masterDetailEnabled: true,
				detailRowHeight: 120,
			},
		});

		const { container, unmount } = render(
			<div style={{ width: 500, height: 400 }}>
				<OpenGrid
					api={grid.api}
					enableNavigation={false}
					detailRowRenderer={({ visualRow }) =>
						visualRow.kind === 'detail' ? <div data-testid={`detail-${visualRow.parentId}`}>Details for {visualRow.parentId}</div> : null
					}
				/>
			</div>
		);

		act(() => {
			grid.api.toggleDetailExpanded('p1');
			grid.api.toggleDetailExpanded('p2');
		});

		await waitFor(() => {
			expect(screen.getByTestId('detail-p1')).toBeTruthy();
			expect(screen.getByTestId('detail-p2')).toBeTruthy();
		});

		const detailHosts = Array.from(container.querySelectorAll('.og-row-portal-host')) as HTMLElement[];
		expect(detailHosts).toHaveLength(2);
		expect(screen.getByTestId('detail-p1').closest('.og-row-portal-host')).toBe(detailHosts[0]);
		expect(screen.getByTestId('detail-p2').closest('.og-row-portal-host')).toBe(detailHosts[1]);
		expect(detailHosts.map((host) => host.closest('.og-row')?.dataset.rowId)).toEqual(['detail:p1', 'detail:p2']);
		expect(detailHosts.map((host) => (host.closest('.og-row') as HTMLElement | null)?.style.height)).toEqual(['120px', '120px']);

		unmount();
		grid.api.destroy();
	});

	it('should preserve detail row height and spacing when sorted master rows are expanded', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: 'p1', name: 'Cy' },
				{ id: 'p2', name: 'In' },
				{ id: 'p3', name: 'Um' },
				{ id: 'p4', name: 'We' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			initialState: {
				masterDetailEnabled: true,
				detailRowHeight: 120,
				sortModel: [{ colId: 'name', direction: 'asc' }],
			},
		});

		const { container, unmount } = render(
			<div style={{ width: 500, height: 500 }}>
				<OpenGrid
					api={grid.api}
					enableNavigation={false}
					detailRowRenderer={({ visualRow }) =>
						visualRow.kind === 'detail' ? <div data-testid={`detail-${visualRow.parentId}`}>Details for {visualRow.parentId}</div> : null
					}
				/>
			</div>
		);

		act(() => {
			grid.api.toggleDetailExpanded('p1');
			grid.api.toggleDetailExpanded('p2');
			grid.api.toggleDetailExpanded('p4');
		});

		await waitFor(() => {
			expect(screen.getByTestId('detail-p1')).toBeTruthy();
			expect(screen.getByTestId('detail-p2')).toBeTruthy();
			expect(screen.getByTestId('detail-p4')).toBeTruthy();
		});

		const rows = Array.from(container.querySelectorAll('.og-layer-center > .og-row')) as HTMLElement[];
		expect(rows.map((row) => [row.dataset.rowId, row.style.height, row.style.transform])).toEqual([
			['row:p1', '40px', 'translate3d(0, 0px, 0)'],
			['detail:p1', '120px', 'translate3d(0, 40px, 0)'],
			['row:p2', '40px', 'translate3d(0, 160px, 0)'],
			['detail:p2', '120px', 'translate3d(0, 200px, 0)'],
			['row:p3', '40px', 'translate3d(0, 320px, 0)'],
			['row:p4', '40px', 'translate3d(0, 360px, 0)'],
			['detail:p4', '120px', 'translate3d(0, 400px, 0)'],
		]);

		unmount();
		grid.api.destroy();
	});

	it('should remove detail row renderer content when a detail row is recycled into a data row', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: 'p1', name: 'Parent A' },
				{ id: 'p2', name: 'Parent B' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			initialState: {
				masterDetailEnabled: true,
				detailRowHeight: 120,
			},
		});

		const { container, unmount } = render(
			<div style={{ width: 500, height: 240 }}>
				<OpenGrid
					api={grid.api}
					enableNavigation={false}
					detailRowRenderer={({ visualRow }) =>
						visualRow.kind === 'detail' ? <div data-testid={`detail-${visualRow.parentId}`}>Details for {visualRow.parentId}</div> : null
					}
				/>
			</div>
		);

		act(() => {
			grid.api.toggleDetailExpanded('p1');
		});

		await screen.findByTestId('detail-p1');

		act(() => {
			grid.api.toggleDetailExpanded('p1');
		});

		await waitFor(() => {
			expect(screen.queryByTestId('detail-p1')).toBeNull();
		});
		expect(container.querySelector('.og-row-portal-host')).toBeNull();

		unmount();
		grid.api.destroy();
	});

	it('should render custom group and detail row renderers inside PortalManager', () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [],
		});

		const containerGroup = document.createElement('div');
		const containerDetail = document.createElement('div');
		document.body.appendChild(containerGroup);
		document.body.appendChild(containerDetail);

		const rowPortals = new Map();
		rowPortals.set('group-1', {
			rowKey: 'group-1',
			container: containerGroup,
			visualRow: {
				kind: 'group',
				id: 'group-1',
				field: 'category',
				key: 'Electronics',
				expanded: true,
				depth: 1,
				childCount: 5,
			},
		});

		rowPortals.set('detail-1', {
			rowKey: 'detail-1',
			container: containerDetail,
			visualRow: {
				kind: 'detail',
				id: 'detail-1',
				parentId: 'parent-1',
			},
		});

		const groupRenderer = ({ visualRow }: any) => (
			<span data-testid='custom-group'>
				{visualRow.field}:{visualRow.key} ({visualRow.childCount} items)
			</span>
		);

		const detailRenderer = ({ visualRow }: any) => <span data-testid='custom-detail'>Details for {visualRow.parentId}</span>;

		render(
			<PortalManager
				portals={new Map()}
				rowPortals={rowPortals}
				api={grid.api}
				groupRowRenderer={groupRenderer}
				detailRowRenderer={detailRenderer}
			/>
		);

		expect(screen.getByTestId('custom-group').textContent).toBe('category:Electronics (5 items)');
		expect(screen.getByTestId('custom-detail').textContent).toBe('Details for parent-1');

		document.body.removeChild(containerGroup);
		document.body.removeChild(containerDetail);
		grid.api.destroy();
	});

	it('should render only the latest row portal for a recycled detail container', () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [],
		});
		const container = document.createElement('div');
		document.body.appendChild(container);
		const rowPortals = new Map();
		rowPortals.set('detail-old', {
			rowKey: 'detail-old',
			container,
			visualRow: {
				kind: 'detail',
				id: 'detail-old',
				parentId: 'old-parent',
			},
		});
		rowPortals.set('detail-new', {
			rowKey: 'detail-new',
			container,
			visualRow: {
				kind: 'detail',
				id: 'detail-new',
				parentId: 'new-parent',
			},
		});

		render(
			<PortalManager
				portals={new Map()}
				rowPortals={rowPortals}
				api={grid.api}
				detailRowRenderer={({ visualRow }: any) => <span data-testid='custom-detail'>Details for {visualRow.parentId}</span>}
			/>
		);

		expect(screen.getAllByTestId('custom-detail')).toHaveLength(1);
		expect(screen.getByTestId('custom-detail').textContent).toBe('Details for new-parent');

		document.body.removeChild(container);
		grid.api.destroy();
	});

	it('should ignore a stale row portal when a recycled host now belongs to another row', () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [],
		});
		const row = document.createElement('div');
		row.className = 'og-row';
		row.dataset.rowKey = 'detail-new';
		const container = document.createElement('div');
		container.className = 'og-row-portal-host';
		row.appendChild(container);
		document.body.appendChild(row);

		const rowPortals = new Map();
		rowPortals.set('detail-old', {
			rowKey: 'detail-old',
			container,
			visualRow: {
				kind: 'detail',
				id: 'detail-old',
				parentId: 'old-parent',
			},
		});

		render(
			<PortalManager
				portals={new Map()}
				rowPortals={rowPortals}
				api={grid.api}
				detailRowRenderer={({ visualRow }: any) => <span data-testid='custom-detail'>Details for {visualRow.parentId}</span>}
			/>
		);

		expect(screen.queryByTestId('custom-detail')).toBeNull();

		document.body.removeChild(row);
		grid.api.destroy();
	});

	it('should update row portal content when the visual row changes for the same container', () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [],
		});
		const container = document.createElement('div');
		document.body.appendChild(container);
		const makeRowPortals = (expanded: boolean) =>
			new Map([
				[
					'group-1',
					{
						rowKey: 'group-1',
						container,
						visualRow: {
							kind: 'group',
							id: 'group-1',
							field: 'category',
							key: 'Electronics',
							expanded,
							depth: 0,
							childCount: expanded ? 5 : 2,
						},
					},
				],
			]);

		const { rerender } = render(
			<PortalManager
				portals={new Map()}
				rowPortals={makeRowPortals(false)}
				api={grid.api}
				groupRowRenderer={({ visualRow }: any) => (
					<span data-testid='custom-group'>
						{visualRow.expanded ? `expanded:${visualRow.childCount}` : `collapsed:${visualRow.childCount}`}
					</span>
				)}
			/>
		);

		expect(screen.getByTestId('custom-group').textContent).toBe('collapsed:2');

		rerender(
			<PortalManager
				portals={new Map()}
				rowPortals={makeRowPortals(true)}
				api={grid.api}
				groupRowRenderer={({ visualRow }: any) => (
					<span data-testid='custom-group'>
						{visualRow.expanded ? `expanded:${visualRow.childCount}` : `collapsed:${visualRow.childCount}`}
					</span>
				)}
			/>
		);

		expect(screen.getByTestId('custom-group').textContent).toBe('expanded:5');

		document.body.removeChild(container);
		grid.api.destroy();
	});

	it('should not flush portal updates synchronously during React cleanup', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellRenderer: ({ value }) => <span data-testid='portal-content'>{String(value)}</span>,
				},
			],
		});

		const { unmount } = render(
			<React.StrictMode>
				<OpenGrid api={grid.api} />
			</React.StrictMode>
		);

		unmount();

		expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('flushSync was called from inside a lifecycle method'));
		consoleError.mockRestore();
		grid.api.destroy();
	});

	it('should maintain stable event listeners on the container and memoize PortalCell to prevent redundant renders', async () => {
		const addEventListenerSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener');
		let renderCount = 0;

		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: '1', name: 'Product A' },
				{ id: '2', name: 'Product B' },
			],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellRenderer: ({ value }) => {
						renderCount++;
						return <span data-testid={`cell-${value}`}>{String(value)}</span>;
					},
				},
			],
		});

		const { container } = render(<OpenGrid api={grid.api} />);
		const openGridContainer = container.firstElementChild as HTMLElement;

		// Initial render should bind event listeners on the container
		const initialAddCalls = addEventListenerSpy.mock.calls.filter((call, index) => {
			const instance = addEventListenerSpy.mock.instances[index];
			return instance === openGridContainer && ['mousedown', 'mouseover', 'click', 'dblclick', 'contextmenu'].includes(call[0]);
		}).length;
		expect(initialAddCalls).toBeGreaterThanOrEqual(5);

		await waitFor(() => {
			expect(renderCount).toBeGreaterThan(0);
		});
		addEventListenerSpy.mockClear();

		// Trigger editing on row 2, which changes the portal list state
		act(() => {
			grid.api.startEditing('2', 'name');
		});

		// Check if container event listeners were re-bound during this update
		const updateAddCalls = addEventListenerSpy.mock.calls.filter((call, index) => {
			const instance = addEventListenerSpy.mock.instances[index];
			return instance === openGridContainer && ['mousedown', 'mouseover', 'click', 'dblclick', 'contextmenu'].includes(call[0]);
		}).length;
		expect(updateAddCalls).toBe(0); // Event listeners are stable and not re-bound!

		addEventListenerSpy.mockRestore();
		grid.api.destroy();
	});
});

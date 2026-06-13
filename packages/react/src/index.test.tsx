// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(cleanup);
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { createClientGrid, type ClientGridOptions, type ColumnDef } from '@open-grid/core';
import * as ReactPackage from './index.js';
import { GridProvider } from './gridContext.js';
import { GridView } from './GridView.js';
import {
	GridEventName,
	Grid,
	GridStatusBar,
	PortalCell,
	PortalManager,
	useGridKeySelector,
	useGridApi,
	useGridSelector,
	GridPagination,
	useClientGridPagination,
} from './index.js';
import { useGridNavigationController } from './hooks.js';
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
	const dataVersion = useGridKeySelector('globalVersion', (s) => s.globalVersion);
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
					renderer: {
						kind: 'react',
						component: ({ value }: { value: any }) => <span data-testid='custom-renderer'>{String(value)}!!!</span>,
					},
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
					renderer: {
						kind: 'react',
						component: (props: any) => {
							rendererProps.push(props as unknown as Record<string, unknown>);
							return <span data-testid='custom-renderer-phase'>{String(props.phase)}</span>;
						},
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
					renderer: { kind: 'react', component: ({ value }: { value: any }) => <span data-testid='portal-content'>{String(value)}</span> },
				},
			],
		});

		const container = document.createElement('div');
		document.body.appendChild(container);

		const colDef = grid.api.getColumnDef('name')!;
		const node = grid.api.getDataRowNodeAtVisualIndex(0)!;

		const store = createPortalStore<TestRow>();
		store.mountCell('1:name', container, 'Product A', node, colDef, false, false);

		render(<PortalManager store={store} api={grid.api} />);

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
					renderer: { kind: 'react', component: ({ value }: { value: any }) => <span data-testid='portal-content'>{String(value)}</span> },
				},
			],
		});
		const container = document.createElement('div');
		document.body.appendChild(container);
		const colDef = grid.api.getColumnDef('name')!;

		const store = createPortalStore<TestRow>();
		store.mountCell('1:name', container, 'Old', grid.api.getRowNodeById('1')!, colDef, false, false);
		store.mountCell('2:name', container, 'New', grid.api.getRowNodeById('2')!, colDef, false, false);

		render(<PortalManager store={store} api={grid.api} />);

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
			columns: [{ field: 'name', header: 'Name', width: 100, renderer: { kind: 'react', component: () => null } }],
		});
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');
		const colDef = grid.api.getColumnDef('name')!;

		store.mountCell('1:name', container, 'Old', grid.api.getRowNodeById('1')!, colDef, false, false);
		store.mountCell('2:name', container, 'New', grid.api.getRowNodeById('2')!, colDef, false, false);
		await act(async () => {
			await Promise.resolve();
		});

		expect(store.getCellSnapshot().cellPortalList.map((p) => p.cellKey)).toEqual(['2:name']);

		store.unmountCell('1:name', container);
		await act(async () => {
			await Promise.resolve();
		});
		expect(store.getCellSnapshot().cellPortalList.map((p) => p.cellKey)).toEqual(['2:name']);

		grid.api.destroy();
	});

	it('should update cell data without triggering structural listeners', async () => {
		const store = createPortalStore<TestRow>();
		const structuralListener = vi.fn();
		store.subscribeCells(structuralListener);

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
		expect(structuralListener).toHaveBeenCalledTimes(1);

		// Subscribe to cell
		const unsubscribeCell = store.subscribeToCell!(cellKey, cellListener);

		// Update cell data only (non-structural change)
		store.mountCell(cellKey, container, 'New', grid.api.getRowNodeById('1')!, colDef, false, false);

		// The structural listener should NOT have fired again (remains 1)
		expect(structuralListener).toHaveBeenCalledTimes(1);
		// But the cell-specific listener SHOULD have been called
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

	it('should keep custom renderer portals mounted when renderer column layout changes', async () => {
		// This test verifies the cycle: custom renderer columns visible → replace with native columns → restore
		// custom renderer columns. Uses the same code path (releaseAll + full repaint) as a column reorder.
		const customColumns: ColumnDef<{ id: string; severity: string; service: string }>[] = [
			{
				field: 'severity',
				header: 'Severity',
				width: 120,
				renderer: {
					kind: 'react',
					component: ({ value }: { value: any }) => <span data-testid='severity-renderer'>{String(value)}</span>,
				},
			},
			{
				field: 'service',
				header: 'Service',
				width: 120,
				renderer: {
					kind: 'react',
					component: ({ value }: { value: any }) => <span data-testid='service-renderer'>{String(value)}</span>,
				},
			},
		];
		const nativeColumns: ColumnDef<{ id: string; severity: string; service: string }>[] = [
			{ field: 'severity', header: 'Severity', width: 120 },
			{ field: 'service', header: 'Service', width: 120 },
		];

		const grid = createTestGrid<{ id: string; severity: string; service: string }>({
			rows: [{ id: '1', severity: 'CRITICAL', service: 'Auth' }],
			columns: customColumns,
			getRowId: (row) => row.id,
		});

		const { unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} />
			</GridProvider>
		);

		// Initial render: React renderer portals are mounted and show their values.
		await screen.findByTestId('severity-renderer');
		await screen.findByTestId('service-renderer');
		expect(screen.getByTestId('severity-renderer').textContent).toBe('CRITICAL');
		expect(screen.getByTestId('service-renderer').textContent).toBe('Auth');

		// Switch to native columns — portals are released, native text appears.
		act(() => {
			grid.api.setColumns(nativeColumns);
		});
		await screen.findByText('CRITICAL');
		await screen.findByText('Auth');
		expect(screen.queryByTestId('severity-renderer')).toBeNull();
		expect(screen.queryByTestId('service-renderer')).toBeNull();

		// Restore custom renderer columns — portals must be re-mounted with correct values.
		act(() => {
			grid.api.setColumns(customColumns);
		});
		await waitFor(() => {
			expect(screen.getByTestId('severity-renderer').textContent).toBe('CRITICAL');
			expect(screen.getByTestId('service-renderer').textContent).toBe('Auth');
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
		const unsubscribe = grid.api.addEventListener(GridEventName.cellClicked, eventListener);

		const { container, unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} onCellClick={onCellClick} />
			</GridProvider>
		);

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
		const customColumns: ColumnDef<{ id: string; risk: string; col_999: string }>[] = [
			{
				field: 'risk',
				header: 'Risk',
				width: 120,
				renderer: {
					kind: 'react',
					component: ({ value }: { value: unknown }) => <span data-testid='risk-renderer'>Risk {String(value)}</span>,
				},
			},
		];
		const nativeColumns = [{ field: 'col_999', header: 'Col 999', width: 120 }];
		const grid = createTestGrid<{ id: string; risk: string; col_999: string }>({
			rows: [{ id: '1', risk: 'LOW', col_999: 'Val 999' }],
			columns: customColumns,
			getRowId: (row) => row.id,
		});

		const { unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} />
			</GridProvider>
		);

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

		const { container, unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} />
			</GridProvider>
		);

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
				(state) => ({ version: state.globalVersion }),
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

	it('should rerender custom cell renderer when cell value is programmatically updated', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					renderer: {
						kind: 'react',
						component: ({ value }: { value: any }) => <span data-testid='custom-renderer-programmatic'>{String(value)}</span>,
					},
				},
			],
		});

		const { unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} />
			</GridProvider>
		);

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
			<GridProvider api={parentGrid.api}>
				<GridView
					api={parentGrid.api}
					enableNavigation
					detailRowRenderer={() => (
						<GridProvider api={childGrid.api}>
							<GridView api={childGrid.api} enableNavigation />
						</GridProvider>
					)}
				/>
			</GridProvider>
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
				<GridProvider api={grid.api}>
					<GridView
						api={grid.api}
						enableNavigation={false}
						detailRowRenderer={({ visualRow }) =>
							visualRow.kind === 'detail' ? (
								<div data-testid={`detail-${visualRow.parentId}`}>Details for {visualRow.parentId}</div>
							) : null
						}
					/>
				</GridProvider>
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

		const getRowTop = (el: HTMLElement) => {
			const row = el.closest('.og-row') as HTMLElement | null;
			const m = row?.style.transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
			return m ? parseFloat(m[1]) : 0;
		};
		const detailHosts = (Array.from(container.querySelectorAll('.og-row-portal-host')) as HTMLElement[]).sort(
			(a, b) => getRowTop(a) - getRowTop(b)
		);
		expect(detailHosts).toHaveLength(2);
		expect(screen.getByTestId('detail-p1').closest('.og-row-portal-host')).toBe(detailHosts[0]);
		expect(screen.getByTestId('detail-p2').closest('.og-row-portal-host')).toBe(detailHosts[1]);
		expect(detailHosts.map((host) => (host.closest('.og-row') as HTMLElement | null)?.dataset.rowId)).toEqual(['detail:p1', 'detail:p2']);
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
				sortModel: [{ colId: 'name', sort: 'asc' }],
			},
		});

		const { container, unmount } = render(
			<div style={{ width: 500, height: 500 }}>
				<GridProvider api={grid.api}>
					<GridView
						api={grid.api}
						enableNavigation={false}
						detailRowRenderer={({ visualRow }) =>
							visualRow.kind === 'detail' ? (
								<div data-testid={`detail-${visualRow.parentId}`}>Details for {visualRow.parentId}</div>
							) : null
						}
					/>
				</GridProvider>
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

		const getTranslateY = (el: HTMLElement) => {
			const m = el.style.transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
			return m ? parseFloat(m[1]) : 0;
		};
		const rows = (Array.from(container.querySelectorAll('.og-rows-container > .og-row')) as HTMLElement[]).sort(
			(a, b) => getTranslateY(a) - getTranslateY(b)
		);
		expect(rows.map((row) => [row.dataset.rowId, row.style.height, row.style.transform])).toEqual([
			['row:p1', '40px', 'translateY(0px)'],
			['detail:p1', '120px', 'translateY(40px)'],
			['row:p2', '40px', 'translateY(160px)'],
			['detail:p2', '120px', 'translateY(200px)'],
			['row:p3', '40px', 'translateY(320px)'],
			['row:p4', '40px', 'translateY(360px)'],
			['detail:p4', '120px', 'translateY(400px)'],
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
				<GridProvider api={grid.api}>
					<GridView
						api={grid.api}
						enableNavigation={false}
						detailRowRenderer={({ visualRow }) =>
							visualRow.kind === 'detail' ? (
								<div data-testid={`detail-${visualRow.parentId}`}>Details for {visualRow.parentId}</div>
							) : null
						}
					/>
				</GridProvider>
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

		const store = createPortalStore<TestRow>();
		store.mountRow('group-1', containerGroup, {
			kind: 'group',
			id: 'group-1',
			field: 'category',
			key: 'Electronics',
			expanded: true,
			depth: 1,
			childCount: 5,
		} as any);
		store.mountRow('detail-1', containerDetail, {
			kind: 'detail',
			id: 'detail-1',
			parentId: 'parent-1',
		} as any);

		const groupRenderer = ({ visualRow }: any) => (
			<span data-testid='custom-group'>
				{visualRow.field}:{visualRow.key} ({visualRow.childCount} items)
			</span>
		);

		const detailRenderer = ({ visualRow }: any) => <span data-testid='custom-detail'>Details for {visualRow.parentId}</span>;

		render(<PortalManager store={store} api={grid.api} groupRowRenderer={groupRenderer} detailRowRenderer={detailRenderer} />);

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

		const store = createPortalStore<TestRow>();
		store.mountRow('detail-old', container, { kind: 'detail', id: 'detail-old', parentId: 'old-parent' } as any);
		store.mountRow('detail-new', container, { kind: 'detail', id: 'detail-new', parentId: 'new-parent' } as any);

		render(
			<PortalManager
				store={store}
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

		const store = createPortalStore<TestRow>();
		store.mountRow('detail-old', container, { kind: 'detail', id: 'detail-old', parentId: 'old-parent' } as any);

		render(
			<PortalManager
				store={store}
				api={grid.api}
				detailRowRenderer={({ visualRow }: any) => <span data-testid='custom-detail'>Details for {visualRow.parentId}</span>}
			/>
		);

		expect(screen.queryByTestId('custom-detail')).toBeNull();

		document.body.removeChild(row);
		grid.api.destroy();
	});

	it('should update row portal content when the visual row changes for the same container', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [],
		});
		const container = document.createElement('div');
		document.body.appendChild(container);

		const store = createPortalStore<TestRow>();

		const makeVisualRow = (expanded: boolean) => ({
			kind: 'group' as const,
			id: 'group-1',
			field: 'category',
			key: 'Electronics',
			expanded,
			depth: 0,
			childCount: expanded ? 5 : 2,
		});

		const groupRenderer = ({ visualRow }: any) => (
			<span data-testid='custom-group'>{visualRow.expanded ? `expanded:${visualRow.childCount}` : `collapsed:${visualRow.childCount}`}</span>
		);

		store.mountRow('group-1', container, makeVisualRow(false) as any);

		render(<PortalManager store={store} api={grid.api} groupRowRenderer={groupRenderer} />);

		expect(screen.getByTestId('custom-group').textContent).toBe('collapsed:2');

		store.mountRow('group-1', container, makeVisualRow(true) as any);
		await act(async () => {
			await Promise.resolve();
		});

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
					renderer: { kind: 'react', component: ({ value }: { value: any }) => <span data-testid='portal-content'>{String(value)}</span> },
				},
			],
		});

		const { unmount } = render(
			<React.StrictMode>
				<GridProvider api={grid.api}>
					<GridView api={grid.api} />
				</GridProvider>
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
					renderer: {
						kind: 'react',
						component: ({ value }: { value: any }) => {
							renderCount++;
							return <span data-testid={`cell-${value}`}>{String(value)}</span>;
						},
					},
				},
			],
		});

		const { container } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} />
			</GridProvider>
		);
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

// ─── GridPagination ───────────────────────────────────────────────────────────

describe('GridPagination', () => {
	it('renders page buttons and info text', () => {
		render(<GridPagination page={0} pageCount={5} onPageChange={() => {}} totalRows={50} pageSize={10} />);
		expect(screen.getByLabelText('Page 1')).toBeTruthy();
		expect(screen.getByLabelText('Page 5')).toBeTruthy();
		expect(screen.getByText('1–10 of 50')).toBeTruthy();
	});

	it('marks the active page with aria-current="page"', () => {
		render(<GridPagination page={2} pageCount={5} onPageChange={() => {}} />);
		const activeBtn = screen.getByLabelText('Page 3');
		expect(activeBtn.getAttribute('aria-current')).toBe('page');
	});

	it('disables prev button on first page', () => {
		render(<GridPagination page={0} pageCount={5} onPageChange={() => {}} />);
		const prev = screen.getByLabelText('Previous page') as HTMLButtonElement;
		expect(prev.disabled).toBe(true);
	});

	it('disables next button on last page', () => {
		render(<GridPagination page={4} pageCount={5} onPageChange={() => {}} />);
		const next = screen.getByLabelText('Next page') as HTMLButtonElement;
		expect(next.disabled).toBe(true);
	});

	it('calls onPageChange with correct page index when clicking a page button', () => {
		const onChange = vi.fn();
		render(<GridPagination page={0} pageCount={5} onPageChange={onChange} />);
		fireEvent.click(screen.getByLabelText('Page 3'));
		expect(onChange).toHaveBeenCalledWith(2);
	});

	it('calls onPageChange with page - 1 when clicking prev', () => {
		const onChange = vi.fn();
		render(<GridPagination page={2} pageCount={5} onPageChange={onChange} />);
		fireEvent.click(screen.getByLabelText('Previous page'));
		expect(onChange).toHaveBeenCalledWith(1);
	});

	it('calls onPageChange with page + 1 when clicking next', () => {
		const onChange = vi.fn();
		render(<GridPagination page={2} pageCount={5} onPageChange={onChange} />);
		fireEvent.click(screen.getByLabelText('Next page'));
		expect(onChange).toHaveBeenCalledWith(3);
	});

	it('collapses to ellipsis when pageCount exceeds maxPageButtons', () => {
		render(<GridPagination page={10} pageCount={20} onPageChange={() => {}} maxPageButtons={7} />);
		// Should have exactly two ellipsis spans
		const container = screen.getByRole('navigation');
		const ellipses = within(container).getAllByText('…');
		expect(ellipses.length).toBe(2);
	});

	it('renders custom prev/next button content', () => {
		render(
			<GridPagination
				page={1}
				pageCount={5}
				onPageChange={() => {}}
				renderPrevButton={() => <span>PREV</span>}
				renderNextButton={() => <span>NEXT</span>}
			/>
		);
		expect(screen.getByText('PREV')).toBeTruthy();
		expect(screen.getByText('NEXT')).toBeTruthy();
	});

	it('renders custom page info via renderPageInfo', () => {
		render(
			<GridPagination page={1} pageCount={5} onPageChange={() => {}} renderPageInfo={(p, total) => <span>{`custom:${p}/${total}`}</span>} />
		);
		expect(screen.getByText('custom:1/5')).toBeTruthy();
	});

	it('shows "Page X of Y" fallback when totalRows/pageSize are absent', () => {
		render(<GridPagination page={1} pageCount={5} onPageChange={() => {}} />);
		expect(screen.getByText('Page 2 of 5')).toBeTruthy();
	});
});

// ─── useClientGridPagination ──────────────────────────────────────────────────

describe('useClientGridPagination', () => {
	function PaginationHarness<T>({ rows, pageSize }: { rows: T[]; pageSize: number }) {
		const result = useClientGridPagination(rows, { pageSize });
		return (
			<div>
				<span data-testid='page'>{result.page}</span>
				<span data-testid='pageCount'>{result.pageCount}</span>
				<span data-testid='totalRows'>{result.totalRows}</span>
				<span data-testid='pageRowsLength'>{result.pageRows.length}</span>
				<span data-testid='canNext'>{String(result.canNextPage)}</span>
				<span data-testid='canPrev'>{String(result.canPrevPage)}</span>
				<button onClick={result.nextPage}>next</button>
				<button onClick={result.prevPage}>prev</button>
				<button onClick={() => result.setPage(0)}>first</button>
			</div>
		);
	}

	it('starts on page 0 with correct slice', () => {
		const rows = Array.from({ length: 25 }, (_, i) => i);
		render(<PaginationHarness rows={rows} pageSize={10} />);
		expect(screen.getByTestId('page').textContent).toBe('0');
		expect(screen.getByTestId('pageCount').textContent).toBe('3');
		expect(screen.getByTestId('pageRowsLength').textContent).toBe('10');
	});

	it('nextPage advances the page', () => {
		const rows = Array.from({ length: 25 }, (_, i) => i);
		render(<PaginationHarness rows={rows} pageSize={10} />);
		act(() => {
			fireEvent.click(screen.getByText('next'));
		});
		expect(screen.getByTestId('page').textContent).toBe('1');
		expect(screen.getByTestId('pageRowsLength').textContent).toBe('10');
	});

	it('last page has a partial slice', () => {
		const rows = Array.from({ length: 25 }, (_, i) => i);
		render(<PaginationHarness rows={rows} pageSize={10} />);
		act(() => {
			fireEvent.click(screen.getByText('next'));
		});
		act(() => {
			fireEvent.click(screen.getByText('next'));
		});
		expect(screen.getByTestId('page').textContent).toBe('2');
		expect(screen.getByTestId('pageRowsLength').textContent).toBe('5');
		expect(screen.getByTestId('canNext').textContent).toBe('false');
	});

	it('canPrevPage is false on first page, true after next', () => {
		const rows = Array.from({ length: 25 }, (_, i) => i);
		render(<PaginationHarness rows={rows} pageSize={10} />);
		expect(screen.getByTestId('canPrev').textContent).toBe('false');
		act(() => {
			fireEvent.click(screen.getByText('next'));
		});
		expect(screen.getByTestId('canPrev').textContent).toBe('true');
	});

	it('prevPage does not go below 0', () => {
		const rows = Array.from({ length: 10 }, (_, i) => i);
		render(<PaginationHarness rows={rows} pageSize={10} />);
		act(() => {
			fireEvent.click(screen.getByText('prev'));
		});
		expect(screen.getByTestId('page').textContent).toBe('0');
	});

	it('clamps page when rows shrink', () => {
		const { rerender } = render(<PaginationHarness rows={Array.from({ length: 30 }, (_, i) => i)} pageSize={10} />);
		act(() => {
			fireEvent.click(screen.getByText('next'));
		});
		act(() => {
			fireEvent.click(screen.getByText('next'));
		});
		expect(screen.getByTestId('page').textContent).toBe('2');
		// Shrink rows so page 2 no longer exists
		rerender(<PaginationHarness rows={Array.from({ length: 5 }, (_, i) => i)} pageSize={10} />);
		expect(screen.getByTestId('page').textContent).toBe('0');
	});

	it('handles empty rows', () => {
		render(<PaginationHarness rows={[]} pageSize={10} />);
		expect(screen.getByTestId('pageCount').textContent).toBe('1');
		expect(screen.getByTestId('totalRows').textContent).toBe('0');
		expect(screen.getByTestId('pageRowsLength').textContent).toBe('0');
	});
});

describe('Grid pagination prop', () => {
	it('paginates client rows without requiring a separate pagination component', async () => {
		const rows: TestRow[] = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
			{ id: '3', name: 'Cara' },
			{ id: '4', name: 'Dane' },
			{ id: '5', name: 'Elle' },
		];

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					mode='client'
					rows={rows}
					columns={[{ field: 'name', header: 'Name', width: 120 }]}
					getRowId={(row: TestRow) => row.id}
					enableNavigation={false}
					pagination={{ pageSize: 2 }}
				/>
			</div>
		);

		await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
		expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
		expect(screen.queryByText('Cara')).toBeNull();

		fireEvent.click(screen.getByLabelText('Page 2'));

		await waitFor(() => expect(screen.getByText('Cara')).toBeTruthy());
		expect(screen.queryByText('Alice')).toBeNull();
		expect(screen.getByText((content) => content.includes('of 5'))).toBeTruthy();
	});

	it('paginates server rows and shifts datasource fetches by page automatically', async () => {
		const rows: TestRow[] = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
			{ id: '3', name: 'Cara' },
			{ id: '4', name: 'Dane' },
			{ id: '5', name: 'Elle' },
		];
		const getRows = vi.fn(async ({ startRow, endRow }: { startRow: number; endRow: number }) => ({
			rows: rows.slice(startRow, endRow),
			totalCount: rows.length,
		}));

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					mode='server'
					columns={[{ field: 'name', header: 'Name', width: 120 }]}
					datasource={{ getRows }}
					getRowId={(row: TestRow) => row.id}
					blockSize={2}
					enableNavigation={false}
					pagination={{ pageSize: 2 }}
				/>
			</div>
		);

		await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
		expect(getRows.mock.calls.some(([params]) => params.startRow === 0 && params.endRow === 2)).toBe(true);

		await waitFor(() => expect(screen.getByLabelText('Page 2')).toBeTruthy());
		fireEvent.click(screen.getByLabelText('Page 2'));

		await waitFor(() => expect(getRows.mock.calls.some(([params]) => params.startRow === 2 && params.endRow === 4)).toBe(true));
		await waitFor(() => expect(screen.getByText('Cara')).toBeTruthy());
		expect(screen.queryByText('Alice')).toBeNull();
	});
});

describe('explicit React entrypoints', () => {
	it('exposes Grid as the only public grid entrypoint', () => {
		expect(ReactPackage.Grid).toBeDefined();
		expect((ReactPackage as Record<string, unknown>).GridView).toBeUndefined();
		expect((ReactPackage as Record<string, unknown>).GridProvider).toBeUndefined();
		expect((ReactPackage as Record<string, unknown>).useOwnedClientGrid).toBeUndefined();
		expect((ReactPackage as Record<string, unknown>).useOwnedServerGrid).toBeUndefined();
	});

	it('Grid owns the api and fires onGridReady while descendants can still read useGridApi', async () => {
		const onGridReady = vi.fn();
		const HookRenderer = () => {
			const api = useGridApi<TestRow>();
			return <span data-testid='api-hook'>{api ? 'yes' : 'no'}</span>;
		};

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					mode='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[
						{
							field: 'name',
							header: 'Name',
							width: 100,
							renderer: { kind: 'react', component: HookRenderer },
						},
					]}
					enableNavigation={false}
					onGridReady={onGridReady}
				/>
			</div>
		);

		await waitFor(() => expect(onGridReady).toHaveBeenCalledTimes(1));
		expect(onGridReady.mock.calls[0][0]).toEqual(expect.objectContaining({ mode: 'client' }));
		expect(screen.getByTestId('api-hook').textContent).toBe('yes');
	});

	it('GridView renders against an explicit api', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Alice' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		render(
			<div style={{ width: 400, height: 300 }}>
				<GridProvider api={grid.api}>
					<GridView api={grid.api} enableNavigation={false} />
				</GridProvider>
			</div>
		);

		await act(async () => {});
		grid.api.destroy();
	});

	it('Grid can own its api directly', async () => {
		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					mode='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[{ field: 'name', header: 'Name', width: 100 }]}
					enableNavigation={false}
				/>
			</div>
		);

		await act(async () => {});
	});

	it('GridStatusBar reflects selection and edit state from context', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: '1', name: 'Alice' },
				{ id: '2', name: 'Bob' },
			],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const { container } = render(
			<GridProvider api={grid.api}>
				<GridStatusBar />
			</GridProvider>
		);

		expect(container.textContent).toContain('2 rows');
		expect(container.textContent).toContain('2 visible');
		expect(container.textContent).toContain('0 selected');
		expect(container.textContent).toContain('Ready');

		act(() => {
			grid.api.selectRows(['1']);
			grid.api.startEditing('1', 'name');
		});

		expect(container.textContent).toContain('1 selected');
		expect(container.textContent).toContain('Editing 1:name');

		grid.api.destroy();
	});
});

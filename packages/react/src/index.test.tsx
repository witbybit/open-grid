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
});

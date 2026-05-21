// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GridStore, GridNavigationController, ClientRowModelController } from '@open-grid/core';
import { GridProvider, Cell, useCellEditState, useGridNavigationController, useGridKeySelector, useGridDimensions } from './index.js';

interface TestRow {
	id: string;
	name: string;
}

const HookInspector = ({ rowId, colField }: { rowId: string; colField: string }) => {
	const { isEditing } = useCellEditState<TestRow>(rowId, colField);
	return (
		<div>
			<span data-testid='is-editing'>{isEditing ? 'yes' : 'no'}</span>
		</div>
	);
};

const DimensionsInspector = () => {
	const { leftPinnedWidth, rightPinnedWidth, totalWidth, totalHeight, leftPinnedCols, rightPinnedCols, centerCols, visibleRows } =
		useGridDimensions<any>({
			pinLeftColumns: 1,
			pinRightColumns: 1,
		});

	return (
		<div>
			<div data-testid='left-pinned-width'>{leftPinnedWidth}</div>
			<div data-testid='right-pinned-width'>{rightPinnedWidth}</div>
			<div data-testid='total-width'>{totalWidth}</div>
			<div data-testid='total-height'>{totalHeight}</div>
			<div data-testid='left-cols-count'>{leftPinnedCols.length}</div>
			<div data-testid='right-cols-count'>{rightPinnedCols.length}</div>
			<div data-testid='center-cols-count'>{centerCols.length}</div>
			<div data-testid='visible-rows-count'>{visibleRows.length}</div>
		</div>
	);
};

const NavigationControllerOwner = ({ onCellValueChanged }: { onCellValueChanged: (rowId: string, colField: string, val: unknown) => void }) => {
	useGridNavigationController<TestRow>({ onCellValueChanged });
	return null;
};

describe('React Bindings hooks and components', () => {
	it('should yield correct editing state via useCellEditState hook', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});

		render(
			<GridProvider store={store}>
				<HookInspector rowId='1' colField='name' />
			</GridProvider>
		);

		expect(screen.getByTestId('is-editing').textContent).toBe('no');

		// Act: Enter edit mode programmatically
		act(() => {
			store.setState({
				activeEdit: {
					rowId: '1',
					colField: 'name',
				},
			});
		});

		expect(screen.getByTestId('is-editing').textContent).toBe('yes');

		controller.dispose();
	});

	it('should render standard Cell in view mode and transition to edit mode on blur/onKeyDown', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Cell Content' }],
			columns: store.getState().columns,
		});
		const navigation = new GridNavigationController<TestRow>({});
		store.registerFeature(navigation);

		render(
			<GridProvider store={store}>
				<Cell rowId='1' colField='name' />
			</GridProvider>
		);

		// Assert: cell displays text
		expect(screen.getByText('Cell Content')).toBeDefined();

		// Act: Enter editing mode programmatically
		act(() => {
			navigation.setCellEditing('1', 'name', true);
		});

		// Assert: cell displays input
		const input = screen.getByRole('textbox') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.value).toBe('Cell Content');

		// Act: Type value in input
		fireEvent.change(input, { target: { value: 'Cell Value Mod' } });

		// Act: Blur the input
		fireEvent.blur(input);

		// Assert: should exit editing and commit changes immediately
		expect(store.getState().activeEdit).toBeNull();
		expect(store.getCellValue('1', 'name')).toBe('Cell Value Mod');
		expect(screen.queryByRole('textbox')).toBeNull();

		controller.dispose();
	});

	it('should ignore event objects passed to onCommit and commit the correct local value', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellEditor: ({ value, onChange, onCommit }) => (
						<input data-testid='custom-editor' value={value as string} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} />
					),
				},
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Original Name' }],
			columns: store.getState().columns,
		});
		const navigation = new GridNavigationController<TestRow>({});
		store.registerFeature(navigation);

		render(
			<GridProvider store={store}>
				<Cell rowId='1' colField='name' />
			</GridProvider>
		);

		// Enter editing mode programmatically
		act(() => {
			navigation.setCellEditing('1', 'name', true);
		});

		const input = screen.getByTestId('custom-editor') as HTMLInputElement;
		expect(input.value).toBe('Original Name');

		// Type value
		fireEvent.change(input, { target: { value: 'Successfully Edited!' } });

		// Trigger blur, passing FocusEvent to onCommit
		fireEvent.blur(input);

		// Assert: should ignore event object, exit editing, and commit correct string value
		expect(store.getState().activeEdit).toBeNull();
		expect(store.getCellValue('1', 'name')).toBe('Successfully Edited!');

		controller.dispose();
	});

	it('should stop keydown propagation and commit/cancel on Enter and Escape', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Cell Content' }],
			columns: store.getState().columns,
		});
		const navigation = new GridNavigationController<TestRow>({});
		store.registerFeature(navigation);

		render(
			<GridProvider store={store}>
				<Cell rowId='1' colField='name' />
			</GridProvider>
		);

		// Activate edit mode
		act(() => {
			navigation.setCellEditing('1', 'name', true);
		});

		const input = screen.getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Modified Content' } });

		// Track propagation
		const keydownSpy = vi.fn();
		window.addEventListener('keydown', keydownSpy);

		// Press Enter key on input
		fireEvent.keyDown(input, { key: 'Enter' });

		// Assert: Enter event propagation is stopped and edit is committed
		expect(keydownSpy).not.toHaveBeenCalled();
		expect(store.getState().activeEdit).toBeNull();
		expect(store.getCellValue('1', 'name')).toBe('Modified Content');

		// Re-enter edit mode
		act(() => {
			navigation.setCellEditing('1', 'name', true);
		});

		const input2 = screen.getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input2, { target: { value: 'Reverted Content' } });

		// Press Escape key on input
		fireEvent.keyDown(input2, { key: 'Escape' });

		// Assert: Escape event propagation is stopped and edit is cancelled
		expect(keydownSpy).not.toHaveBeenCalled();
		expect(store.getState().activeEdit).toBeNull();
		expect(store.getCellValue('1', 'name')).toBe('Modified Content'); // value reverted to last committed

		// Clean up global listener
		window.removeEventListener('keydown', keydownSpy);
		controller.dispose();
	});

	it('should commit the current changes on arrow navigation from the cell when editing', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [
				{ id: '1', name: 'Original One' },
				{ id: '2', name: 'Original Two' },
			],
			columns: store.getState().columns,
		});
		const navigation = new GridNavigationController<TestRow>({});
		store.registerFeature(navigation);

		render(
			<GridProvider store={store}>
				<Cell rowId='1' colField='name' />
				<Cell rowId='2' colField='name' />
			</GridProvider>
		);

		// Focus the cell and activate edit mode
		act(() => {
			store.setState({
				focusedCell: { rowId: '1', colField: 'name' },
			});
			navigation.setCellEditing('1', 'name', true);
		});

		const input = screen.getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Modified One' } });

		// Simulate ArrowDown keypress (navigation to cell 2)
		act(() => {
			navigation.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
		});

		// Assert: should exit editing, commit changes to store, and move focus to cell 2
		expect(store.getState().activeEdit).toBeNull();
		expect(store.getCellValue('1', 'name')).toBe('Modified One');
		expect(store.getState().focusedCell).toEqual({ rowId: '2', colField: 'name' });

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

	it('should instantly re-render Cell components when dependent values trigger dynamic valueGetters', () => {
		interface RecipeRow {
			id: string;
			price: number;
			qty: number;
		}

		const store = new GridStore<RecipeRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'price', header: 'Price', width: 50 },
				{ field: 'qty', header: 'Qty', width: 50 },
				{
					field: 'subtotal',
					header: 'Subtotal',
					width: 80,
					valueGetter: ({ row }) => `$${row.price * row.qty}`,
				},
			],
		});
		const controller = new ClientRowModelController<RecipeRow>(store, {
			rows: [{ id: 'cake', price: 10, qty: 2 }],
			columns: store.getState().columns,
		});

		const navigation = new GridNavigationController<RecipeRow>({});
		store.registerFeature(navigation);

		render(
			<GridProvider store={store}>
				<Cell rowId='cake' colField='subtotal' />
			</GridProvider>
		);

		// 1. Verify initial subtotal ($20) is rendered
		expect(screen.getByText('$20')).toBeDefined();

		// 2. Mutate price programmatically (flush sync since batching is always on)
		act(() => {
			store.setCellValue('cake', 'price', 25);
			store.flushCellUpdatesSync();
		});

		// 3. Subtotal should immediately update to $50 and re-render without user focus/clicking!
		expect(screen.getByText('$50')).toBeDefined();

		controller.dispose();
	});

	it('should NOT re-render other rows or virtual rows during editing or focus transitions', () => {
		let virtualRowRenderCount = 0;
		const TestVirtualRow = React.memo(({ rowIndex, id }: { rowIndex: number; id: string }) => {
			virtualRowRenderCount++;
			// Subscribe to dataVersion exactly like VirtualRow in demo
			useGridKeySelector('dataVersion', (state) => state.dataVersion);
			return <Cell rowId={id} colField='name' />;
		});

		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [
				{ id: '1', name: 'Row 1' },
				{ id: '2', name: 'Row 2' },
				{ id: '3', name: 'Row 3' },
			],
			columns: store.getState().columns,
		});
		const navigation = new GridNavigationController<TestRow>({
			onCellValueChanged: (rowId, colField, val) => {
				controller.updateRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, [colField]: val as string } : row)));
			},
		});
		store.registerFeature(navigation);

		render(
			<GridProvider store={store}>
				<div>
					<TestVirtualRow rowIndex={0} id='1' />
					<TestVirtualRow rowIndex={1} id='2' />
					<TestVirtualRow rowIndex={2} id='3' />
				</div>
			</GridProvider>
		);

		// Record initial render count (should be 3)
		expect(virtualRowRenderCount).toBe(3);

		// Act 1: Focus cell 1:name
		act(() => {
			store.setFocusedCell('1', 'name');
		});

		// Verify no virtual rows re-rendered!
		expect(virtualRowRenderCount).toBe(3);

		// Act 2: Start editing cell 1:name
		act(() => {
			navigation.setCellEditing('1', 'name', true);
		});

		// Verify no virtual rows re-rendered!
		expect(virtualRowRenderCount).toBe(3);

		// Act 3: Stop editing cell 1:name
		act(() => {
			navigation.setCellEditing('1', 'name', false);
		});

		// Verify no virtual rows re-rendered!
		expect(virtualRowRenderCount).toBe(3);

		// Act 4: Actually edit the cell value and commit
		act(() => {
			store.setCellValue('1', 'name', 'Row 1 Mod');
		});

		// Verify no virtual rows re-rendered!
		expect(virtualRowRenderCount).toBe(3);

		controller.dispose();
	});

	it('should compute grid dimensions, scroll tracking, and pinned lanes via useGridDimensions', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 100 },
				{ field: 'age', header: 'Age', width: 80 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [
				{ id: '1', name: 'Row 1' },
				{ id: '2', name: 'Row 2' },
				{ id: '3', name: 'Row 3' },
			],
			columns: store.getState().columns,
		});
		const navigation = new GridNavigationController<TestRow>({});
		store.registerFeature(navigation);

		// Set viewport size manually on viewportController to simulate visible viewport bounds
		store.viewportController.setViewportSize(200, 100);

		render(
			<GridProvider store={store}>
				<DimensionsInspector />
			</GridProvider>
		);

		// With pinLeftColumns=1, pinRightColumns=1, and 3 total columns (width 50, 100, 80):
		// Left pinned width: col 0 (width 50) => 50
		// Right pinned width: col 2 (width 80) => 80
		// Center column: col 1 (width 100)
		expect(screen.getByTestId('left-pinned-width').textContent).toBe('50');
		expect(screen.getByTestId('right-pinned-width').textContent).toBe('80');
		expect(screen.getByTestId('left-cols-count').textContent).toBe('1');
		expect(screen.getByTestId('right-cols-count').textContent).toBe('1');

		// Clean up
		controller.dispose();
	});
});

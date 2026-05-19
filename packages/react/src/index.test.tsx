// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GridStore, GridNavigationController } from '@open-grid/core';
import { GridProvider, Cell, useCellEditState, useGridNavigationController } from './index.js';

// Simple Hook Inspector Component to test useCellEditState
const HookInspector = ({ row, col }: { row: number; col: number }) => {
	const { isEditing, value, setValue } = useCellEditState(row, col);
	return (
		<div>
			<span data-testid='is-editing'>{isEditing ? 'yes' : 'no'}</span>
			<span data-testid='edit-value'>{value}</span>
			<button data-testid='set-value-btn' onClick={() => setValue('New Keystroke!')}>
				Set Value
			</button>
		</div>
	);
};

const NavigationControllerOwner = ({ onCellValueChanged }: { onCellValueChanged: (row: number, col: number, val: any) => void }) => {
	useGridNavigationController({ onCellValueChanged });
	return null;
};

describe('React Bindings hooks and components', () => {
	it('should yield correct editing state via useCellEditState hook', () => {
		const store = new GridStore({ rowCount: 5, colCount: 5 });

		const { rerender } = render(
			<GridProvider store={store}>
				<HookInspector row={0} col={0} />
			</GridProvider>
		);

		expect(screen.getByTestId('is-editing').textContent).toBe('no');
		expect(screen.getByTestId('edit-value').textContent).toBe('');

		// Act: Enter edit mode programmatically
		act(() => {
			store.setState({
				activeEditCell: { row: 0, col: 0 },
				activeEditValue: 'Initial Edit',
			});
		});

		expect(screen.getByTestId('is-editing').textContent).toBe('yes');
		expect(screen.getByTestId('edit-value').textContent).toBe('Initial Edit');

		// Act: Simulate typing
		fireEvent.click(screen.getByTestId('set-value-btn'));
		expect(store.getState().activeEditValue).toBe('New Keystroke!');
	});

	it('should render standard Cell in view mode and transition to edit mode on blur/onKeyDown', () => {
		const store = new GridStore({ rowCount: 5, colCount: 5 });
		const navigation = new GridNavigationController(store);

		// Initialize cell 0,0 value
		store.setCellValue(0, 0, 'Cell Content');

		render(
			<GridProvider store={store}>
				<Cell row={0} col={0} navigation={navigation} />
			</GridProvider>
		);

		// Assert: cell displays text
		expect(screen.getByText('Cell Content')).toBeDefined();

		// Act: Enter editing mode programmatically
		act(() => {
			navigation.setCellEditing(0, 0, true);
		});

		// Assert: cell displays input
		const input = screen.getByRole('textbox') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.value).toBe('Cell Content');

		// Act: Type value in input
		fireEvent.change(input, { target: { value: 'Cell Value Mod' } });
		expect(store.getState().activeEditValue).toBe('Cell Value Mod');

		// Act: Blur the input
		fireEvent.blur(input);

		// Assert: should exit editing and commit changes immediately (without setTimeout!)
		expect(store.getState().activeEditCell).toBeNull();
		expect(store.getCellState(0, 0).value).toBe('Cell Value Mod');
		expect(screen.queryByRole('textbox')).toBeNull();
	});

	it('should stop keydown propagation and commit/cancel on Enter and Escape', () => {
		const store = new GridStore({ rowCount: 5, colCount: 5 });
		const navigation = new GridNavigationController(store);
		store.setCellValue(0, 0, 'Cell Content');

		render(
			<GridProvider store={store}>
				<Cell row={0} col={0} navigation={navigation} />
			</GridProvider>
		);

		// Activate edit mode
		act(() => {
			navigation.setCellEditing(0, 0, true);
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
		expect(store.getState().activeEditCell).toBeNull();
		expect(store.getCellState(0, 0).value).toBe('Modified Content');

		// Re-enter edit mode
		act(() => {
			navigation.setCellEditing(0, 0, true);
		});

		const input2 = screen.getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input2, { target: { value: 'Reverted Content' } });

		// Press Escape key on input
		fireEvent.keyDown(input2, { key: 'Escape' });

		// Assert: Escape event propagation is stopped and edit is cancelled
		expect(keydownSpy).not.toHaveBeenCalled();
		expect(store.getState().activeEditCell).toBeNull();
		expect(store.getCellState(0, 0).value).toBe('Modified Content'); // value reverted to last committed

		// Clean up global listener
		window.removeEventListener('keydown', keydownSpy);
	});

	it('should dispose navigation controller event listeners on unmount', () => {
		const store = new GridStore({ rowCount: 5, colCount: 5 });
		const onCellValueChanged = vi.fn();

		const { unmount } = render(
			<GridProvider store={store}>
				<NavigationControllerOwner onCellValueChanged={onCellValueChanged} />
			</GridProvider>
		);

		unmount();

		act(() => {
			store.setCellValue(0, 0, 'After unmount');
		});

		expect(onCellValueChanged).not.toHaveBeenCalled();
	});
});

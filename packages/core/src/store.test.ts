import { describe, it, expect, vi } from 'vitest';
import { GridStore } from './store.js';

describe('GridStore micro-store functionality', () => {
	it('should initialize with standard default states', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const state = store.getState();

		expect(state.rowCount).toBe(10);
		expect(state.colCount).toBe(5);
		expect(state.focusedCell).toBeNull();
		expect(state.selectedRange).toBeNull();
		expect(state.cells).toEqual({});
	});

	it('should notify targeted key-subscribers only when that specific key is mutated', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });

		const cellListener = vi.fn();
		const focusListener = vi.fn();

		// Subscribe to specific cell coordinate key and focusedCell key
		store.subscribeToKey('cell:0,0', cellListener);
		store.subscribeToKey('focusedCell', focusListener);

		// Act: Set focused cell
		store.setState({ focusedCell: { row: 0, col: 0 } });

		// Assert: focusedCell subscriber fires, cell subscriber does not
		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(cellListener).toHaveBeenCalledTimes(0);

		// Act: Change value of cell 0,0
		store.setCellValue(0, 0, 'Laser Product');

		// Assert: cell subscriber fires, focusedCell subscriber does not fire again
		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(cellListener).toHaveBeenCalledTimes(1);
		expect(store.getCellState(0, 0).value).toBe('Laser Product');
	});

	it('should return default cell values for uninitialized grid coordinates safely', () => {
		const store = new GridStore();
		const cell = store.getCellState(100, 100);

		expect(cell.value).toBe('');
		expect(cell.computedValue).toBe('');
		expect(cell.isEditing).toBe(false);
	});

	it('should support pluggable events and column resizing updates through GridApi', () => {
		const store = new GridStore({ rowCount: 5, colCount: 5 });

		const valueListener = vi.fn();
		const resizeListener = vi.fn();

		// Bind listeners
		store.addEventListener('cellValueChanged', valueListener);
		store.addEventListener('columnResized', resizeListener);

		// Act 1: Resize column 1 to 150px
		store.setColumnWidth(1, 150);
		expect(store.getState().colWidths[1]).toBe(150);
		expect(resizeListener).toHaveBeenCalledTimes(1);
		expect(resizeListener).toHaveBeenCalledWith({
			type: 'columnResized',
			payload: { col: 1, width: 150 },
		});

		// Act 2: Modify cell value
		store.setCellValue(0, 1, 'Neon stand');
		expect(valueListener).toHaveBeenCalledTimes(1);
		expect(valueListener).toHaveBeenCalledWith({
			type: 'cellValueChanged',
			payload: { row: 0, col: 1, oldValue: '', newValue: 'Neon stand' },
		});
	});
});

import { GridNavigationController } from './navigation.js';

describe('GridNavigationController E2E Simulation', () => {
	it('should successfully update focused cell on ArrowDown navigation', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store);

		// 1. Simulate mouse click on Row 0, Col 0
		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		expect(store.getState().focusedCell).toEqual({ row: 0, col: 0 });

		// 2. Simulate ArrowDown key down event
		controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as any);

		// 3. Verify that focusedCell has successfully navigated to Row 1, Col 0!
		expect(store.getState().focusedCell).toEqual({ row: 1, col: 0 });
	});

	it('should enter edit mode on double click setCellEditing', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store);

		// Simulate first click to focus
		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		expect(store.getState().focusedCell).toEqual({ row: 0, col: 0 });

		// Simulate double-click event triggering setCellEditing
		controller.setCellEditing(0, 0, true);
		expect(store.getState().activeEditCell).toEqual({ row: 0, col: 0 });
	});

	it('should navigate and open the next cell in edit mode if arrowKeyNavigationEdit is true in view mode', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store, { arrowKeyNavigationEdit: true });

		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as any);

		expect(store.getState().focusedCell).toEqual({ row: 1, col: 0 });
		expect(store.getState().activeEditCell).toEqual({ row: 1, col: 0 });
	});

	it('should navigate and open the next cell in view mode if arrowKeyNavigationEdit is false in view mode', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store, { arrowKeyNavigationEdit: false });

		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as any);

		expect(store.getState().focusedCell).toEqual({ row: 1, col: 0 });
		expect(store.getState().activeEditCell).toBeNull();
	});

	it('should navigate and open the next cell in edit mode if arrowKeyNavigationEdit is true in edit mode', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store, { arrowKeyNavigationEdit: true });

		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		controller.setCellEditing(0, 0, true);
		expect(store.getState().activeEditCell).toEqual({ row: 0, col: 0 });

		controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as any);
		expect(store.getState().focusedCell).toEqual({ row: 1, col: 0 });
		expect(store.getState().activeEditCell).toEqual({ row: 1, col: 0 });
	});

	it('should navigate and open the next cell in view mode if arrowKeyNavigationEdit is false in edit mode on ArrowDown', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store, { arrowKeyNavigationEdit: false });

		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		controller.setCellEditing(0, 0, true);
		expect(store.getState().activeEditCell).toEqual({ row: 0, col: 0 });

		controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as any);
		expect(store.getState().focusedCell).toEqual({ row: 1, col: 0 });
		expect(store.getState().activeEditCell).toBeNull();
	});

	it('should NOT navigate or commit edit on ArrowLeft/ArrowRight if arrowKeyNavigationEdit is false in edit mode', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store, { arrowKeyNavigationEdit: false });

		controller.handleMouseDown(0, 1, { button: 0, detail: 1 } as any);
		controller.setCellEditing(0, 1, true);
		expect(store.getState().activeEditCell).toEqual({ row: 0, col: 1 });

		// Simulate ArrowLeft keydown
		const mockEvent = { key: 'ArrowLeft', preventDefault: vi.fn() } as any;
		controller.handleKeyDown(mockEvent);

		// Should NOT have navigated and should still be editing (0,1)
		expect(store.getState().focusedCell).toEqual({ row: 0, col: 1 });
		expect(store.getState().activeEditCell).toEqual({ row: 0, col: 1 });
		expect(mockEvent.preventDefault).not.toHaveBeenCalled();
	});

	it('should navigate and commit edit on ArrowLeft/ArrowRight if arrowKeyNavigationEdit is true in edit mode', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store, { arrowKeyNavigationEdit: true });

		controller.handleMouseDown(0, 1, { button: 0, detail: 1 } as any);
		controller.setCellEditing(0, 1, true);
		expect(store.getState().activeEditCell).toEqual({ row: 0, col: 1 });

		// Simulate ArrowLeft keydown
		const mockEvent = { key: 'ArrowLeft', preventDefault: vi.fn() } as any;
		controller.handleKeyDown(mockEvent);

		// Should have navigated to (0,0) and entered edit mode
		expect(store.getState().focusedCell).toEqual({ row: 0, col: 0 });
		expect(store.getState().activeEditCell).toEqual({ row: 0, col: 0 });
		expect(mockEvent.preventDefault).toHaveBeenCalled();
	});

	it('should NOT trigger edit mode on mouse down but should trigger on click when editTrigger is singleClick and no drag occurred', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store, { editTrigger: 'singleClick' });

		// Mouse down should focus but NOT edit
		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		expect(store.getState().focusedCell).toEqual({ row: 0, col: 0 });
		expect(store.getState().activeEditCell).toBeNull();

		// Click on single cell should enter edit mode
		controller.handleClick(0, 0, {} as any);
		expect(store.getState().activeEditCell).toEqual({ row: 0, col: 0 });
	});

	it('should NOT trigger edit mode on click in singleClick mode if a multi-cell range drag occurred', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store, { editTrigger: 'singleClick' });

		// Mouse down starts selection
		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		// Drag to another cell
		controller.handleMouseEnter(1, 1);

		// Verify multi-cell selection is active
		expect(store.getState().selectedRange).toEqual({
			start: { row: 0, col: 0 },
			end: { row: 1, col: 1 },
		});

		// Click (releasing selection) should NOT trigger edit mode
		controller.handleClick(0, 0, {} as any);
		expect(store.getState().activeEditCell).toBeNull();
	});

	it('should support stopEditing API to commit or cancel cell edit state correctly', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store);

		// Focus and edit cell 0,0
		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		controller.setCellEditing(0, 0, true);
		store.setState({ activeEditValue: 'New value' });

		// Act: stopEditing with cancel=true
		store.stopEditing(true);

		// Assert: editing stopped, value reverted
		expect(store.getState().activeEditCell).toBeNull();
		expect(store.getCellState(0, 0).isEditing).toBe(false);
		expect(store.getCellState(0, 0).value).toBe('');

		// Focus and edit cell 0,0 again
		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		controller.setCellEditing(0, 0, true);
		store.setState({ activeEditValue: 'Committed value' });

		// Act: stopEditing with cancel=false
		store.stopEditing(false);

		// Assert: editing stopped, value committed
		expect(store.getState().activeEditCell).toBeNull();
		expect(store.getCellState(0, 0).isEditing).toBe(false);
		expect(store.getCellState(0, 0).value).toBe('Committed value');
	});

	it('should ensure focused cell in edit mode goes to non-edit on stopEditing', () => {
		const store = new GridStore({ rowCount: 10, colCount: 5 });
		const controller = new GridNavigationController(store);

		// Focus cell 0,0 and set it to editing
		controller.handleMouseDown(0, 0, { button: 0, detail: 1 } as any);
		controller.setCellEditing(0, 0, true);

		// Clear activeEditCell manually but leave focusedCell and isEditing in cells
		store.setState({ activeEditCell: null });

		expect(store.getState().focusedCell).toEqual({ row: 0, col: 0 });
		expect(store.getCellState(0, 0).isEditing).toBe(true);

		// Act
		store.stopEditing();

		// Assert
		expect(store.getCellState(0, 0).isEditing).toBe(false);
	});
});

import { GridStore, GridCellCoordinate } from './store.js';

export interface GridNavigationOptions {
	onCellValueChanged?: (row: number, col: number, val: any) => void;
	editTrigger?: 'singleClick' | 'doubleClick'; // default: 'doubleClick'
	arrowKeyNavigationEdit?: boolean; // default: false
}

export class GridNavigationController {
	private store: GridStore;
	private isSelecting = false;
	private rangeStart: GridCellCoordinate | null = null;
	private options: GridNavigationOptions;

	constructor(store: GridStore, options: GridNavigationOptions = {}) {
		this.store = store;
		this.options = options;

		// Bind store event listener to invoke options callback when edits are committed
		if (this.options.onCellValueChanged) {
			this.store.addEventListener('cellValueChanged', (event) => {
				const { row, col, newValue } = event.payload;
				this.options.onCellValueChanged?.(row, col, newValue);
			});
		}
	}

	/**
	 * Handle standard keyboard movements and selection expansions.
	 */
	public handleKeyDown = (event: KeyboardEvent): void => {
		console.log('[GridEngine] handleKeyDown event:', event.key);
		const state = this.store.getState();
		const active = state.focusedCell;
		console.log('[GridEngine] focusedCell state:', active);
		if (!active) return;

		const row = active.row;
		const col = active.col;
		const maxRow = state.rowCount - 1;
		const maxCol = state.colCount - 1;

		const cellState = this.store.getCellState(row, col);
		const isEditing = cellState.isEditing;

		// 1. Navigation logic when NOT in cell editing mode
		if (!isEditing) {
			let nextRow = row;
			let nextCol = col;
			let handled = false;

			switch (event.key) {
				case 'ArrowUp':
					nextRow = Math.max(0, row - 1);
					handled = true;
					break;
				case 'ArrowDown':
					nextRow = Math.min(maxRow, row + 1);
					handled = true;
					break;
				case 'ArrowLeft':
					nextCol = Math.max(0, col - 1);
					handled = true;
					break;
				case 'ArrowRight':
					nextCol = Math.min(maxCol, col + 1);
					handled = true;
					break;
				case 'Tab':
					event.preventDefault();
					if (event.shiftKey) {
						nextCol = Math.max(0, col - 1);
					} else {
						nextCol = Math.min(maxCol, col + 1);
					}
					handled = true;
					break;
				case 'Home':
					nextCol = 0;
					handled = true;
					break;
				case 'End':
					nextCol = maxCol;
					handled = true;
					break;
				case 'Enter':
					event.preventDefault();
					// Enter edit mode
					this.setCellEditing(row, col, true);
					return;
				case 'Escape':
					event.preventDefault();
					// Clear selections
					this.store.setState({ selectedRange: null });
					return;
				default:
					// Any printable character starts typing immediately (Excel style!)
					if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
						event.preventDefault();
						this.setCellEditing(row, col, true, event.key);
					}
					return;
			}

			if (handled) {
				event.preventDefault();

				if (event.shiftKey) {
					// Expand selection range
					const start = this.rangeStart || active;
					const end = { row: nextRow, col: nextCol };

					this.rangeStart = start;
					this.store.setState({
						selectedRange: { start, end },
					});
				} else {
					// Reset selection range and move focus
					this.rangeStart = { row: nextRow, col: nextCol };
					this.store.setState({
						focusedCell: { row: nextRow, col: nextCol },
						selectedRange: { start: { row: nextRow, col: nextCol }, end: { row: nextRow, col: nextCol } },
					});

					// Opt-in: Auto-edit on arrow key navigation
					if (this.options.arrowKeyNavigationEdit) {
						this.setCellEditing(nextRow, nextCol, true);
					}
				}
			}
		}
		// 2. Keyboard handling when IN editing mode
		else {
			switch (event.key) {
				case 'ArrowUp':
					event.preventDefault();
					this.commitEdit(row, col);
					const upRow = Math.max(0, row - 1);
					this.rangeStart = { row: upRow, col };
					this.store.setState({
						focusedCell: { row: upRow, col },
						selectedRange: { start: { row: upRow, col }, end: { row: upRow, col } },
					});
					if (this.options.arrowKeyNavigationEdit) {
						this.setCellEditing(upRow, col, true);
					}
					break;
				case 'ArrowDown':
					event.preventDefault();
					this.commitEdit(row, col);
					const downRow = Math.min(maxRow, row + 1);
					this.rangeStart = { row: downRow, col };
					this.store.setState({
						focusedCell: { row: downRow, col },
						selectedRange: { start: { row: downRow, col }, end: { row: downRow, col } },
					});
					if (this.options.arrowKeyNavigationEdit) {
						this.setCellEditing(downRow, col, true);
					}
					break;
				case 'ArrowLeft':
					if (this.options.arrowKeyNavigationEdit) {
						event.preventDefault();
						this.commitEdit(row, col);
						const leftCol = Math.max(0, col - 1);
						this.rangeStart = { row, col: leftCol };
						this.store.setState({
							focusedCell: { row, col: leftCol },
							selectedRange: { start: { row, col: leftCol }, end: { row, col: leftCol } },
						});
						this.setCellEditing(row, leftCol, true);
					}
					break;
				case 'ArrowRight':
					if (this.options.arrowKeyNavigationEdit) {
						event.preventDefault();
						this.commitEdit(row, col);
						const rightCol = Math.min(maxCol, col + 1);
						this.rangeStart = { row, col: rightCol };
						this.store.setState({
							focusedCell: { row, col: rightCol },
							selectedRange: { start: { row, col: rightCol }, end: { row, col: rightCol } },
						});
						this.setCellEditing(row, rightCol, true);
					}
					break;
				case 'Enter':
					event.preventDefault();
					// Commit and move down
					this.commitEdit(row, col);
					const nextRow = Math.min(maxRow, row + 1);
					this.rangeStart = { row: nextRow, col };
					this.store.setState({
						focusedCell: { row: nextRow, col },
						selectedRange: { start: { row: nextRow, col }, end: { row: nextRow, col } },
					});
					// Opt-in: Auto-edit on enter movement
					if (this.options.arrowKeyNavigationEdit) {
						this.setCellEditing(nextRow, col, true);
					}
					break;
				case 'Tab':
					event.preventDefault();
					// Commit and move right
					this.commitEdit(row, col);
					const nextCol = event.shiftKey ? Math.max(0, col - 1) : Math.min(maxCol, col + 1);
					this.rangeStart = { row, col: nextCol };
					this.store.setState({
						focusedCell: { row, col: nextCol },
						selectedRange: { start: { row, col: nextCol }, end: { row, col: nextCol } },
					});
					// Opt-in: Auto-edit on tab movement
					if (this.options.arrowKeyNavigationEdit) {
						this.setCellEditing(row, nextCol, true);
					}
					break;
				case 'Escape':
					event.preventDefault();
					// Rollback edits
					this.cancelEdit(row, col);
					break;
			}
		}
	};

	/**
	 * Handle MouseDown events to initiate cell selection and focus.
	 */
	public handleMouseDown = (row: number, col: number, event: MouseEvent): void => {
		// Left click only
		if (event.button !== 0) return;

		const state = this.store.getState();
		const prevFocus = state.focusedCell;
		const trigger = this.options.editTrigger ?? 'doubleClick';

		// Handle singleClick edit trigger
		if (trigger === 'singleClick') {
			if (prevFocus && (prevFocus.row !== row || prevFocus.col !== col)) {
				const prevCellState = this.store.getCellState(prevFocus.row, prevFocus.col);
				if (prevCellState.isEditing) {
					this.commitEdit(prevFocus.row, prevFocus.col);
				}
			}
			this.isSelecting = true;
			this.rangeStart = { row, col };
			this.store.setState({
				focusedCell: { row, col },
				selectedRange: { start: { row, col }, end: { row, col } },
			});
			return;
		}

		// In doubleClick trigger, double-click is safely isolated inside React's onDoubleClick event to prevent focus races.

		// If focused on another cell, save its edit first
		if (prevFocus && (prevFocus.row !== row || prevFocus.col !== col)) {
			const prevCellState = this.store.getCellState(prevFocus.row, prevFocus.col);
			if (prevCellState.isEditing) {
				this.commitEdit(prevFocus.row, prevFocus.col);
			}
		}

		this.isSelecting = true;
		this.rangeStart = { row, col };

		this.store.setState({
			focusedCell: { row, col },
			selectedRange: { start: { row, col }, end: { row, col } },
		});
	};

	/**
	 * Handle MouseClick events to trigger edit mode.
	 */
	public handleClick = (row: number, col: number, event: MouseEvent): void => {
		const trigger = this.options.editTrigger ?? 'doubleClick';
		if (trigger !== 'singleClick') return;

		const state = this.store.getState();
		const range = state.selectedRange;
		// Only enter editing if the selection is a single cell (not a multi-cell range drag)
		const isSingleCell = !range || (range.start.row === range.end.row && range.start.col === range.end.col);

		if (isSingleCell) {
			this.setCellEditing(row, col, true);
		}
	};

	/**
	 * Handle MouseEnter event to calculate dragged cell ranges.
	 */
	public handleMouseEnter = (row: number, col: number): void => {
		if (!this.isSelecting || !this.rangeStart) return;

		this.store.setState({
			selectedRange: {
				start: this.rangeStart,
				end: { row, col },
			},
		});
	};

	/**
	 * Handle MouseUp to stop range selecting.
	 */
	public handleMouseUp = (): void => {
		this.isSelecting = false;
	};

	// Helper Methods
	public setCellEditing(row: number, col: number, isEditing: boolean, initialChar: string = ''): void {
		const key = `${row},${col}`;
		const cell = this.store.getCellState(row, col);

		this.store.setState((state) => ({
			cells: {
				...state.cells,
				[key]: {
					...cell,
					isEditing,
					value: isEditing && initialChar !== '' ? initialChar : cell.value,
				},
			},
			activeEditCell: isEditing ? { row, col } : null,
			activeEditValue: isEditing ? (initialChar !== '' ? initialChar : (cell.value ?? '')) : '',
		}));
	}

	public commitEdit(row: number, col: number): void {
		this.store.stopEditing(false);
	}

	public cancelEdit(row: number, col: number): void {
		this.store.stopEditing(true);
	}
}
export { GridStore };

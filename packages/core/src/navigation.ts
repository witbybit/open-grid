import { GridStore, GridCellPointer, GridFeature, GridApi } from './store.js';

export interface GridNavigationOptions {
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	editTrigger?: 'singleClick' | 'doubleClick'; // default: 'doubleClick'
	arrowKeyNavigationEdit?: boolean; // default: false
}

export class GridNavigationController<TRowData = unknown> implements GridFeature<TRowData> {
	readonly name = 'navigation';
	private store!: GridStore<TRowData>;
	private isSelecting = false;
	private rangeStart: GridCellPointer | null = null;
	private options: GridNavigationOptions;
	private unsubscribeCellValueChanged?: () => void;

	constructor(options: GridNavigationOptions = {}) {
		this.options = options;
	}

	public init(api: GridApi<TRowData>): void {
		this.store = api as GridStore<TRowData>;

		// Bind store event listener to invoke options callback when edits are committed
		if (this.options.onCellValueChanged) {
			this.unsubscribeCellValueChanged = this.store.addEventListener<{ rowId: string; colField: string; newValue: unknown }>(
				'cellValueChanged',
				(event) => {
					const { rowId, colField, newValue } = event.payload;
					this.options.onCellValueChanged?.(rowId, colField, newValue);
				}
			);
		}
	}

	public destroy(): void {
		this.dispose();
	}

	public dispose(): void {
		this.unsubscribeCellValueChanged?.();
		this.unsubscribeCellValueChanged = undefined;
	}

	private getPointerFromCoords(rowIdx: number, colIdx: number): GridCellPointer | null {
		const rowModel = this.store.getRowModel();
		if (!rowModel) return null;
		const state = this.store.getState();
		const row = rowModel.getRow(rowIdx);
		const col = state.columns[colIdx];
		if (!row || !col) return null;
		return {
			rowId: this.store.getRowId(row),
			colField: col.field,
		};
	}

	private getCoordsFromPointer(pointer: GridCellPointer | null): { rowIdx: number; colIdx: number } | null {
		if (!pointer) return null;
		const rowModel = this.store.getRowModel();
		if (!rowModel) return null;
		const state = this.store.getState();
		const rowIdx = rowModel.getRowIndexById(pointer.rowId);
		const colIdx = this.store.getColumnIndex(pointer.colField);
		if (rowIdx === -1 || colIdx === -1) return null;
		return { rowIdx, colIdx };
	}

	/**
	 * Handle standard keyboard movements and selection expansions.
	 */
	public handleKeyDown = (event: KeyboardEvent): void => {
		const rowModel = this.store.getRowModel();
		if (!rowModel) return;
		const state = this.store.getState();
		const active = state.focusedCell;
		if (!active) return;

		const coords = this.getCoordsFromPointer(active);
		if (!coords) return;

		const { rowIdx: row, colIdx: col } = coords;
		const maxRow = rowModel.getRowCount() - 1;
		const maxCol = state.columns.length - 1;

		const cellState = this.store.getCellState(active.rowId, active.colField);
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
					this.setCellEditing(active.rowId, active.colField, true);
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
						this.setCellEditing(active.rowId, active.colField, true);
					}
					return;
			}

			if (handled) {
				event.preventDefault();

				const targetPointer = this.getPointerFromCoords(nextRow, nextCol);
				if (!targetPointer) return;

				if (event.shiftKey) {
					// Expand selection range
					const start = this.rangeStart || active;
					const end = targetPointer;

					this.rangeStart = start;
					this.store.setState({
						selectedRange: { start, end },
					});
				} else {
					// Reset selection range and move focus
					this.rangeStart = targetPointer;
					this.store.setState({
						focusedCell: targetPointer,
						selectedRange: { start: targetPointer, end: targetPointer },
					});

					// Opt-in: Auto-edit on arrow key navigation
					if (this.options.arrowKeyNavigationEdit) {
						this.setCellEditing(targetPointer.rowId, targetPointer.colField, true);
					}
				}
			}
		}
		// 2. Keyboard handling when IN editing mode
		else {
			switch (event.key) {
				case 'ArrowUp': {
					event.preventDefault();
					this.commitEdit();
					const upRow = Math.max(0, row - 1);
					const target = this.getPointerFromCoords(upRow, col);
					if (target) {
						this.rangeStart = target;
						this.store.setState({
							focusedCell: target,
							selectedRange: { start: target, end: target },
						});
						if (this.options.arrowKeyNavigationEdit) {
							if (target.rowId !== active.rowId || target.colField !== active.colField) {
								this.setCellEditing(target.rowId, target.colField, true);
							}
						}
					}
					break;
				}
				case 'ArrowDown': {
					event.preventDefault();
					this.commitEdit();
					const downRow = Math.min(maxRow, row + 1);
					const target = this.getPointerFromCoords(downRow, col);
					if (target) {
						this.rangeStart = target;
						this.store.setState({
							focusedCell: target,
							selectedRange: { start: target, end: target },
						});
						if (this.options.arrowKeyNavigationEdit) {
							if (target.rowId !== active.rowId || target.colField !== active.colField) {
								this.setCellEditing(target.rowId, target.colField, true);
							}
						}
					}
					break;
				}
				case 'ArrowLeft': {
					if (this.options.arrowKeyNavigationEdit) {
						event.preventDefault();
						this.commitEdit();
						const leftCol = Math.max(0, col - 1);
						const target = this.getPointerFromCoords(row, leftCol);
						if (target) {
							this.rangeStart = target;
							this.store.setState({
								focusedCell: target,
								selectedRange: { start: target, end: target },
							});
							if (target.rowId !== active.rowId || target.colField !== active.colField) {
								this.setCellEditing(target.rowId, target.colField, true);
							}
						}
					}
					break;
				}
				case 'ArrowRight': {
					if (this.options.arrowKeyNavigationEdit) {
						event.preventDefault();
						this.commitEdit();
						const rightCol = Math.min(maxCol, col + 1);
						const target = this.getPointerFromCoords(row, rightCol);
						if (target) {
							this.rangeStart = target;
							this.store.setState({
								focusedCell: target,
								selectedRange: { start: target, end: target },
							});
							if (target.rowId !== active.rowId || target.colField !== active.colField) {
								this.setCellEditing(target.rowId, target.colField, true);
							}
						}
					}
					break;
				}
				case 'Enter': {
					event.preventDefault();
					// Commit and move down
					this.commitEdit();
					const nextRow = Math.min(maxRow, row + 1);
					const target = this.getPointerFromCoords(nextRow, col);
					if (target) {
						this.rangeStart = target;
						this.store.setState({
							focusedCell: target,
							selectedRange: { start: target, end: target },
						});
						if (this.options.arrowKeyNavigationEdit) {
							if (target.rowId !== active.rowId || target.colField !== active.colField) {
								this.setCellEditing(target.rowId, target.colField, true);
							}
						}
					}
					break;
				}
				case 'Tab': {
					event.preventDefault();
					// Commit and move right
					this.commitEdit();
					const nextCol = event.shiftKey ? Math.max(0, col - 1) : Math.min(maxCol, col + 1);
					const target = this.getPointerFromCoords(row, nextCol);
					if (target) {
						this.rangeStart = target;
						this.store.setState({
							focusedCell: target,
							selectedRange: { start: target, end: target },
						});
						if (this.options.arrowKeyNavigationEdit) {
							if (target.rowId !== active.rowId || target.colField !== active.colField) {
								this.setCellEditing(target.rowId, target.colField, true);
							}
						}
					}
					break;
				}
				case 'Escape':
					event.preventDefault();
					// Rollback edits
					this.cancelEdit();
					break;
			}
		}
	};

	/**
	 * Handle MouseDown events to initiate cell selection and focus.
	 */
	public handleMouseDown = (rowId: string, colField: string, event: MouseEvent): void => {
		// Left click only
		if (event.button !== 0) return;

		const state = this.store.getState();
		const prevFocus = state.focusedCell;
		const trigger = this.options.editTrigger ?? 'doubleClick';

		// Handle singleClick edit trigger
		if (trigger === 'singleClick') {
			if (prevFocus && (prevFocus.rowId !== rowId || prevFocus.colField !== colField)) {
				const prevCellState = this.store.getCellState(prevFocus.rowId, prevFocus.colField);
				if (prevCellState.isEditing) {
					this.commitEdit();
				}
			}
			const pointer: GridCellPointer = { rowId, colField };
			this.isSelecting = true;
			this.rangeStart = pointer;
			this.store.setState({
				focusedCell: pointer,
				selectedRange: { start: pointer, end: pointer },
			});
			return;
		}

		// If focused on another cell, save its edit first
		if (prevFocus && (prevFocus.rowId !== rowId || prevFocus.colField !== colField)) {
			const prevCellState = this.store.getCellState(prevFocus.rowId, prevFocus.colField);
			if (prevCellState.isEditing) {
				this.commitEdit();
			}
		}

		const pointer: GridCellPointer = { rowId, colField };
		this.isSelecting = true;
		this.rangeStart = pointer;

		this.store.setState({
			focusedCell: pointer,
			selectedRange: { start: pointer, end: pointer },
		});
	};

	/**
	 * Handle MouseClick events to trigger edit mode.
	 */
	public handleClick = (rowId: string, colField: string, event: MouseEvent): void => {
		const trigger = this.options.editTrigger ?? 'doubleClick';
		if (trigger !== 'singleClick') return;

		const state = this.store.getState();
		const range = state.selectedRange;
		// Only enter editing if the selection is a single cell (not a multi-cell range drag)
		const isSingleCell = !range || (range.start.rowId === range.end.rowId && range.start.colField === range.end.colField);

		if (isSingleCell) {
			this.setCellEditing(rowId, colField, true);
		}
	};

	/**
	 * Handle MouseEnter event to calculate dragged cell ranges.
	 */
	public handleMouseEnter = (rowId: string, colField: string): void => {
		if (!this.isSelecting || !this.rangeStart) return;

		this.store.setState({
			selectedRange: {
				start: this.rangeStart,
				end: { rowId, colField },
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
	public setCellEditing(rowId: string, colField: string, isEditing: boolean): void {
		if (isEditing) {
			this.store.setState({
				activeEdit: {
					rowId,
					colField,
				},
			});
		} else {
			this.store.stopEditing();
		}
	}

	public commitEdit(): void {
		this.store.stopEditing(false);
	}

	public cancelEdit(): void {
		this.store.stopEditing(true);
	}
}

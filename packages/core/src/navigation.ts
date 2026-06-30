import type { GridCellPointer, GridPlugin, GridPluginRuntime } from './api/GridApi.js';

export interface GridNavigationOptions {
	editTrigger?: 'singleClick' | 'doubleClick'; // default: 'doubleClick'
	arrowKeyNavigationEdit?: boolean; // default: false
}

export class GridNavigationController<TRowData = unknown> implements GridPlugin<TRowData> {
	readonly name = 'navigation';
	private runtime!: GridPluginRuntime<TRowData>;
	private isSelecting = false;
	private rangeStart: GridCellPointer | null = null;
	private options: GridNavigationOptions;

	constructor(options: GridNavigationOptions = {}) {
		this.options = options;
	}

	public onInit(api: GridPluginRuntime<TRowData>): void {
		this.runtime = api;
	}

	public onDestroy(): void {
		this.dispose();
	}

	public dispose(): void {}

	private getPointerFromCoords(rowIdx: number, colIdx: number): GridCellPointer | null {
		const state = this.runtime.getStateSnapshot();
		const visualRow = this.runtime.getVisualRow(rowIdx);
		const col = state.columns[colIdx];
		if (!visualRow || !col) return null;
		if (visualRow.kind !== 'data') return null;

		return {
			rowId: visualRow.rowId,
			colField: col.field,
		};
	}

	private getCoordsFromPointer(pointer: GridCellPointer | null): { rowIdx: number; colIdx: number } | null {
		if (!pointer) return null;
		const rowIdx = this.runtime.getVisualIndexByRowId(pointer.rowId) ?? -1;
		const colIdx = this.runtime.getColumnIndex(pointer.colField);
		if (rowIdx === -1 || colIdx === -1) return null;
		return { rowIdx, colIdx };
	}

	private getNextDataRowIndex(currentIndex: number, direction: 'up' | 'down'): number {
		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return -1;
		const rowCount = rowModel.getVisualRowCount();
		let step = direction === 'down' ? 1 : -1;
		let idx = currentIndex + step;
		while (idx >= 0 && idx < rowCount) {
			const row = rowModel.getVisualRow(idx);
			if (row && row.kind === 'data') {
				return idx;
			}
			idx += step;
		}
		return -1;
	}

	/** Returns the destination {row, col} for Tab/Shift+Tab, wrapping to the next/prev data row at the edges. */
	private getTabTarget(row: number, col: number, maxCol: number, forward: boolean): { row: number; col: number } | null {
		if (forward) {
			if (col < maxCol) return { row, col: col + 1 };
			const nextRow = this.getNextDataRowIndex(row, 'down');
			return nextRow === -1 ? null : { row: nextRow, col: 0 };
		} else {
			if (col > 0) return { row, col: col - 1 };
			const prevRow = this.getNextDataRowIndex(row, 'up');
			return prevRow === -1 ? null : { row: prevRow, col: maxCol };
		}
	}

	/** Clamp an index into range and snap to the nearest data row (preferring `preferDir`). */
	private clampToDataRow(idx: number, preferDir: 'up' | 'down'): number {
		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return idx;
		const count = rowModel.getVisualRowCount();
		if (count === 0) return idx;
		const clamped = Math.max(0, Math.min(count - 1, idx));
		if (rowModel.getVisualRow(clamped)?.kind === 'data') return clamped;
		const near = this.getNextDataRowIndex(clamped, preferDir);
		if (near !== -1) return near;
		const far = this.getNextDataRowIndex(clamped, preferDir === 'up' ? 'down' : 'up');
		return far !== -1 ? far : clamped;
	}

	/**
	 * Handle standard keyboard movements and selection expansions.
	 */
	public handleKeyDown = (event: KeyboardEvent): void => {
		const state = this.runtime.getStateSnapshot();
		const active = state.selection.focus;
		if (!active) return;

		const coords = this.getCoordsFromPointer(active);
		if (!coords) return;

		const { rowIdx: row, colIdx: col } = coords;
		const maxCol = state.columns.length - 1;

		const cellState = this.runtime.getCellState(active.rowId, active.colField);
		const isEditing = cellState.isEditing;

		// 1. Navigation logic when NOT in cell editing mode
		if (!isEditing) {
			// Ctrl+C / Cmd+C — copy selection to clipboard
			if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
				event.preventDefault();
				this.copySelectionToClipboard();
				return;
			}

			// Ctrl+V / Cmd+V — paste from clipboard
			if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
				event.preventDefault();
				void this.pasteFromClipboard();
				return;
			}

			let nextRow = row;
			let nextCol = col;
			let handled = false;

			switch (event.key) {
				case 'ArrowUp': {
					const prevDataRowIdx = this.getNextDataRowIndex(row, 'up');
					if (prevDataRowIdx !== -1) {
						nextRow = prevDataRowIdx;
					}
					handled = true;
					break;
				}
				case 'ArrowDown': {
					const nextDataRowIdx = this.getNextDataRowIndex(row, 'down');
					if (nextDataRowIdx !== -1) {
						nextRow = nextDataRowIdx;
					}
					handled = true;
					break;
				}
				case 'ArrowLeft':
					nextCol = Math.max(0, col - 1);
					handled = true;
					break;
				case 'ArrowRight':
					nextCol = Math.min(maxCol, col + 1);
					handled = true;
					break;
				case 'Tab': {
					event.preventDefault();
					const tabDest = this.getTabTarget(row, col, maxCol, !event.shiftKey);
					if (tabDest) {
						const ptr = this.getPointerFromCoords(tabDest.row, tabDest.col);
						if (ptr) {
							this.rangeStart = ptr;
							this.runtime.selectCell(ptr, 'keyboard');
						}
					}
					return;
				}
				case 'Home':
					// Ctrl+Home → first cell of the grid; Home → start of the row.
					nextCol = 0;
					if (event.ctrlKey || event.metaKey) nextRow = this.clampToDataRow(0, 'down');
					handled = true;
					break;
				case 'End':
					// Ctrl+End → last cell of the grid; End → end of the row.
					nextCol = maxCol;
					if (event.ctrlKey || event.metaKey) {
						const count = this.runtime.getRowModel()?.getVisualRowCount() ?? 0;
						nextRow = this.clampToDataRow(count - 1, 'up');
					}
					handled = true;
					break;
				case 'PageUp':
				case 'PageDown': {
					const page = 10;
					if (event.key === 'PageUp') nextRow = this.clampToDataRow(row - page, 'down');
					else nextRow = this.clampToDataRow(row + page, 'up');
					handled = true;
					break;
				}
				case ' ': {
					event.preventDefault();
					const rowModel = this.runtime.getRowModel();
					if (rowModel) {
						const currentIdx = this.runtime.getVisualIndexByRowId(active.rowId);
						if (currentIdx !== null && currentIdx !== -1) {
							const currentVisualRow = rowModel.getVisualRow(currentIdx);
							if (currentVisualRow) {
								if (currentVisualRow.kind === 'group') {
									this.runtime.toggleGroupExpanded(currentVisualRow.id);
								} else if (currentVisualRow.kind === 'data') {
									if (this.runtime.getStateSnapshot().masterDetailEnabled) {
										this.runtime.toggleDetailExpanded(active.rowId);
									} else {
										let parentGroupRowId: string | null = null;
										for (let i = currentIdx - 1; i >= 0; i--) {
											const vr = rowModel.getVisualRow(i);
											if (vr && vr.kind === 'group' && vr.depth < currentVisualRow.depth) {
												parentGroupRowId = vr.id;
												break;
											}
										}
										if (parentGroupRowId) {
											this.runtime.toggleGroupExpanded(parentGroupRowId);
										}
									}
								}
							}
						}
					}
					return;
				}
				case 'F2':
				case 'Enter':
					event.preventDefault();
					this.setCellEditing(active.rowId, active.colField, true);
					return;
				case 'Delete':
				case 'Backspace':
					event.preventDefault();
					this.runtime.setCellValue(active.rowId, active.colField, null);
					return;
				case 'Escape':
					event.preventDefault();
					// Clear selections
					this.runtime.selectCell(null, 'keyboard');
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
					this.runtime.extendSelection(end, 'keyboard');
				} else {
					// Reset selection range and move focus
					this.rangeStart = targetPointer;
					this.runtime.selectCell(targetPointer, 'keyboard');

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
					const upRow = this.getNextDataRowIndex(row, 'up');
					if (upRow !== -1) {
						const target = this.getPointerFromCoords(upRow, col);
						if (target) {
							this.rangeStart = target;
							this.runtime.selectCell(target, 'keyboard');
							if (this.options.arrowKeyNavigationEdit) {
								if (target.rowId !== active.rowId || target.colField !== active.colField) {
									this.setCellEditing(target.rowId, target.colField, true);
								}
							}
						}
					}
					break;
				}
				case 'ArrowDown': {
					event.preventDefault();
					this.commitEdit();
					const downRow = this.getNextDataRowIndex(row, 'down');
					if (downRow !== -1) {
						const target = this.getPointerFromCoords(downRow, col);
						if (target) {
							this.rangeStart = target;
							this.runtime.selectCell(target, 'keyboard');
							if (this.options.arrowKeyNavigationEdit) {
								if (target.rowId !== active.rowId || target.colField !== active.colField) {
									this.setCellEditing(target.rowId, target.colField, true);
								}
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
							this.runtime.selectCell(target, 'keyboard');
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
							this.runtime.selectCell(target, 'keyboard');
							if (target.rowId !== active.rowId || target.colField !== active.colField) {
								this.setCellEditing(target.rowId, target.colField, true);
							}
						}
					}
					break;
				}
				case 'Enter': {
					event.preventDefault();
					// Commit and move to the next row; always start editing there
					this.commitEdit();
					const nextRowIdx = this.getNextDataRowIndex(row, 'down');
					if (nextRowIdx !== -1) {
						const target = this.getPointerFromCoords(nextRowIdx, col);
						if (target) {
							this.rangeStart = target;
							this.runtime.selectCell(target, 'keyboard');
							this.setCellEditing(target.rowId, target.colField, true);
						}
					}
					break;
				}
				case 'Tab': {
					event.preventDefault();
					// Commit and move to the next tab stop (with row-wrap); always start editing there
					this.commitEdit();
					const tabDest = this.getTabTarget(row, col, maxCol, !event.shiftKey);
					if (tabDest) {
						const target = this.getPointerFromCoords(tabDest.row, tabDest.col);
						if (target) {
							this.rangeStart = target;
							this.runtime.selectCell(target, 'keyboard');
							this.setCellEditing(target.rowId, target.colField, true);
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

		// Ctrl/Cmd+Click: toggle row selection without moving cell focus
		if (event.ctrlKey || event.metaKey) {
			this.runtime.applyRowSelectionGesture({ kind: 'toggle', rowIds: [rowId], source: 'pointer' });
			return; // do not move cell focus
		}

		const state = this.runtime.getStateSnapshot();
		const prevFocus = state.selection.focus;
		const trigger = this.options.editTrigger ?? 'doubleClick';

		// Handle singleClick edit trigger
		if (trigger === 'singleClick') {
			if (prevFocus && (prevFocus.rowId !== rowId || prevFocus.colField !== colField)) {
				const prevCellState = this.runtime.getCellState(prevFocus.rowId, prevFocus.colField);
				if (prevCellState.isEditing) {
					this.commitEdit();
				}
			}
			const pointer: GridCellPointer = { rowId, colField };
			this.isSelecting = true;
			this.rangeStart = pointer;
			this.runtime.selectCell(pointer, 'pointer');
			return;
		}

		// If focused on another cell, save its edit first
		if (prevFocus && (prevFocus.rowId !== rowId || prevFocus.colField !== colField)) {
			const prevCellState = this.runtime.getCellState(prevFocus.rowId, prevFocus.colField);
			if (prevCellState.isEditing) {
				this.commitEdit();
			}
		}

		const pointer: GridCellPointer = { rowId, colField };
		this.isSelecting = true;
		this.rangeStart = pointer;

		this.runtime.selectCell(pointer, 'pointer');
	};

	/**
	 * Handle MouseClick events to trigger edit mode.
	 */
	public handleClick = (rowId: string, colField: string, event: MouseEvent): void => {
		const trigger = this.options.editTrigger ?? 'doubleClick';
		if (trigger !== 'singleClick') return;

		const state = this.runtime.getStateSnapshot();
		const range = state.selection.range;
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

		this.runtime.extendSelection({ rowId, colField }, 'pointer');
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
			this.runtime.startEditing(rowId, colField);
		} else {
			this.runtime.stopEditing();
		}
	}

	public commitEdit(): void {
		this.runtime.stopEditing(false);
	}

	public cancelEdit(): void {
		this.runtime.stopEditing(true);
	}

	private copySelectionToClipboard(): void {
		void this.runtime.copySelectedRange();
	}

	private async pasteFromClipboard(): Promise<void> {
		return this.runtime.pasteFromClipboard();
	}
}

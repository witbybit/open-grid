import { GridEventName, GridCellPointer, GridPlugin, GridPluginRuntime } from './store.js';

export interface GridNavigationOptions {
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	editTrigger?: 'singleClick' | 'doubleClick'; // default: 'doubleClick'
	arrowKeyNavigationEdit?: boolean; // default: false
}

export class GridNavigationController<TRowData = unknown> implements GridPlugin<TRowData> {
	readonly name = 'navigation';
	private runtime!: GridPluginRuntime<TRowData>;
	private isSelecting = false;
	private rangeStart: GridCellPointer | null = null;
	private options: GridNavigationOptions;
	private unsubscribeCellValueChanged?: () => void;

	constructor(options: GridNavigationOptions = {}) {
		this.options = options;
	}

	public onInit(api: GridPluginRuntime<TRowData>): void {
		this.runtime = api;

		// Bind store event listener to invoke options callback when edits are committed
		if (this.options.onCellValueChanged) {
			this.unsubscribeCellValueChanged = this.runtime.addEventListener(GridEventName.cellValueChanged, (event) => {
				const { rowId, colField, newValue } = event.payload;
				this.options.onCellValueChanged?.(rowId, colField, newValue);
			});
		}
	}

	public onDestroy(): void {
		this.dispose();
	}

	public dispose(): void {
		this.unsubscribeCellValueChanged?.();
		this.unsubscribeCellValueChanged = undefined;
	}

	private getPointerFromCoords(rowIdx: number, colIdx: number): GridCellPointer | null {
		const state = this.runtime.getState();
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

	/**
	 * Handle standard keyboard movements and selection expansions.
	 */
	public handleKeyDown = (event: KeyboardEvent): void => {
		const state = this.runtime.getState();
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
									if (this.runtime.getState().masterDetailEnabled) {
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
				case 'Enter':
					event.preventDefault();
					// Enter edit mode
					this.setCellEditing(active.rowId, active.colField, true);
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
					// Commit and move down
					this.commitEdit();
					const nextRowIdx = this.getNextDataRowIndex(row, 'down');
					if (nextRowIdx !== -1) {
						const target = this.getPointerFromCoords(nextRowIdx, col);
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
				case 'Tab': {
					event.preventDefault();
					// Commit and move right
					this.commitEdit();
					const nextCol = event.shiftKey ? Math.max(0, col - 1) : Math.min(maxCol, col + 1);
					const target = this.getPointerFromCoords(row, nextCol);
					if (target) {
						this.rangeStart = target;
						this.runtime.selectCell(target, 'keyboard');
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

		// Ctrl/Cmd+Click: toggle row selection without moving cell focus
		if (event.ctrlKey || event.metaKey) {
			this.runtime.applyRowSelectionGesture({ kind: 'toggle', rowIds: [rowId], source: 'pointer' });
			return; // do not move cell focus
		}

		const state = this.runtime.getState();
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

		const state = this.runtime.getState();
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

	/**
	 * Copy the current selection to the clipboard as tab-separated values (TSV).
	 * Single-cell selection copies the display value; multi-cell copies a TSV block
	 * that pastes correctly into Excel and Google Sheets.
	 * Fires a `cellsCopied` event so the renderer can flash the copied cells.
	 */
	private copySelectionToClipboard(): void {
		if (typeof navigator === 'undefined' || !navigator.clipboard) return;
		const state = this.runtime.getState();
		const selection = state.selection;
		const bounds = selection.bounds;
		const copiedCells: Array<{ rowId: string; colField: string }> = [];

		if (!bounds) {
			const focus = selection.focus;
			if (!focus) return;
			const colDef = state.columns.find((c) => c.field === focus.colField);
			let text: string;
			if (colDef?.onCopy) {
				const row = this.runtime.getRawRowById(focus.rowId);
				text =
					row !== null
						? colDef.onCopy({
								row,
								rowId: focus.rowId,
								colField: focus.colField,
								value: this.runtime.getCellValue(focus.rowId, focus.colField),
							})
						: this.runtime.getCheapDisplayValue(focus.rowId, focus.colField);
			} else {
				text = this.runtime.getCheapDisplayValue(focus.rowId, focus.colField);
			}
			navigator.clipboard.writeText(text).catch(() => {});
			copiedCells.push({ rowId: focus.rowId, colField: focus.colField });
			this.runtime.dispatchEvent(GridEventName.cellsCopied, { cells: copiedCells });
			return;
		}

		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return;

		const rows: string[] = [];
		for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
			const visualRow = rowModel.getVisualRow(r);
			if (!visualRow || visualRow.kind !== 'data') continue;
			const cells: string[] = [];
			for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
				const colField = this.runtime.getColumnField(c);
				if (colField === null) continue;
				const colDef = state.columns.find((col) => col.field === colField);
				let cellText: string;
				if (colDef?.onCopy) {
					const row = this.runtime.getRawRowById(visualRow.rowId);
					cellText =
						row !== null
							? colDef.onCopy({ row, rowId: visualRow.rowId, colField, value: this.runtime.getCellValue(visualRow.rowId, colField) })
							: this.runtime.getCheapDisplayValue(visualRow.rowId, colField);
				} else {
					cellText = this.runtime.getCheapDisplayValue(visualRow.rowId, colField);
				}
				cells.push(cellText);
				copiedCells.push({ rowId: visualRow.rowId, colField });
			}
			rows.push(cells.join('\t'));
		}

		if (rows.length === 0) return;
		navigator.clipboard.writeText(rows.join('\n')).catch(() => {});
		this.runtime.dispatchEvent(GridEventName.cellsCopied, { cells: copiedCells });
	}

	private async pasteFromClipboard(): Promise<void> {
		if (typeof navigator === 'undefined' || !navigator.clipboard) return;
		const state = this.runtime.getState();
		const selection = state.selection;
		const focus = selection.focus;
		if (!focus) return;

		const focusCoords = this.getCoordsFromPointer(focus);
		if (!focusCoords) return;

		const startRow = selection.bounds ? selection.bounds.minRow : focusCoords.rowIdx;
		const startCol = selection.bounds ? selection.bounds.minCol : focusCoords.colIdx;

		try {
			const text = await navigator.clipboard.readText();
			if (!text) return;

			const rowModel = this.runtime.getRowModel();
			if (!rowModel) return;
			const maxRow = this.runtime.getVisualRowCount();
			const lines = text.split(/\r?\n/);

			for (let r = 0; r < lines.length; r++) {
				if (!lines[r] && r === lines.length - 1) break; // skip trailing newline
				const rowIndex = startRow + r;
				if (rowIndex >= maxRow) break;
				const visualRow = rowModel.getVisualRow(rowIndex);
				if (!visualRow || visualRow.kind !== 'data') continue;
				const rowId = visualRow.rowId;
				const cells = lines[r].split('\t');
				for (let c = 0; c < cells.length; c++) {
					const colIndex = startCol + c;
					if (colIndex >= state.columns.length) break;
					const colDef = state.columns[colIndex];
					if (!colDef) continue;
					let value: unknown = cells[c];
					if (colDef.onPaste) {
						const row = this.runtime.getRawRowById(rowId);
						if (row !== null) {
							value = colDef.onPaste({ row, rowId, colField: colDef.field, pastedText: cells[c] });
						}
					}
					this.runtime.setCellValue(rowId, colDef.field, value);
				}
			}
		} catch {
			// Clipboard access denied — silently ignore
		}
	}
}

import type { CanonicalGridCellPointer, GridCellPointer } from '../api/GridApi.js';
import type { GridPluginRuntime, ScrollToCellOptions, ScrollToRowOptions } from '../api/GridApiSurfaces.js';
import type { GridSelectionSource, RowSelectionChangeResult, RowSelectionGesture } from '../api/GridApi.js';
import { areCanonicalCellPointersEqual, areCellPointersEqual, findColumnByCellPointer, findColumnIndexByCellPointer } from './cellPointer.js';
import { readInteractionState } from './interactionState.js';
import { getColumnInstanceIdentity, type ColumnDef } from '../columnDef.js';

export interface GridNavigationOptions {
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
}

export interface GridInteractionCommandPort {
	selectCell(pointer: GridCellPointer | null, source?: GridSelectionSource): void;
	selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource): void;
	applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null;
	selectRows(rowIds: string[], options?: { mode?: 'add' | 'replace' }): void;
	deselectRows(rowIds: string[]): void;
	copySelectedRange(): Promise<void>;
	pasteFromClipboard(): Promise<void>;
	scrollToCell(rowId: string, colField: string): void;
	scrollToRow(rowId: string): void;
	startEditing(rowId: string, colFieldOrInstanceId: string, source?: 'keyboard' | 'mouse' | 'api'): void;
	updateEditDraft(rowId: string, colFieldOrInstanceId: string, value: unknown): void;
	stopEditing(cancel?: boolean): void;
	commitEdit(rowId: string, colFieldOrInstanceId: string, value: unknown): Promise<boolean>;
	setCellValue(rowId: string, colField: string, value: unknown): void;
}

export type GridInteractionInputCommand =
	| { kind: 'key-down'; event: KeyboardEvent }
	| { kind: 'mouse-down-cell'; pointer: GridCellPointer; event: MouseEvent }
	| { kind: 'cell-click'; pointer: GridCellPointer; event: MouseEvent }
	| { kind: 'cell-enter'; pointer: GridCellPointer }
	| { kind: 'mouse-up' }
	| { kind: 'set-cell-editing'; rowId: string; colFieldOrInstanceId: string; isEditing: boolean; source?: 'keyboard' | 'mouse' | 'api' }
	| { kind: 'row-checkbox-click'; rowId: string; checked: boolean; event: MouseEvent }
	| { kind: 'data-row-click'; pointer: GridCellPointer; event: MouseEvent }
	| { kind: 'viewport-mouse-down'; event: MouseEvent };

export interface GridInteractionHandle {
	dispatchInput(command: GridInteractionInputCommand): void;
	isEditingCell(pointer: GridCellPointer): boolean;
	isRowSelectionIgnoredTarget(el: Element | null): boolean;
	updateOptions(options: GridNavigationOptions): void;
	dispose(): void;
}

export class GridInteractionController<TRowData = unknown> implements GridInteractionHandle {
	private isSelecting = false;
	private rowSelectionAnchorId: string | null = null;
	private options: GridNavigationOptions;
	private readonly commands: GridInteractionCommandPort;

	constructor(
		private readonly runtime: GridPluginRuntime<TRowData>,
		options: GridNavigationOptions = {},
		commands?: GridInteractionCommandPort
	) {
		this.options = options;
		this.commands = commands ?? {
			selectCell: (pointer, source) => this.runtime.selectCell(pointer, source),
			selectRange: (start, end, source) => this.runtime.selectRange(start, end, source),
			applyRowSelectionGesture: (gesture) => this.runtime.applyRowSelectionGesture(gesture),
			selectRows: (rowIds, rowOptions) => this.runtime.selectRows(rowIds, rowOptions),
			deselectRows: (rowIds) => this.runtime.deselectRows(rowIds),
			copySelectedRange: () => this.runtime.copySelectedRange(),
			pasteFromClipboard: () => this.runtime.pasteFromClipboard(),
			scrollToCell: (rowId, colField) => this.runtime.scrollToCell(rowId, colField),
			scrollToRow: (rowId) => this.runtime.scrollToRow(rowId),
			startEditing: (rowId, colFieldOrInstanceId, source) => this.runtime.startEditing(rowId, colFieldOrInstanceId, source),
			updateEditDraft: (rowId, colFieldOrInstanceId, value) => this.runtime.updateEditDraft(rowId, colFieldOrInstanceId, value),
			stopEditing: (cancel) => this.runtime.stopEditing(cancel),
			commitEdit: (rowId, colFieldOrInstanceId, value) => this.runtime.commitEdit(rowId, colFieldOrInstanceId, value),
			setCellValue: (rowId, colField, value) => this.runtime.setCellValue(rowId, colField, value),
		};
	}

	public updateOptions(options: GridNavigationOptions): void {
		this.options = options;
	}

	public dispose(): void {}

	public dispatchInput(command: GridInteractionInputCommand): void {
		switch (command.kind) {
			case 'key-down':
				this.handleKeyDown(command.event);
				return;
			case 'mouse-down-cell':
				this.handleMouseDown(command.pointer, command.event);
				return;
			case 'cell-click':
				this.handleClick(command.pointer);
				return;
			case 'cell-enter':
				this.handleMouseEnter(command.pointer);
				return;
			case 'mouse-up':
				this.handleMouseUp();
				return;
			case 'set-cell-editing':
				this.setCellEditing(command.rowId, command.colFieldOrInstanceId, command.isEditing, command.source);
				return;
			case 'row-checkbox-click':
				this.handleRowCheckboxClick(command.rowId, command.checked, command.event);
				return;
			case 'data-row-click':
				this.handleDataRowClick(command.pointer, command.event);
				return;
			case 'viewport-mouse-down':
				this.handleViewportMouseDown(command.event);
				return;
		}
	}

	private getDisplayedColumnAtIndex(colIdx: number): ColumnDef<TRowData> | undefined {
		return this.runtime.getDisplayedColumns()[colIdx];
	}

	private resolvePointerColumn(pointer: GridCellPointer): ColumnDef<TRowData> | undefined {
		const access = this.runtime.getCellAccessByPointer(pointer);
		if (access) return access.column;
		return findColumnByCellPointer(this.runtime.getDisplayedColumns(), pointer);
	}

	private getPointerFromCoords(rowIdx: number, colIdx: number): GridCellPointer | null {
		const visualRow = this.runtime.getVisualRow(rowIdx);
		const col = this.getDisplayedColumnAtIndex(colIdx);
		if (!visualRow || !col || visualRow.kind !== 'data') return null;
		const colField = col.field;
		return {
			rowId: visualRow.rowId,
			colField,
			columnInstanceId: getColumnInstanceIdentity(col),
			colId: col?.colId ?? colField,
		};
	}

	private getCoordsFromPointer(pointer: GridCellPointer | null): { rowIdx: number; colIdx: number } | null {
		if (!pointer) return null;
		const access = this.runtime.getCellAccessByPointer(pointer);
		if (access) return { rowIdx: access.rowIndex, colIdx: access.colIndex };
		const rowIdx = this.runtime.getVisualIndexByRowId(pointer.rowId) ?? -1;
		const colIdx = findColumnIndexByCellPointer(this.runtime.getDisplayedColumns(), pointer);
		if (rowIdx === -1 || colIdx === -1) return null;
		return { rowIdx, colIdx };
	}

	private getNextDataRowIndex(currentIndex: number, direction: 'up' | 'down'): number {
		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return -1;
		const rowCount = rowModel.getVisualRowCount();
		let idx = currentIndex + (direction === 'down' ? 1 : -1);
		while (idx >= 0 && idx < rowCount) {
			const row = rowModel.getVisualRow(idx);
			if (row?.kind === 'data') return idx;
			idx += direction === 'down' ? 1 : -1;
		}
		return -1;
	}

	private getTabTarget(row: number, col: number, maxCol: number, forward: boolean): { row: number; col: number } | null {
		if (forward) {
			if (col < maxCol) return { row, col: col + 1 };
			const nextRow = this.getNextDataRowIndex(row, 'down');
			return nextRow === -1 ? null : { row: nextRow, col: 0 };
		}
		if (col > 0) return { row, col: col - 1 };
		const prevRow = this.getNextDataRowIndex(row, 'up');
		return prevRow === -1 ? null : { row: prevRow, col: maxCol };
	}

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

	private getViewportPageStep(): number {
		const visibleRange = this.runtime.getVisibleRowRange();
		const visibleCount = visibleRange.endIdx - visibleRange.startIdx + 1;
		return Math.max(1, visibleCount);
	}

	private getEditTargetColumnIdentity(pointer: GridCellPointer): string {
		if (pointer.columnInstanceId) return pointer.columnInstanceId;
		const column = this.resolvePointerColumn(pointer);
		return column ? getColumnInstanceIdentity(column) : pointer.colField;
	}

	private canonicalizePointer(pointer: GridCellPointer | null | undefined): CanonicalGridCellPointer | null {
		if (!pointer) return null;
		if (pointer.columnInstanceId && pointer.colId) {
			return pointer as CanonicalGridCellPointer;
		}
		const column = this.resolvePointerColumn(pointer);
		if (!column) return null;
		const columnInstanceId = getColumnInstanceIdentity(column);
		return {
			rowId: pointer.rowId,
			colField: column.field,
			colId: column.colId ?? column.field,
			columnInstanceId,
		};
	}

	private isEditingPointer(pointer: GridCellPointer | null, activeEdit: GridCellPointer | null | undefined): boolean {
		const canonicalPointer = this.canonicalizePointer(pointer);
		const canonicalActiveEdit = this.canonicalizePointer(activeEdit ?? null);
		return areCanonicalCellPointersEqual(canonicalPointer, canonicalActiveEdit);
	}

	private getSelectionAnchor(): GridCellPointer | null {
		const selection = readInteractionState(this.runtime.getStateSnapshot()).cellSelection.selection;
		return selection.anchor ?? selection.focus ?? null;
	}

	private getDataRowIdsBetween(anchorRowId: string, targetRowId: string): string[] {
		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return [];
		const anchorIndex = rowModel.getVisualIndexByRowId(anchorRowId);
		const targetIndex = rowModel.getVisualIndexByRowId(targetRowId);
		if (anchorIndex < 0 || targetIndex < 0) return [];
		const start = Math.min(anchorIndex, targetIndex);
		const end = Math.max(anchorIndex, targetIndex);
		const rowIds: string[] = [];
		for (let i = start; i <= end; i++) {
			const row = rowModel.getVisualRow(i);
			if (row?.kind === 'data') rowIds.push(row.rowId);
		}
		return rowIds;
	}

	private isMultipleRowSelectionEnabled(): boolean {
		const internalState = (
			this.runtime as GridPluginRuntime<TRowData> & {
				getState?: () => { rowSelection?: { mode?: 'single' | 'multiple' } | undefined };
			}
		).getState?.();
		return internalState?.rowSelection?.mode !== 'single';
	}

	public isRowSelectionIgnoredTarget(el: Element | null): boolean {
		if (!el) return false;
		return (
			el.closest('button, input, select, textarea, a, [role="button"], [contenteditable="true"]') !== null ||
			el.closest('.og-cell-editor') !== null ||
			el.closest('.og-context-menu') !== null
		);
	}

	public handleViewportMouseDown(event: MouseEvent): void {
		const handle = (event.target as HTMLElement | null)?.closest('.og-drag-handle');
		if (handle) event.stopPropagation();
	}

	public handleRowCheckboxClick(rowId: string, checked: boolean, event: MouseEvent): void {
		const isMultiple = this.isMultipleRowSelectionEnabled();
		if (isMultiple && event.shiftKey && this.rowSelectionAnchorId) {
			const rangeIds = this.getDataRowIdsBetween(this.rowSelectionAnchorId, rowId);
			if (rangeIds.length > 0) {
				if (checked) this.commands.selectRows(rangeIds, { mode: 'add' });
				else this.commands.deselectRows(rangeIds);
			}
		} else if (!isMultiple && checked) {
			this.commands.applyRowSelectionGesture({ kind: 'replace', rowIds: [rowId], source: 'checkbox' });
		} else {
			this.commands.applyRowSelectionGesture({ kind: 'toggle', rowIds: [rowId], source: 'checkbox' });
		}
		this.rowSelectionAnchorId = rowId;
	}

	public handleDataRowClick(pointer: GridCellPointer, event: MouseEvent): void {
		if (!this.runtime.getDisplayedColumns().some((col) => col.checkboxSelection)) return;
		const col = this.resolvePointerColumn(pointer);
		if (col?.checkboxSelection) return;
		const rowIndex = this.runtime.getVisualIndexByRowId(pointer.rowId) ?? -1;
		const row = rowIndex >= 0 ? this.runtime.getVisualRow(rowIndex) : null;
		if (row?.kind !== 'data') return;
		const isMultiple = this.isMultipleRowSelectionEnabled();
		if (isMultiple && event.shiftKey && this.rowSelectionAnchorId) {
			const rangeIds = this.getDataRowIdsBetween(this.rowSelectionAnchorId, pointer.rowId);
			if (rangeIds.length > 0) {
				this.commands.applyRowSelectionGesture({ kind: 'select', rowIds: rangeIds, source: 'pointer' });
				event.preventDefault();
				this.rowSelectionAnchorId = pointer.rowId;
				return;
			}
		}
		if (isMultiple && (event.ctrlKey || event.metaKey)) {
			this.commands.applyRowSelectionGesture({ kind: 'toggle', rowIds: [pointer.rowId], source: 'pointer' });
		} else {
			this.commands.applyRowSelectionGesture({ kind: 'replace', rowIds: [pointer.rowId], source: 'pointer' });
		}
		this.rowSelectionAnchorId = pointer.rowId;
	}

	public handleKeyDown = (event: KeyboardEvent): void => {
		const state = this.runtime.getStateSnapshot();
		const interaction = readInteractionState(state);
		const active = interaction.focus.cell;
		if (!active) return;
		const coords = this.getCoordsFromPointer(active);
		if (!coords) return;
		const { rowIdx: row, colIdx: col } = coords;
		const maxCol = this.runtime.getDisplayedColumns().length - 1;
		const isEditing = this.isEditingPointer(active, interaction.activeEdit.active);

		if (!isEditing) {
			if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
				event.preventDefault();
				void this.commands.copySelectedRange();
				return;
			}
			if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
				event.preventDefault();
				void this.commands.pasteFromClipboard();
				return;
			}
			let nextRow = row;
			let nextCol = col;
			let handled = false;
			switch (event.key) {
				case 'ArrowUp': {
					const prevDataRowIdx = this.getNextDataRowIndex(row, 'up');
					if (prevDataRowIdx !== -1) nextRow = prevDataRowIdx;
					handled = true;
					break;
				}
				case 'ArrowDown': {
					const nextDataRowIdx = this.getNextDataRowIndex(row, 'down');
					if (nextDataRowIdx !== -1) nextRow = nextDataRowIdx;
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
							this.commands.selectCell(ptr, 'keyboard');
						}
					}
					return;
				}
				case 'Home':
					nextCol = 0;
					if (event.ctrlKey || event.metaKey) nextRow = this.clampToDataRow(0, 'down');
					handled = true;
					break;
				case 'End':
					nextCol = maxCol;
					if (event.ctrlKey || event.metaKey) {
						const count = this.runtime.getRowModel()?.getVisualRowCount() ?? 0;
						nextRow = this.clampToDataRow(count - 1, 'up');
					}
					handled = true;
					break;
				case 'PageUp':
				case 'PageDown': {
					const page = this.getViewportPageStep();
					nextRow = event.key === 'PageUp' ? this.clampToDataRow(row - page, 'down') : this.clampToDataRow(row + page, 'up');
					handled = true;
					break;
				}
				case ' ':
					event.preventDefault();
					return;
				case 'F2':
				case 'Enter':
					event.preventDefault();
					this.setCellEditing(active.rowId, this.getEditTargetColumnIdentity(active), true, 'keyboard');
					return;
				case 'Delete':
				case 'Backspace':
					event.preventDefault();
					this.commands.setCellValue(active.rowId, active.colField, null);
					return;
				case 'Escape':
					event.preventDefault();
					this.commands.selectCell(null, 'keyboard');
					return;
				default:
					if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
						event.preventDefault();
						this.setCellEditing(active.rowId, this.getEditTargetColumnIdentity(active), true, 'keyboard');
					}
					return;
			}
			if (handled) {
				event.preventDefault();
				const targetPointer = this.getPointerFromCoords(nextRow, nextCol);
				if (!targetPointer) return;
				if (event.shiftKey) {
					const start = this.getSelectionAnchor() ?? active;
					if (!areCanonicalCellPointersEqual(this.canonicalizePointer(start), this.canonicalizePointer(active))) {
						this.commands.selectRange(start, active, 'keyboard');
					}
					this.extendSelection(targetPointer, 'keyboard');
				} else {
					this.commands.selectCell(targetPointer, 'keyboard');
					if (this.options.arrowKeyNavigationEdit) {
						this.startEdit(targetPointer.rowId, this.getEditTargetColumnIdentity(targetPointer), 'keyboard');
					}
				}
			}
			return;
		}

		switch (event.key) {
			case 'ArrowUp': {
				event.preventDefault();
				const upRow = this.getNextDataRowIndex(row, 'up');
				if (upRow !== -1) {
					void this.commitAndMoveSelection(active, { row: upRow, col }, this.options.arrowKeyNavigationEdit);
				}
				break;
			}
			case 'ArrowDown': {
				event.preventDefault();
				const downRow = this.getNextDataRowIndex(row, 'down');
				if (downRow !== -1) {
					void this.commitAndMoveSelection(active, { row: downRow, col }, this.options.arrowKeyNavigationEdit);
				}
				break;
			}
			case 'ArrowLeft':
				if (this.options.arrowKeyNavigationEdit) {
					event.preventDefault();
					void this.commitAndMoveSelection(active, { row, col: Math.max(0, col - 1) }, true);
				}
				break;
			case 'ArrowRight':
				if (this.options.arrowKeyNavigationEdit) {
					event.preventDefault();
					void this.commitAndMoveSelection(active, { row, col: Math.min(maxCol, col + 1) }, true);
				}
				break;
			case 'Enter': {
				event.preventDefault();
				const nextRowIdx = this.getNextDataRowIndex(row, 'down');
				if (nextRowIdx !== -1) {
					void this.commitAndMoveSelection(active, { row: nextRowIdx, col }, true);
				}
				break;
			}
			case 'Tab': {
				event.preventDefault();
				const tabDest = this.getTabTarget(row, col, maxCol, !event.shiftKey);
				if (tabDest) {
					void this.commitAndMoveSelection(active, { row: tabDest.row, col: tabDest.col }, true);
				}
				break;
			}
			case 'Escape':
				event.preventDefault();
				this.cancelEdit();
				break;
		}
	};

	private moveEditSelection(row: number, col: number, active: GridCellPointer, startEditing = this.options.arrowKeyNavigationEdit): void {
		const target = this.getPointerFromCoords(row, col);
		if (!target) return;
		this.commands.selectCell(target, 'keyboard');
		if (startEditing && !areCanonicalCellPointersEqual(this.canonicalizePointer(target), this.canonicalizePointer(active))) {
			this.startEdit(target.rowId, this.getEditTargetColumnIdentity(target), 'keyboard');
		}
	}

	private async commitAndMoveSelection(
		active: GridCellPointer,
		target: { row: number; col: number },
		startEditing = this.options.arrowKeyNavigationEdit
	): Promise<void> {
		const committed = await this.commitEdit();
		if (!committed) return;
		this.moveEditSelection(target.row, target.col, active, startEditing);
	}

	public handleMouseDown = (pointer: GridCellPointer, event: MouseEvent): void => {
		if (event.button !== 0) return;
		if (event.ctrlKey || event.metaKey) {
			this.commands.applyRowSelectionGesture({ kind: 'toggle', rowIds: [pointer.rowId], source: 'pointer' });
			return;
		}
		const state = this.runtime.getStateSnapshot();
		const interaction = readInteractionState(state);
		const prevFocus = interaction.focus.cell;
		if (
			prevFocus &&
			!areCanonicalCellPointersEqual(prevFocus, this.canonicalizePointer(pointer)) &&
			this.isEditingPointer(prevFocus, interaction.activeEdit.active)
		) {
			this.commitEdit();
		}
		this.isSelecting = true;
		this.commands.selectCell(pointer, 'pointer');
	};

	public handleClick = (pointer: GridCellPointer): void => {
		const trigger = this.options.editTrigger ?? 'doubleClick';
		if (trigger !== 'singleClick') return;
		const state = this.runtime.getStateSnapshot();
		const range = readInteractionState(state).cellSelection.selection.range;
		const isSingleCell = !range || areCanonicalCellPointersEqual(range.start, range.end);
		if (isSingleCell) this.startEdit(pointer.rowId, this.getEditTargetColumnIdentity(pointer), 'mouse');
	};

	public handleMouseEnter = (pointer: GridCellPointer): void => {
		if (!this.isSelecting || !this.getSelectionAnchor()) return;
		this.extendSelection(pointer, 'pointer');
	};

	public handleMouseUp = (): void => {
		this.isSelecting = false;
	};

	public isEditingCell(pointer: GridCellPointer): boolean {
		return this.isEditingPointer(pointer, readInteractionState(this.runtime.getStateSnapshot()).activeEdit.active);
	}

	public selectCell(pointer: GridCellPointer | null, source: GridSelectionSource = 'api'): void {
		this.commands.selectCell(pointer, source);
	}

	public selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'api'): void {
		this.commands.selectRange(start, end, source);
	}

	public extendSelection(end: GridCellPointer, source: GridSelectionSource = 'api'): void {
		const selection = readInteractionState(this.runtime.getStateSnapshot()).cellSelection.selection;
		this.commands.selectRange(selection.anchor ?? selection.focus ?? end, end, source);
	}

	public applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null {
		return this.commands.applyRowSelectionGesture(gesture);
	}

	public copySelectedRange(): Promise<void> {
		return this.commands.copySelectedRange();
	}

	public pasteFromClipboard(): Promise<void> {
		return this.commands.pasteFromClipboard();
	}

	public scrollToCell(rowId: string, colField: string, options?: ScrollToCellOptions): void {
		this.commands.scrollToCell(rowId, colField);
		if (options?.select || options?.edit) {
			this.commands.selectCell({ rowId, colField }, 'api');
		}
		if (options?.edit) {
			this.commands.startEditing(rowId, colField, 'api');
		}
	}

	public scrollToRow(rowId: string, options?: ScrollToRowOptions): void {
		this.commands.scrollToRow(rowId);
		if (options?.select) {
			this.commands.selectRows([rowId]);
		}
	}

	public startEdit(rowId: string, colFieldOrInstanceId: string, source: 'keyboard' | 'mouse' | 'api' = 'api'): void {
		this.commands.startEditing(rowId, colFieldOrInstanceId, source);
	}

	public updateEditDraft(rowId: string, colFieldOrInstanceId: string, value: unknown): void {
		this.commands.updateEditDraft(rowId, colFieldOrInstanceId, value);
	}

	public stopEdit(cancel = false): void {
		if (!cancel) {
			const activeEdit = readInteractionState(this.runtime.getStateSnapshot()).activeEdit.active;
			if (activeEdit) {
				void this.commands.commitEdit(activeEdit.rowId, activeEdit.columnInstanceId, activeEdit.draftValue);
				return;
			}
		}
		this.commands.stopEditing(cancel);
	}

	public commitCellEdit(rowId: string, colFieldOrInstanceId: string, value: unknown): Promise<boolean> {
		return this.commands.commitEdit(rowId, colFieldOrInstanceId, value);
	}

	public setCellEditing(rowId: string, colFieldOrInstanceId: string, isEditing: boolean, source: 'keyboard' | 'mouse' | 'api' = 'api'): void {
		if (isEditing) this.startEdit(rowId, colFieldOrInstanceId, source);
		else this.stopEdit();
	}

	public async commitEdit(): Promise<boolean> {
		const activeEdit = readInteractionState(this.runtime.getStateSnapshot()).activeEdit.active;
		if (!activeEdit) {
			this.stopEdit(false);
			return true;
		}
		return this.commitCellEdit(activeEdit.rowId, activeEdit.columnInstanceId, activeEdit.draftValue);
	}

	public cancelEdit(): void {
		this.stopEdit(true);
	}
}

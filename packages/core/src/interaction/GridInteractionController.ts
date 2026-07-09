import type { GridCellPointer } from '../api/GridApi.js';
import type { GridPluginRuntime } from '../api/GridApiSurfaces.js';
import { areCellPointersEqual } from './cellPointer.js';
import { getColumnInstanceIdentity } from '../columnDef.js';

export interface GridNavigationOptions {
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
}

export interface GridInteractionHandle {
	handleKeyDown(event: KeyboardEvent): void;
	handleMouseDown(pointer: GridCellPointer, event: MouseEvent): void;
	handleClick(pointer: GridCellPointer, event: MouseEvent): void;
	handleMouseEnter(pointer: GridCellPointer): void;
	handleMouseUp(): void;
	setCellEditing(rowId: string, colField: string, isEditing: boolean): void;
	handleRowCheckboxClick(rowId: string, checked: boolean, event: MouseEvent): void;
	handleDataRowClick(pointer: GridCellPointer, event: MouseEvent): void;
	isRowSelectionIgnoredTarget(el: Element | null): boolean;
	handleViewportMouseDown(event: MouseEvent): void;
	updateOptions(options: GridNavigationOptions): void;
	dispose(): void;
}

export class GridInteractionController<TRowData = unknown> implements GridInteractionHandle {
	private isSelecting = false;
	private rangeStart: GridCellPointer | null = null;
	private rowSelectionAnchorId: string | null = null;
	private options: GridNavigationOptions;

	constructor(private readonly runtime: GridPluginRuntime<TRowData>, options: GridNavigationOptions = {}) {
		this.options = options;
	}

	public updateOptions(options: GridNavigationOptions): void {
		this.options = options;
	}

	public dispose(): void {}

	private getPointerFromCoords(rowIdx: number, colIdx: number): GridCellPointer | null {
		const visualRow = this.runtime.getVisualRow(rowIdx);
		const colField = this.runtime.getColumnField(colIdx);
		if (!visualRow || !colField || visualRow.kind !== 'data') return null;
		const col = this.runtime.getColumnDef(colField);
		return {
			rowId: visualRow.rowId,
			colField,
			columnInstanceId: col ? getColumnInstanceIdentity(col) : undefined,
			colId: col?.colId ?? colField,
		};
	}

	private getCoordsFromPointer(pointer: GridCellPointer | null): { rowIdx: number; colIdx: number } | null {
		if (!pointer) return null;
		const rowIdx = this.runtime.getVisualIndexByRowId(pointer.rowId) ?? -1;
		const colIdx = pointer.columnInstanceId
			? this.runtime
					.getDisplayedColumns()
					.findIndex((column) => 'instanceId' in column && (column as { instanceId?: string }).instanceId === pointer.columnInstanceId)
			: this.runtime.getColumnIndex(pointer.colField);
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
		const internalState = (this.runtime as GridPluginRuntime<TRowData> & {
			getState?: () => { rowSelection?: { mode?: 'single' | 'multiple' } | undefined };
		}).getState?.();
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
				if (checked) this.runtime.selectRows(rangeIds, { mode: 'add' });
				else this.runtime.deselectRows(rangeIds);
			}
		} else if (!isMultiple && checked) {
			this.runtime.applyRowSelectionGesture({ kind: 'replace', rowIds: [rowId], source: 'checkbox' });
		} else {
			this.runtime.applyRowSelectionGesture({ kind: 'toggle', rowIds: [rowId], source: 'checkbox' });
		}
		this.rowSelectionAnchorId = rowId;
	}

	public handleDataRowClick(pointer: GridCellPointer, event: MouseEvent): void {
		const state = this.runtime.getStateSnapshot();
		if (!state.columns.some((col) => col.checkboxSelection)) return;
		const col = this.runtime.getColumnDef(pointer.colField);
		if (col?.checkboxSelection) return;
		const rowIndex = this.runtime.getVisualIndexByRowId(pointer.rowId) ?? -1;
		const row = rowIndex >= 0 ? this.runtime.getVisualRow(rowIndex) : null;
		if (row?.kind !== 'data') return;
		const isMultiple = this.isMultipleRowSelectionEnabled();
		if (isMultiple && event.shiftKey && this.rowSelectionAnchorId) {
			const rangeIds = this.getDataRowIdsBetween(this.rowSelectionAnchorId, pointer.rowId);
			if (rangeIds.length > 0) {
				this.runtime.applyRowSelectionGesture({ kind: 'select', rowIds: rangeIds, source: 'pointer' });
				event.preventDefault();
				this.rowSelectionAnchorId = pointer.rowId;
				return;
			}
		}
		if (isMultiple && (event.ctrlKey || event.metaKey)) {
			this.runtime.applyRowSelectionGesture({ kind: 'toggle', rowIds: [pointer.rowId], source: 'pointer' });
		} else {
			this.runtime.applyRowSelectionGesture({ kind: 'replace', rowIds: [pointer.rowId], source: 'pointer' });
		}
		this.rowSelectionAnchorId = pointer.rowId;
	}

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

		if (!isEditing) {
			if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
				event.preventDefault();
				void this.runtime.copySelectedRange();
				return;
			}
			if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
				event.preventDefault();
				void this.runtime.pasteFromClipboard();
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
							this.rangeStart = ptr;
							this.runtime.selectCell(ptr, 'keyboard');
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
					const page = 10;
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
					this.setCellEditing(active.rowId, active.colField, true);
					return;
				case 'Delete':
				case 'Backspace':
					event.preventDefault();
					this.runtime.setCellValue(active.rowId, active.colField, null);
					return;
				case 'Escape':
					event.preventDefault();
					this.runtime.selectCell(null, 'keyboard');
					return;
				default:
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
					const start = this.rangeStart || active;
					this.rangeStart = start;
					this.runtime.extendSelection(targetPointer, 'keyboard');
				} else {
					this.rangeStart = targetPointer;
					this.runtime.selectCell(targetPointer, 'keyboard');
					if (this.options.arrowKeyNavigationEdit) {
						this.setCellEditing(targetPointer.rowId, targetPointer.colField, true);
					}
				}
			}
			return;
		}

		switch (event.key) {
			case 'ArrowUp': {
				event.preventDefault();
				this.commitEdit();
				const upRow = this.getNextDataRowIndex(row, 'up');
				if (upRow !== -1) this.moveEditSelection(upRow, col, active);
				break;
			}
			case 'ArrowDown': {
				event.preventDefault();
				this.commitEdit();
				const downRow = this.getNextDataRowIndex(row, 'down');
				if (downRow !== -1) this.moveEditSelection(downRow, col, active);
				break;
			}
			case 'ArrowLeft':
				if (this.options.arrowKeyNavigationEdit) {
					event.preventDefault();
					this.commitEdit();
					this.moveEditSelection(row, Math.max(0, col - 1), active);
				}
				break;
			case 'ArrowRight':
				if (this.options.arrowKeyNavigationEdit) {
					event.preventDefault();
					this.commitEdit();
					this.moveEditSelection(row, Math.min(maxCol, col + 1), active);
				}
				break;
			case 'Enter': {
				event.preventDefault();
				this.commitEdit();
				const nextRowIdx = this.getNextDataRowIndex(row, 'down');
				if (nextRowIdx !== -1) this.moveEditSelection(nextRowIdx, col, active, true);
				break;
			}
			case 'Tab': {
				event.preventDefault();
				this.commitEdit();
				const tabDest = this.getTabTarget(row, col, maxCol, !event.shiftKey);
				if (tabDest) this.moveEditSelection(tabDest.row, tabDest.col, active, true);
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
		this.rangeStart = target;
		this.runtime.selectCell(target, 'keyboard');
		if (startEditing && !areCellPointersEqual(target, active)) {
			this.setCellEditing(target.rowId, target.colField, true);
		}
	}

	public handleMouseDown = (pointer: GridCellPointer, event: MouseEvent): void => {
		if (event.button !== 0) return;
		if (event.ctrlKey || event.metaKey) {
			this.runtime.applyRowSelectionGesture({ kind: 'toggle', rowIds: [pointer.rowId], source: 'pointer' });
			return;
		}
		const state = this.runtime.getStateSnapshot();
		const prevFocus = state.selection.focus;
		if (
			prevFocus &&
			!areCellPointersEqual(prevFocus, pointer) &&
			this.runtime.getCellState(prevFocus.rowId, prevFocus.colField).isEditing
		) {
			this.commitEdit();
		}
		this.isSelecting = true;
		this.rangeStart = pointer;
		this.runtime.selectCell(pointer, 'pointer');
	};

	public handleClick = (pointer: GridCellPointer): void => {
		const trigger = this.options.editTrigger ?? 'doubleClick';
		if (trigger !== 'singleClick') return;
		const state = this.runtime.getStateSnapshot();
		const range = state.selection.range;
		const isSingleCell = !range || areCellPointersEqual(range.start, range.end);
		if (isSingleCell) this.setCellEditing(pointer.rowId, pointer.colField, true);
	};

	public handleMouseEnter = (pointer: GridCellPointer): void => {
		if (!this.isSelecting || !this.rangeStart) return;
		this.runtime.extendSelection(pointer, 'pointer');
	};

	public handleMouseUp = (): void => {
		this.isSelecting = false;
	};

	public setCellEditing(rowId: string, colField: string, isEditing: boolean): void {
		if (isEditing) this.runtime.startEditing(rowId, colField);
		else this.runtime.stopEditing();
	}

	public commitEdit(): void {
		this.runtime.stopEditing(false);
	}

	public cancelEdit(): void {
		this.runtime.stopEditing(true);
	}
}

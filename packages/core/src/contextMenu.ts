import { GridStore, GridCellPointer, GridPlugin, GridApi, InternalGridApi, GridSelectionState } from './store.js';

export interface ContextMenuParams<TRowData = unknown> {
	rowId: string;
	colField: string;
	api: GridApi<TRowData>;
	selection: GridSelectionState;
}

export interface GridContextMenuItem<TRowData = unknown> {
	label?: string;
	isDivider?: boolean;
	action?: (params: ContextMenuParams<TRowData>) => void;
}

export interface GridContextMenuOptions<TRowData = unknown> {
	excludeDefaults?: Array<'copy' | 'clear' | 'divider' | 'add100' | 'increase10'>;
	customItems?: Array<GridContextMenuItem<TRowData>>;
}

type DefaultContextMenuItemId = NonNullable<GridContextMenuOptions['excludeDefaults']>[number];

export class GridContextMenuPlugin<TRowData = unknown> implements GridPlugin<TRowData> {
	readonly name = 'contextMenu';
	private store!: GridStore<TRowData>;
	private menuElement: HTMLDivElement | null = null;
	private activePointer: GridCellPointer | null = null;
	private options: GridContextMenuOptions<TRowData>;

	constructor(options: GridContextMenuOptions<TRowData> = {}) {
		this.options = options;
	}

	public setOptions(options: GridContextMenuOptions<TRowData>): void {
		this.options = options;
	}

	public onInit(api: InternalGridApi<TRowData>): void {
		this.store = api as GridStore<TRowData>;
	}

	public show(rowId: string, colField: string, clientX: number, clientY: number): void {
		const state = this.store.getState();
		let inSelection = false;
		if (state.selection.bounds) {
			const rowModel = this.store.getRowModel();
			if (rowModel) {
				const clickedRowIdx = rowModel.getRowIndexById(rowId);
				const clickedColIdx = state.columns.findIndex((c) => c.field === colField);
				const bounds = state.selection.bounds;
				if (
					clickedRowIdx >= bounds.minRow &&
					clickedRowIdx <= bounds.maxRow &&
					clickedColIdx >= bounds.minCol &&
					clickedColIdx <= bounds.maxCol
				) {
					inSelection = true;
				}
			}
		}

		if (!inSelection) {
			this.store.selectCell({ rowId, colField }, 'pointer');
		}

		this.activePointer = { rowId, colField };
		this.renderMenu(clientX, clientY);
	}

	public hide = (): void => {
		if (this.menuElement) {
			this.menuElement.classList.remove('og-visible');
			const el = this.menuElement;
			setTimeout(() => {
				el.remove();
			}, 150);
			this.menuElement = null;
		}
		document.removeEventListener('mousedown', this.handleOutsideClick);
		window.removeEventListener('scroll', this.hide, { capture: true });
		window.removeEventListener('resize', this.hide);
	};

	public onDestroy(): void {
		this.hide();
	}

	private handleOutsideClick = (e: MouseEvent): void => {
		if (this.menuElement && !this.menuElement.contains(e.target as Node)) {
			this.hide();
		}
	};

	private renderMenu(clientX: number, clientY: number): void {
		if (this.menuElement) {
			this.menuElement.remove();
		}

		const activePointer = this.activePointer;
		if (!activePointer) return;
		const { rowId, colField } = activePointer;

		const menu = document.createElement('div');
		menu.className = 'og-context-menu';
		this.menuElement = menu;

		const state = this.store.getState();
		const params: ContextMenuParams<TRowData> = {
			rowId,
			colField,
			api: this.store,
			selection: state.selection,
		};

		const defaultItems: Array<{
			id: DefaultContextMenuItemId;
			label?: string;
			isDivider?: boolean;
			action?: (params: ContextMenuParams<TRowData>) => void;
		}> = [
			{ id: 'copy', label: 'Copy Selected Range', action: (p) => this.copySelectedRange(p) },
			{ id: 'clear', label: 'Clear Selection', action: (p) => this.clearSelection(p) },
			{ id: 'divider', isDivider: true },
			{ id: 'add100', label: 'Add 100 to Selection', action: (p) => this.add100ToSelection(p) },
			{ id: 'increase10', label: 'Apply 10% Increase', action: (p) => this.apply10PercentIncrease(p) },
		];

		const exclude = this.options.excludeDefaults || [];
		const activeDefaults = defaultItems.filter((item) => !exclude.includes(item.id));
		const custom = this.options.customItems || [];

		const items = [...activeDefaults, ...custom];

		items.forEach((item) => {
			if (item.isDivider) {
				const divider = document.createElement('div');
				divider.className = 'og-context-menu-divider';
				menu.appendChild(divider);
			} else if (item.label && item.action) {
				const el = document.createElement('div');
				el.className = 'og-context-menu-item';
				el.textContent = item.label;
				el.addEventListener('click', (e) => {
					e.stopPropagation();
					if (item.action) {
						item.action(params);
					}
					this.hide();
				});
				menu.appendChild(el);
			}
		});

		document.body.appendChild(menu);

		const menuWidth = 180;
		const menuHeight = items.length * 35;

		let left = clientX;
		let top = clientY;

		if (clientX + menuWidth > window.innerWidth) {
			left = window.innerWidth - menuWidth - 8;
		}
		if (clientY + menuHeight > window.innerHeight) {
			top = window.innerHeight - menuHeight - 8;
		}

		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;

		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(() => {
				menu.classList.add('og-visible');
			});
		} else {
			menu.classList.add('og-visible');
		}

		document.addEventListener('mousedown', this.handleOutsideClick);
		window.addEventListener('scroll', this.hide, { capture: true, passive: true });
		window.addEventListener('resize', this.hide);
	}

	private copySelectedRange(params: ContextMenuParams<TRowData>): void {
		const bounds = params.selection.bounds;
		const rowModel = this.store.getRowModel();
		if (!bounds || !rowModel) return;

		const rows: string[] = [];
		for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
			const row = rowModel.getRow(r);
			if (!row) continue;
			const rowId = this.store.getRowId(row);
			const rowVals: string[] = [];
			for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
				const col = params.api.getState().columns[c];
				if (!col) continue;
				const val = this.store.getCellValue(rowId, col.field);
				rowVals.push(val !== undefined && val !== null ? String(val) : '');
			}
			rows.push(rowVals.join('\t'));
		}

		const tsvString = rows.join('\n');

		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(tsvString).catch((err) => {
				console.error('Failed to copy selected range: ', err);
			});
		} else {
			const textarea = document.createElement('textarea');
			textarea.value = tsvString;
			textarea.style.position = 'fixed';
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			try {
				document.execCommand('copy');
			} catch (err) {
				console.error('Fallback copy failed: ', err);
			}
			document.body.removeChild(textarea);
		}
	}

	private clearSelection(params: ContextMenuParams<TRowData>): void {
		const bounds = params.selection.bounds;
		const rowModel = this.store.getRowModel();
		if (!bounds || !rowModel) return;

		this.store.batch(() => {
			for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
				const row = rowModel.getRow(r);
				if (!row) continue;
				const rowId = this.store.getRowId(row);
				for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
					const col = params.api.getState().columns[c];
					if (!col) continue;
					this.store.setCellValue(rowId, col.field, '');
				}
			}
		});
	}

	private add100ToSelection(params: ContextMenuParams<TRowData>): void {
		const bounds = params.selection.bounds;
		const rowModel = this.store.getRowModel();
		if (!bounds || !rowModel) return;

		this.store.batch(() => {
			for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
				const row = rowModel.getRow(r);
				if (!row) continue;
				const rowId = this.store.getRowId(row);
				for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
					const col = params.api.getState().columns[c];
					if (!col) continue;
					const val = this.store.getCellValue(rowId, col.field);
					const num = Number(val);
					if (!isNaN(num) && val !== '' && val !== null && val !== undefined) {
						this.store.setCellValue(rowId, col.field, num + 100);
					}
				}
			}
		});
	}

	private apply10PercentIncrease(params: ContextMenuParams<TRowData>): void {
		const bounds = params.selection.bounds;
		const rowModel = this.store.getRowModel();
		if (!bounds || !rowModel) return;

		this.store.batch(() => {
			for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
				const row = rowModel.getRow(r);
				if (!row) continue;
				const rowId = this.store.getRowId(row);
				for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
					const col = params.api.getState().columns[c];
					if (!col) continue;
					const val = this.store.getCellValue(rowId, col.field);
					const num = Number(val);
					if (!isNaN(num) && val !== '' && val !== null && val !== undefined) {
						const multiplied = num * 1.1;
						const rounded = Math.round(multiplied * 1e10) / 1e10;
						this.store.setCellValue(rowId, col.field, rounded);
					}
				}
			}
		});
	}
}

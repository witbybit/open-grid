import { GridStore, GridCellPointer, GridPlugin, GridApi, InternalGridApi, GridSelectionState } from './store.js';

export interface ContextMenuParams<TRowData = unknown> {
	rowId: string;
	colField: string;
	api: GridApi<TRowData>;
	selection: GridSelectionState;
}

export interface GridContextMenuItem<TRowData = unknown> {
	id?: string;
	label?: string;
	isDivider?: boolean;
	icon?: string | HTMLElement;
	action?: (params: ContextMenuParams<TRowData>) => void;
	disabled?: boolean | ((params: ContextMenuParams<TRowData>) => boolean);
	hidden?: boolean | ((params: ContextMenuParams<TRowData>) => boolean);
}

export interface GridContextMenuOptions<TRowData = unknown> {
	disabled?: boolean;
	disableDefaults?: boolean;
	excludeDefaults?: Array<'copy' | 'cut' | 'paste' | 'clear' | 'selectAll' | 'divider'>;
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
		if (this.options.disabled) return;

		const state = this.store.getState();
		let inSelection = false;
		if (state.selection.bounds) {
			const rowModel = this.store.getRowModel();
			if (rowModel) {
				const clickedRowIdx = rowModel.getVisualRowIndexById(rowId);
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

		if (this.options.disabled) return;

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

		const defaultItems: Array<GridContextMenuItem<TRowData>> = [
			{
				id: 'copy',
				label: 'Copy Selected Range',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
				action: (p) => this.copySelectedRange(p),
			},
			{
				id: 'cut',
				label: 'Cut Selection',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="9.8" y1="8.2" x2="21" y2="19"></line><line x1="9.8" y1="15.8" x2="21" y2="5"></line></svg>`,
				action: (p) => this.cutSelectedRange(p),
			},
			{
				id: 'paste',
				label: 'Paste Clipboard',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`,
				action: (p) => {
					this.pasteSelectedRange(p);
				},
			},
			{
				id: 'clear',
				label: 'Clear Selection',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>`,
				action: (p) => this.clearSelection(p),
			},
			{ id: 'divider', isDivider: true },
			{
				id: 'selectAll',
				label: 'Select All',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4"></rect></svg>`,
				action: (p) => this.selectAll(p),
			},
		];

		const exclude = this.options.excludeDefaults || [];
		const activeDefaults = this.options.disableDefaults ? [] : defaultItems.filter((item) => !item.id || !exclude.includes(item.id as any));
		const custom = this.options.customItems || [];

		const items = [...activeDefaults, ...custom];

		const visibleItems = items.filter((item) => {
			if (typeof item.hidden === 'function') {
				return !item.hidden(params);
			}
			return !item.hidden;
		});

		const hasAnyIcon = visibleItems.some((item) => item.icon !== undefined);

		visibleItems.forEach((item) => {
			if (item.isDivider) {
				const divider = document.createElement('div');
				divider.className = 'og-context-menu-divider';
				menu.appendChild(divider);
			} else if (item.label) {
				const el = document.createElement('div');
				el.className = 'og-context-menu-item';

				let isItemDisabled = false;
				if (typeof item.disabled === 'function') {
					isItemDisabled = !!item.disabled(params);
				} else if (item.disabled !== undefined) {
					isItemDisabled = !!item.disabled;
				}

				if (isItemDisabled) {
					el.classList.add('og-disabled');
				}

				if (hasAnyIcon) {
					const iconContainer = document.createElement('div');
					iconContainer.className = 'og-context-menu-item-icon';
					if (item.icon) {
						if (item.icon instanceof HTMLElement) {
							iconContainer.appendChild(item.icon);
						} else if (typeof item.icon === 'string') {
							if (item.icon.trim().startsWith('<')) {
								iconContainer.innerHTML = item.icon;
							} else {
								iconContainer.textContent = item.icon;
							}
						}
					}
					el.appendChild(iconContainer);
				}

				const labelSpan = document.createElement('span');
				labelSpan.className = 'og-context-menu-item-label';
				labelSpan.textContent = item.label;
				el.appendChild(labelSpan);

				if (!isItemDisabled && item.action) {
					el.addEventListener('click', (e) => {
						e.stopPropagation();
						if (item.action) {
							item.action(params);
						}
						this.hide();
					});
				} else if (isItemDisabled) {
					el.addEventListener('click', (e) => {
						e.stopPropagation();
						e.preventDefault();
					});
				}
				menu.appendChild(el);
			}
		});

		document.body.appendChild(menu);

		const menuWidth = 190;
		const menuHeight = visibleItems.length * 35;

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
		if (!bounds) return;

		const rows: string[] = [];
		for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
			const row = params.api.getRow(r);
			if (!row) continue;
			const rowId = params.api.getRowId(row);
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

	private cutSelectedRange(params: ContextMenuParams<TRowData>): void {
		this.copySelectedRange(params);
		this.clearSelection(params);
	}

	private async pasteSelectedRange(params: ContextMenuParams<TRowData>): Promise<void> {
		const bounds = params.selection.bounds;
		if (!bounds) return;

		try {
			const text = await navigator.clipboard.readText();
			if (!text) return;

			const lines = text.split(/\r?\n/);
			this.store.batch(() => {
				for (let r = 0; r < lines.length; r++) {
					const rowIndex = bounds.minRow + r;
					if (rowIndex > bounds.maxRow) break;
					const row = params.api.getRow(rowIndex);
					if (!row) continue;
					const rowId = params.api.getRowId(row);
					const cells = lines[r].split('\t');
					for (let c = 0; c < cells.length; c++) {
						const colIndex = bounds.minCol + c;
						if (colIndex > bounds.maxCol) break;
						const col = params.api.getState().columns[colIndex];
						if (!col) continue;
						this.store.setCellValue(rowId, col.field, cells[c]);
					}
				}
			});
		} catch (err) {
			console.error('Failed to paste selected range: ', err);
		}
	}

	private clearSelection(params: ContextMenuParams<TRowData>): void {
		const bounds = params.selection.bounds;
		if (!bounds) return;

		this.store.batch(() => {
			for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
				const row = params.api.getRow(r);
				if (!row) continue;
				const rowId = params.api.getRowId(row);
				for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
					const col = params.api.getState().columns[c];
					if (!col) continue;
					this.store.setCellValue(rowId, col.field, '');
				}
			}
		});
	}

	private selectAll(params: ContextMenuParams<TRowData>): void {
		const state = params.api.getState();
		const columns = state.columns;
		const rowCount = params.api.getRowCount();
		if (columns.length === 0 || rowCount === 0) return;

		const firstRow = params.api.getRow(0);
		const lastRow = params.api.getRow(rowCount - 1);
		if (!firstRow || !lastRow) return;

		const firstRowId = params.api.getRowId(firstRow);
		const lastRowId = params.api.getRowId(lastRow);

		params.api.selectRange({ rowId: firstRowId, colField: columns[0].field }, { rowId: lastRowId, colField: columns[columns.length - 1].field });
	}
}

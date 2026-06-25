import type { GridApi } from '../api/GridApiFacade.js';
import type { RowId } from '../domains/rows/RowId.js';
import type { GridPlugin } from './GridPluginRegistry.js';

export interface ContextMenuItem {
	readonly label: string;
	readonly action: (rowId: RowId, api: GridApi<unknown>) => void;
	readonly separator?: boolean;
	readonly disabled?: boolean | ((rowId: RowId) => boolean);
}

export interface GridContextMenuOptions {
	/** The scrollable grid container element. */
	container: HTMLElement;
	/** Called to produce the menu items for a right-clicked row. */
	getItems: (rowId: RowId, api: GridApi<unknown>) => ContextMenuItem[];
}

export function registerGridContextMenu<TRow>(options: GridContextMenuOptions): GridPlugin<TRow> {
	return {
		id: 'grid.contextMenu',
		install(api: GridApi<TRow>) {
			let menu: HTMLElement | null = null;

			function closeMenu() {
				menu?.remove();
				menu = null;
			}

			function onContextMenu(e: MouseEvent) {
				e.preventDefault();
				closeMenu();

				// Find which row was right-clicked by walking up to a [data-row-id] element
				const rowEl = (e.target as Element).closest('[data-row-id]');
				const rowId = rowEl?.getAttribute('data-row-id') as RowId | null;
				if (!rowId) return;

				const items = options.getItems(rowId, api as GridApi<unknown>);
				if (items.length === 0) return;

				menu = document.createElement('div');
				menu.style.cssText = [
					'position:fixed',
					`left:${e.clientX}px`,
					`top:${e.clientY}px`,
					'background:var(--og-bg,#fff)',
					'border:1px solid var(--og-border,#ddd)',
					'border-radius:4px',
					'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
					'padding:4px 0',
					'z-index:9999',
					'min-width:160px',
					'font-size:13px',
				].join(';');

				for (const item of items) {
					if (item.separator) {
						const sep = document.createElement('div');
						sep.style.cssText = 'height:1px;background:var(--og-border,#e0e0e0);margin:4px 0';
						menu.appendChild(sep);
						continue;
					}

					const isDisabled = typeof item.disabled === 'function' ? item.disabled(rowId) : (item.disabled ?? false);

					const el = document.createElement('div');
					el.textContent = item.label;
					el.style.cssText = [
						'padding:6px 12px',
						'cursor:pointer',
						'white-space:nowrap',
						isDisabled ? 'opacity:0.5;pointer-events:none' : '',
					].filter(Boolean).join(';');
					if (!isDisabled) {
						el.addEventListener('mouseenter', () => { el.style.background = 'var(--og-primary,#4f46e5)'; el.style.color = '#fff'; });
						el.addEventListener('mouseleave', () => { el.style.background = ''; el.style.color = ''; });
						el.addEventListener('click', () => { item.action(rowId, api as GridApi<unknown>); closeMenu(); });
					}
					menu.appendChild(el);
				}

				document.body.appendChild(menu);
			}

			function onDocClick(e: MouseEvent) {
				if (menu && !menu.contains(e.target as Node)) closeMenu();
			}

			options.container.addEventListener('contextmenu', onContextMenu);
			document.addEventListener('click', onDocClick, true);

			return () => {
				closeMenu();
				options.container.removeEventListener('contextmenu', onContextMenu);
				document.removeEventListener('click', onDocClick, true);
			};
		},
	};
}

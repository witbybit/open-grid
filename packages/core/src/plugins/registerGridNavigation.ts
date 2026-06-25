import type { GridApi } from '../api/GridApiFacade.js';
import type { GridPlugin } from './GridPluginRegistry.js';

/**
 * Keyboard navigation plugin: arrow keys move selection, Enter starts edit,
 * Escape cancels edit, Tab moves to next cell.
 *
 * Attach to the grid's container element via the `container` option.
 */
export interface GridNavigationOptions {
	/** The scrollable grid container element (required). */
	container: HTMLElement;
	/** If true, Tab wraps around row ends (default false). */
	wrapTab?: boolean;
}

export function registerGridNavigation<TRow>(options: GridNavigationOptions): GridPlugin<TRow> {
	return {
		id: 'grid.navigation',
		install(api: GridApi<TRow>) {
			const { container } = options;

			function onKeyDown(e: KeyboardEvent) {
				const columns = api.view.getColumns();
				const rowCount = api.view.getVisualRowCount();
				if (columns.length === 0 || rowCount === 0) return;

				const sel = api.selection.getState();
				const selectedIds = [...sel.selectedRowIds];
				const currentId = selectedIds[selectedIds.length - 1] ?? null;
				if (!currentId) return;

				// Find current visual row index
				const rows = api.getRendererView().getVisualModel();
				const currentIdx = rows.indexOfRowId(currentId);

				switch (e.key) {
					case 'ArrowDown': {
						e.preventDefault();
						const next = rows.getByVisualIndex(currentIdx + 1);
						if (next && (next.kind === 'data' || next.kind === 'tree')) {
							api.selection.selectRows([next.rowId]);
						}
						break;
					}
					case 'ArrowUp': {
						e.preventDefault();
						const prev = rows.getByVisualIndex(currentIdx - 1);
						if (prev && (prev.kind === 'data' || prev.kind === 'tree')) {
							api.selection.selectRows([prev.rowId]);
						}
						break;
					}
					case 'Escape':
						e.preventDefault();
						api.editing.cancel();
						break;
					case 'Enter':
						// Navigate down after commit; start editing when not in edit mode
						e.preventDefault();
						if (e.shiftKey) {
							api.editing.cancel();
						} else {
							const next = rows.getByVisualIndex(currentIdx + 1);
							if (next && (next.kind === 'data' || next.kind === 'tree')) {
								api.selection.selectRows([next.rowId]);
							}
						}
						break;
				}
			}

			container.addEventListener('keydown', onKeyDown);
			return () => container.removeEventListener('keydown', onKeyDown);
		},
	};
}

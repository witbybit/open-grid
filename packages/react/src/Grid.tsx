import { useEffect, useRef, useMemo, type CSSProperties } from 'react';
import {
	createGrid,
	DomGridRenderer,
	ThemeManager,
	isBuiltInThemeName,
} from '@open-grid/core';
import type { GridApi, RowId, SortModel, FilterModel } from '@open-grid/core';
import type { GridNextColumnDef, GridNextProps } from './GridNext.js';

// Re-export for consumers who import from this module.
export type GridColumnDef<TRow> = GridNextColumnDef<TRow>;

export interface GridProps<TRow extends object = Record<string, unknown>> extends Omit<GridNextProps<TRow>, 'columns' | 'rows'> {
	columns: GridColumnDef<TRow>[];
	rows: TRow[];

	// Theme
	theme?: string;

	// Lifecycle callbacks
	onGridReady?: (api: GridApi<TRow>) => void;

	// Change callbacks
	onSortChanged?: (sortModel: SortModel) => void;
	onFilterChanged?: (filterModel: FilterModel) => void;
	onRowSelectionChanged?: (selectedIds: RowId[]) => void;
	onCellClicked?: (params: { rowId: RowId; field: string }) => void;

	// Editing
	editTrigger?: 'singleClick' | 'dblClick';

	// Column pinning
	pinLeftColumns?: string[];
	pinRightColumns?: string[];

	// Column reorder
	enableColumnReorder?: boolean;

	// Style rules (pass-through, stored in ref for future use)
	styleRules?: unknown;

	// Chrome / UI toggles
	showFilterChipBar?: boolean;
	enableContextMenu?: boolean;

	// Sidebar (pass-through for future use)
	sidebar?: unknown;
}

/**
 * Grid — the primary React entry-point for Open Grid on the new GridKernel architecture.
 *
 * API + renderer are co-created inside a single effect so React Strict Mode's
 * cleanup/remount cycle destroys and recreates them as a unit (same pattern as GridNext).
 * Column definitions are fixed at mount time; live prop changes drive row data and event
 * subscriptions only.
 */
export function Grid<TRow extends object = Record<string, unknown>>({
	columns,
	rows,
	getRowId,
	rowHeight,
	defaultColWidth,
	showStatusBar,
	showFloatingFilters,
	showGroupPanel,
	showFilterChipBar,
	enableColumnReorder,
	loading,
	style,
	className,
	theme,
	onGridReady,
	onSortChanged,
	onFilterChanged,
	onRowSelectionChanged,
	onCellClicked,
	editTrigger: _editTrigger,   // reserved for renderer wiring
	pinLeftColumns,
	pinRightColumns,
	styleRules: _styleRules,     // stored below for future pipeline use
	enableContextMenu: _enableContextMenu,
	sidebar: _sidebar,
}: GridProps<TRow>) {
	const containerRef = useRef<HTMLDivElement>(null);
	const apiRef = useRef<GridApi<TRow> | null>(null);

	// Normalize column defs once — columns are fixed at mount time.
	const normalizedCols = useMemo(
		() =>
			columns.map((col) => ({
				...col,
				id: col.id ?? col.field ?? 'col',
			})),
		// intentional: columns are fixed at mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	// Keep rows and callbacks in refs so the mount effect can prime the grid
	// and downstream effects can always read the latest value without being
	// listed as effect dependencies.
	const rowsRef = useRef(rows);
	rowsRef.current = rows;

	// Track pipeline state locally — the public GridApi exposes setters only;
	// we mirror the last-dispatched models here so callbacks receive a value.
	const sortModelRef = useRef<SortModel>([]);
	const filterModelRef = useRef<FilterModel>([]);

	// Callback refs — always current, never stale inside the mount effect.
	const onGridReadyRef = useRef(onGridReady);
	onGridReadyRef.current = onGridReady;

	const onSortChangedRef = useRef(onSortChanged);
	onSortChangedRef.current = onSortChanged;

	const onFilterChangedRef = useRef(onFilterChanged);
	onFilterChangedRef.current = onFilterChanged;

	const onRowSelectionChangedRef = useRef(onRowSelectionChanged);
	onRowSelectionChangedRef.current = onRowSelectionChanged;

	const onCellClickedRef = useRef(onCellClicked);
	onCellClickedRef.current = onCellClicked;

	// Co-create the API + renderer so both are destroyed together on cleanup.
	// This pairs creation/destruction in one effect, which is React Strict Mode safe.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// ── 1. Create the API ──────────────────────────────────────────────────
		const api = createGrid<TRow>({
			columns: normalizedCols,
			getRowId: getRowId as ((row: TRow) => string) | undefined,
			rowHeight: rowHeight ?? 40,
			defaultColWidth,
			showStatusBar,
			showFloatingFilters,
			showGroupPanel: showGroupPanel ?? false,
			showFilterChipBar,
			enableColumnReorder,
			loading,
		});
		apiRef.current = api;

		// ── 2. Apply column pinning ────────────────────────────────────────────
		if (pinLeftColumns && pinLeftColumns.length > 0) {
			for (const field of pinLeftColumns) {
				const colState = api.columns.getState().find((c) => c.field === field || c.id === field);
				if (colState) {
					api.columns.setPinned(colState.id, 'left');
				}
			}
		}
		if (pinRightColumns && pinRightColumns.length > 0) {
			for (const field of pinRightColumns) {
				const colState = api.columns.getState().find((c) => c.field === field || c.id === field);
				if (colState) {
					api.columns.setPinned(colState.id, 'right');
				}
			}
		}

		// ── 3. Create + mount the renderer ────────────────────────────────────
		const renderer = new DomGridRenderer<TRow>(api.getRendererView());
		renderer.mount(container);

		// ── 4. Prime with current rows immediately ─────────────────────────────
		api.rows.replace(rowsRef.current as readonly TRow[]);

		// ── 5. Notify host ─────────────────────────────────────────────────────
		onGridReadyRef.current?.(api);

		// ── 6. Subscribe to events for callbacks ──────────────────────────────
		const unsub = api.subscribe((event) => {
			switch (event.type) {
				case 'pipeline.changed': {
					const reason = (event.payload as { reason?: string } | undefined)?.reason;
					if (reason === 'sort') {
						onSortChangedRef.current?.(sortModelRef.current);
					} else if (reason === 'filter') {
						onFilterChangedRef.current?.(filterModelRef.current);
					}
					break;
				}
				case 'selection.changed': {
					const state = api.selection.getState();
					const ids = Array.from(state.selectedRowIds) as RowId[];
					onRowSelectionChangedRef.current?.(ids);
					break;
				}
				default:
					break;
			}
		});

		// ── 7. Cleanup ─────────────────────────────────────────────────────────
		return () => {
			unsub();
			renderer.unmount();
			api.destroy();
			if (apiRef.current === api) apiRef.current = null;
		};
		// intentional: mount once; columns/options are fixed at construction time
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Sync row data: replace rows whenever the prop array changes identity.
	useEffect(() => {
		apiRef.current?.rows.replace(rows as readonly TRow[]);
	}, [rows]);

	// Theme changes: apply via ThemeManager when the theme prop changes.
	// ThemeManager is scoped to the container element to avoid global style leaks.
	useEffect(() => {
		const container = containerRef.current;
		if (!container || !theme) return;

		const manager = new ThemeManager();
		// Derive a unique selector for this instance using a data attribute.
		const instanceId = `og-${Math.random().toString(36).slice(2, 8)}`;
		container.setAttribute('data-og-theme', instanceId);
		const selector = `.og-grid-container[data-og-theme="${instanceId}"]`;
		manager.mount(selector);

		if (isBuiltInThemeName(theme)) {
			manager.switchTheme(theme, selector);
		} else {
			// Unknown theme name — log a warning; built-in default remains active.
			// TODO: support custom ThemeTokens objects passed as the theme prop.
			console.warn(`[Grid] Unknown theme name: "${theme}". Use one of the built-in theme names or pass a ThemeTokens object.`);
		}

		return () => {
			manager.unmount();
			container.removeAttribute('data-og-theme');
		};
	}, [theme]);

	return (
		<div
			ref={containerRef}
			className={`og-grid-container${className ? ` ${className}` : ''}`}
			style={{ width: '100%', height: '100%', ...style } as CSSProperties}
		/>
	);
}

import { useEffect, useRef, useMemo, useState, type CSSProperties } from 'react';
import {
	createGrid,
	DomGridRenderer,
	ThemeManager,
	isBuiltInThemeName,
	asColumnId,
} from '@open-grid/core';
import type { GridApi, RowId, SortModel, FilterModel, ColumnId, ColumnDef } from '@open-grid/core';
import { GridSidebar } from './sidebar/GridSidebar.js';
import type { GridSidebarConfig } from './sidebar/GridSidebar.js';

export interface GridColumnDef<TRow> extends Omit<ColumnDef<TRow>, 'id'> {
	id?: string;
}

export interface GridProps<TRow extends object = Record<string, unknown>> {
	columns: GridColumnDef<TRow>[];
	rows: TRow[];
	getRowId?: (row: TRow) => string | number;
	rowHeight?: number;
	defaultColWidth?: number;
	showStatusBar?: boolean;
	showFloatingFilters?: boolean;
	showGroupPanel?: boolean;
	showFilterChipBar?: boolean;
	enableColumnReorder?: boolean;
	loading?: boolean;
	style?: CSSProperties;
	className?: string;

	// Theme
	theme?: string;

	// Lifecycle callbacks
	onGridReady?: (api: GridApi<TRow>) => void;
	/** Called once after the grid is mounted. Alias for onGridReady. */
	onMount?: (api: GridApi<TRow>) => void;

	// Change callbacks
	onSortChanged?: (sortModel: SortModel) => void;
	onFilterChanged?: (filterModel: FilterModel) => void;
	onRowSelectionChanged?: (selectedIds: RowId[]) => void;
	onCellClicked?: (params: { rowId: RowId; field: string }) => void;
	onCellValueChanged?: (rowId: RowId, field: string, value: unknown) => void;

	// Column pinning — number: pin first N; string[]: pin by field name
	pinLeftColumns?: number | string[];
	pinRightColumns?: number | string[];

	// Sidebar
	sidebar?: GridSidebarConfig<TRow>;
}

/**
 * Grid — primary React entry-point for Open Grid on the new GridKernel architecture.
 *
 * API + renderer are co-created inside a single effect so React Strict Mode's
 * cleanup/remount cycle destroys and recreates them as a unit.
 * Column definitions are fixed at mount time; live prop changes drive row data only.
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
	onMount,
	onSortChanged,
	onFilterChanged,
	onRowSelectionChanged,
	onCellClicked,
	onCellValueChanged,
	pinLeftColumns,
	pinRightColumns,
	sidebar,
}: GridProps<TRow>) {
	const containerRef = useRef<HTMLDivElement>(null);
	const apiRef = useRef<GridApi<TRow> | null>(null);
	const [mountedApi, setMountedApi] = useState<GridApi<TRow> | null>(null);

	// Normalize column defs once — columns are fixed at mount time.
	const normalizedCols = useMemo<ColumnDef<TRow>[]>(
		() =>
			columns.map((col) => ({
				...col,
				id: col.id ?? col.field ?? 'col',
			})),
		// intentional: columns are fixed at mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	const rowsRef = useRef(rows);
	rowsRef.current = rows;

	// Callback refs — always current, never stale.
	const onGridReadyRef = useRef(onGridReady);
	onGridReadyRef.current = onGridReady;
	const onMountRef = useRef(onMount);
	onMountRef.current = onMount;
	const onSortChangedRef = useRef(onSortChanged);
	onSortChangedRef.current = onSortChanged;
	const onFilterChangedRef = useRef(onFilterChanged);
	onFilterChangedRef.current = onFilterChanged;
	const onRowSelectionChangedRef = useRef(onRowSelectionChanged);
	onRowSelectionChangedRef.current = onRowSelectionChanged;
	const onCellClickedRef = useRef(onCellClicked);
	onCellClickedRef.current = onCellClicked;
	const onCellValueChangedRef = useRef(onCellValueChanged);
	onCellValueChangedRef.current = onCellValueChanged;

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
		const applyPins = (spec: number | string[] | undefined, side: 'left' | 'right') => {
			if (!spec) return;
			const cols = typeof spec === 'number'
				? (side === 'left'
					? normalizedCols.slice(0, spec)
					: normalizedCols.slice(normalizedCols.length - spec))
				: normalizedCols.filter((c) => (spec as string[]).includes(c.field ?? c.id ?? ''));
			for (const col of cols) {
				api.columns.setPinned(asColumnId(col.id ?? col.field ?? ''), side);
			}
		};
		applyPins(pinLeftColumns, 'left');
		applyPins(pinRightColumns, 'right');

		// ── 3. Create + mount the renderer ────────────────────────────────────
		const renderer = new DomGridRenderer<TRow>(api.getRendererView());

		renderer.setSortCallback((field) => {
			const current = api.pipeline.getSortModel();
			const existing = current.find((s) => s.field === field);
			const nextDir: 'asc' | 'desc' | null =
				!existing ? 'asc' : existing.direction === 'asc' ? 'desc' : null;
			const nextModel = nextDir === null
				? current.filter((s) => s.field !== field)
				: [...current.filter((s) => s.field !== field), { field, columnId: field as ColumnId, direction: nextDir }];
			api.pipeline.setSortModel(nextModel);
		});
		renderer.setResizeCallback((field, newWidth) => {
			const col = api.columns.getState().find((c) => c.field === field);
			if (col) api.columns.resize(col.columnId, newWidth);
		});
		renderer.setGroupToggleCallback((groupKey) => {
			api.pipeline.toggleGroupExpanded(groupKey);
		});
		renderer.setTreeToggleCallback((rowId) => {
			api.pipeline.toggleTreeNode(rowId);
		});
		renderer.setDetailToggleCallback((rowId) => {
			api.pipeline.toggleDetail(rowId);
		});
		renderer.setFloatingFilterChangeCallback((field, value, operator) => {
			const current = api.pipeline.getFilterModel();
			const col = api.columns.getState().find((c) => c.field === field);
			if (!col) return;
			if (!value) {
				api.pipeline.setFilterModel(current.filter((f) => f.field !== field));
			} else {
				api.pipeline.setFilterModel([
					...current.filter((f) => f.field !== field),
					{ columnId: col.columnId, field, operator, value },
				]);
			}
		});
		renderer.setFilterChipRemoveCallback((columnId) => {
			api.pipeline.setFilterModel(
				api.pipeline.getFilterModel().filter((f) => String(f.columnId) !== columnId),
			);
		});
		renderer.setGroupPanelRemoveCallback((columnId) => {
			api.pipeline.setGroupBy(
				api.pipeline.getGroupBy().filter((g) => String(g.columnId) !== columnId),
			);
		});

		renderer.mount(container);

		// ── 4. Prime with current rows ─────────────────────────────────────────
		api.rows.replace(rowsRef.current as readonly TRow[]);

		// ── 5. Notify host ─────────────────────────────────────────────────────
		setMountedApi(api);
		onGridReadyRef.current?.(api);
		onMountRef.current?.(api);

		if (sidebar?.defaultOpen) {
			api.sidebar.openPanel(sidebar.defaultOpen);
		}

		// ── 6. Subscribe to kernel events ────────────────────────────────────
		const unsub = api.subscribe((event) => {
			switch (event.type) {
				case 'pipeline.changed': {
					const reason = (event.payload as { reason?: string } | undefined)?.reason;
					if (reason === 'sort') onSortChangedRef.current?.(api.pipeline.getSortModel());
					else if (reason === 'filter') onFilterChangedRef.current?.(api.pipeline.getFilterModel());
					break;
				}
				case 'selection.changed': {
					const ids = Array.from(api.selection.getState().selectedRowIds) as RowId[];
					onRowSelectionChangedRef.current?.(ids);
					break;
				}
				case 'cells.changed': {
					if (onCellValueChangedRef.current) {
						const changes = (event.payload as { changes?: Array<{ rowId: RowId; field: string; value: unknown }> })?.changes ?? [];
						for (const c of changes) onCellValueChangedRef.current(c.rowId, c.field, c.value);
					}
					break;
				}
				default:
					break;
			}
		});

		// ── 7. Cleanup ─────────────────────────────────────────────────────────
		return () => {
			setMountedApi(null);
			unsub();
			renderer.unmount();
			api.destroy();
			if (apiRef.current === api) apiRef.current = null;
		};
		// intentional: mount once
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Sync rows whenever prop changes identity.
	useEffect(() => {
		apiRef.current?.rows.replace(rows as readonly TRow[]);
	}, [rows]);

	// Apply theme when it changes.
	useEffect(() => {
		const container = containerRef.current;
		if (!container || !theme) return;
		const manager = new ThemeManager();
		const instanceId = `og-${Math.random().toString(36).slice(2, 8)}`;
		container.setAttribute('data-og-theme', instanceId);
		const selector = `.og-grid-container[data-og-theme="${instanceId}"]`;
		manager.mount(selector);
		if (isBuiltInThemeName(theme)) {
			manager.switchTheme(theme, selector);
		}
		return () => {
			manager.unmount();
			container.removeAttribute('data-og-theme');
		};
	}, [theme]);

	return (
		<div
			className={className}
			style={{ width: '100%', height: '100%', display: 'flex', overflow: 'hidden', ...style } as CSSProperties}
		>
			<div
				ref={containerRef}
				className="og-grid-container"
				style={{ flex: 1, minWidth: 0, height: '100%' }}
			/>
			{sidebar && mountedApi && (
				<GridSidebar
					api={mountedApi}
					config={sidebar}
					container={containerRef.current}
				/>
			)}
		</div>
	);
}

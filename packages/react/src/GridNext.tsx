import { useEffect, useRef, useMemo, type CSSProperties } from 'react';
import { createGrid, DomGridRenderer } from '@open-grid/core/next';
import type { ColumnDef } from '@open-grid/core/next';
import type { GridApi } from '@open-grid/core/next';

export interface GridNextColumnDef<TRow> extends Omit<ColumnDef<TRow>, 'id'> {
	id?: string;
}

export interface GridNextProps<TRow = unknown> {
	columns: GridNextColumnDef<TRow>[];
	rows: TRow[];
	getRowId?: (row: TRow) => string | number;
	rowHeight?: number;
	defaultColWidth?: number;
	showStatusBar?: boolean;
	showFloatingFilters?: boolean;
	showGroupPanel?: boolean;
	loading?: boolean;
	style?: CSSProperties;
	className?: string;
}

/**
 * React adapter for the new command-driven engine (ARCHITECTURE.md §1). Mounts
 * {@link DomGridRenderer} into a container div; the renderer owns the DOM, React is adapter-only.
 * Column definitions are fixed at mount time — React props drive row data + display state only.
 *
 * API + renderer are co-created in a single useEffect so React Strict Mode's cleanup/remount
 * cycle destroys and recreates them as a unit, preventing "dispatch on destroyed kernel" errors.
 */
export function GridNext<TRow = unknown>({
	columns,
	rows,
	getRowId,
	rowHeight,
	defaultColWidth,
	showStatusBar,
	showFloatingFilters,
	showGroupPanel,
	loading,
	style,
	className,
}: GridNextProps<TRow>) {
	const containerRef = useRef<HTMLDivElement>(null);
	const apiRef = useRef<GridApi<TRow> | null>(null);

	// Normalize column defs once — columns are fixed at mount time.
	// We memoize against an empty dep array so the same array instance is used on remount.
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

	// Keep rows current in a ref so the mount effect can prime the grid
	// and the rows-sync effect can dispatch without caring about API lifecycle.
	const rowsRef = useRef(rows);
	rowsRef.current = rows;

	// Co-create the API + renderer so both are destroyed together on cleanup.
	// This pairs creation/destruction in one effect, which is React Strict Mode safe.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const api = createGrid<TRow>({
			columns: normalizedCols,
			getRowId: getRowId as ((row: TRow) => string) | undefined,
			rowHeight: rowHeight ?? 40,
			defaultColWidth,
			showStatusBar,
			showFloatingFilters,
			showGroupPanel: showGroupPanel ?? false,
			loading,
		});
		apiRef.current = api;

		const renderer = new DomGridRenderer<TRow>(api.getRendererView());
		renderer.mount(container);

		// Prime with current rows immediately so the first paint has data.
		api.rows.replace(rowsRef.current as readonly TRow[]);

		return () => {
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

	return (
		<div
			ref={containerRef}
			className={`og-grid-container${className ? ` ${className}` : ''}`}
			style={{ width: '100%', height: '100%', ...style }}
		/>
	);
}

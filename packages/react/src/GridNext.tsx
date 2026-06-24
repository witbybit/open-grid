import { useEffect, useRef, createPortal, useMemo, type CSSProperties } from 'react';
import { createGrid, DomGridRenderer } from '@open-grid/core/next';
import type { ColumnDef } from '@open-grid/core/next';

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

	// Normalize column defs: supply id from field if omitted.
	const normalizedCols = useMemo<ColumnDef<TRow>[]>(
		() =>
			columns.map((col) => ({
				...col,
				id: col.id ?? col.field ?? 'col',
			})),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: columns fixed at mount
		[],
	);

	// Create the API once — the kernel + all domains live here.
	const api = useMemo(
		() =>
			createGrid<TRow>({
				columns: normalizedCols,
				getRowId: getRowId as ((row: TRow) => string) | undefined,
				rowHeight: rowHeight ?? 40,
				defaultColWidth,
				showStatusBar,
				showFloatingFilters,
				showGroupPanel: showGroupPanel ?? false,
				loading,
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: stable once
		[],
	);

	// Destroy the grid when the component unmounts.
	useEffect(() => () => api.destroy(), [api]);

	// Mount the DOM renderer once the container ref is ready.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const view = api.getRendererView();
		const renderer = new DomGridRenderer<TRow>(view);
		renderer.mount(container);
		return () => renderer.unmount();
	}, [api]);

	// Sync row data: replace rows whenever the prop array changes identity.
	useEffect(() => {
		api.rows.replace(rows as readonly TRow[]);
	}, [api, rows]);

	return (
		<div
			ref={containerRef}
			className={`og-grid-container${className ? ` ${className}` : ''}`}
			style={{ width: '100%', height: '100%', ...style }}
		/>
	);
}

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ReactNode, UIEvent } from 'react';
import { createGrid, RowSlotPool } from '@open-grid/core/next';
import type { GridApi, GridColumnHeader, GridCoreOptions, RowId, RowRenderPlan, SortModel } from '@open-grid/core/next';
import { GridApiProvider } from './GridContext.js';

export interface CellRenderParams<TRow> {
	readonly value: unknown;
	readonly rowId: RowId;
	readonly columnId: string;
	readonly field: string;
	readonly api: GridApi<TRow>;
}

export type CellRenderer<TRow> = (params: CellRenderParams<TRow>) => ReactNode;

const HEADER_HEIGHT = 32;

export interface KernelGridProps<TRow> {
	/** Create the grid from options (the adapter owns its lifecycle), … */
	readonly options?: GridCoreOptions<TRow>;
	/** …or supply an externally-owned API (the adapter will not destroy it). */
	readonly api?: GridApi<TRow>;
	readonly height: number;
	readonly width: number;
	/** Custom cell renderers keyed by column id; falls back to `String(value)`. */
	readonly cellRenderers?: Record<string, CellRenderer<TRow>>;
	/** Optional content rendered inside the provider (toolbars, overlays) — shares the same API. */
	readonly children?: ReactNode;
}

/** Cycle a column's sort: none → asc → desc → none, single-column. */
function nextSortModel(columns: readonly GridColumnHeader[], columnId: string): SortModel {
	const col = columns.find((c) => String(c.columnId) === columnId);
	if (!col) return [];
	const dir = col.sortDirection;
	if (dir === null) return [{ columnId: col.columnId, field: col.field, direction: 'asc' }];
	if (dir === 'asc') return [{ columnId: col.columnId, field: col.field, direction: 'desc' }];
	return [];
}

/**
 * The React grid adapter (ARCHITECTURE.md §3 R12–R13). It creates the kernel/API exactly once,
 * exposes it via context, and PAINTS the render plan. It never reaches into row models or any
 * `GridStore` — it reads `api.view.getRenderPlan()` and renders the windowed rows. Scroll updates
 * the viewport directly (runtime state); kernel events drive re-render.
 *
 * `rowModelType` is fixed at mount: the API is created once and never recreated from changed props.
 */
export function KernelGrid<TRow>(props: KernelGridProps<TRow>) {
	const { height, width } = props;

	const apiRef = useRef<GridApi<TRow> | null>(null);
	if (!apiRef.current) {
		if (props.api) {
			apiRef.current = props.api;
		} else if (props.options) {
			apiRef.current = createGrid<TRow>(props.options);
		} else {
			throw new Error('KernelGrid requires either `options` or `api`');
		}
	}
	const api = apiRef.current;
	const owned = !props.api;

	// Reusable row-slot pool — drives stable-key slot virtualization (R13), see render below.
	const slotPoolRef = useRef<RowSlotPool | null>(null);
	if (!slotPoolRef.current) slotPoolRef.current = new RowSlotPool();

	// Initialise the viewport once, during the first render, so the first paint is already windowed
	// (idempotent on the freshly created API).
	const initedRef = useRef(false);
	if (!initedRef.current) {
		api.view.setViewport(0, 0, width, height);
		initedRef.current = true;
	}

	const [, force] = useReducer((n: number) => n + 1, 0);

	useEffect(() => api.subscribe(() => force()), [api]);

	useEffect(() => {
		api.view.setViewport(0, 0, width, height);
		force();
	}, [api, width, height]);

	useEffect(() => {
		return () => {
			if (owned) api.destroy();
		};
	}, [api, owned]);

	const onScroll = useCallback(
		(event: UIEvent<HTMLDivElement>) => {
			const el = event.currentTarget;
			api.view.setViewport(el.scrollTop, el.scrollLeft, width, height);
			force();
		},
		[api, width, height],
	);

	const columns = api.view.getColumns();
	const plan = api.view.getRenderPlan();
	const renderers = props.cellRenderers;

	// Slot virtualization (R13): assign each visible row a reusable slot id. React keys are slot
	// ids, not row identities — so scrolling REBINDS a slot's DOM node to a different row instead
	// of unmounting/mounting one. Element count stays at the pool's high-water mark.
	const slots = slotPoolRef.current.sync(plan.rows.map((row) => row.visualRowId));

	const onHeaderClick = (column: GridColumnHeader) => {
		if (!column.sortable) return;
		api.pipeline.setSortModel(nextSortModel(columns, String(column.columnId)));
		force();
	};

	return (
		<GridApiProvider api={api}>
			<div data-testid="kernel-grid-root" style={{ width, position: 'relative' }}>
				<div
					data-testid="grid-header"
					style={{ height: HEADER_HEIGHT, width, position: 'relative', overflow: 'hidden' }}
				>
					{columns.map((column) => (
						<div
							key={String(column.columnId)}
							data-testid="grid-header-cell"
							data-col-id={String(column.columnId)}
							data-sort={column.sortDirection ?? ''}
							onClick={() => onHeaderClick(column)}
							style={{
								position: 'absolute',
								left: column.left,
								width: column.width,
								height: HEADER_HEIGHT,
								cursor: column.sortable ? 'pointer' : 'default',
							}}
						>
							{column.header}
							{column.sortDirection === 'asc' ? ' ▲' : column.sortDirection === 'desc' ? ' ▼' : ''}
						</div>
					))}
				</div>
				<div
					data-testid="kernel-grid"
					onScroll={onScroll}
					style={{ height, width, overflow: 'auto', position: 'relative' }}
				>
					<div style={{ height: plan.totalHeight, width: plan.totalWidth, position: 'relative' }}>
						{plan.rows.map((row) => {
							const slotId = slots.assignments.get(row.visualRowId) ?? -1;
							return (
								<div
									key={slotId}
									data-testid="grid-row"
									data-slot-id={slotId}
									data-row-id={row.rowId ? String(row.rowId) : ''}
									data-kind={row.kind}
									style={{ position: 'absolute', top: row.top, height: row.height, width: plan.totalWidth }}
								>
									{renderRowContent(row, plan.totalWidth, renderers, api)}
								</div>
							);
						})}
					</div>
				</div>
			</div>
			{props.children}
		</GridApiProvider>
	);
}

function formatValue(value: unknown): string {
	return value == null ? '' : String(value);
}

/**
 * Render a slot's content by the visual row's kind (R5–R6). `data`/`tree` rows render cells;
 * `group`/`detail`/`loading`/`placeholder` are full-width constructs. The pipeline EMITS these
 * kinds (group/tree/detail/loading land with the grouping, tree, master-detail, and infinite/server
 * tranches); this switch is the seam so those slot in without re-touching the render loop. A
 * non-data row is never editable/selectable — it carries no `RowId`.
 */
function renderRowContent<TRow>(
	row: RowRenderPlan,
	totalWidth: number,
	renderers: Record<string, CellRenderer<TRow>> | undefined,
	api: GridApi<TRow>,
): ReactNode {
	switch (row.kind) {
		case 'data':
		case 'tree':
			return row.cells.map((cell) => {
				const renderer = renderers?.[String(cell.columnId)];
				const content =
					renderer && row.rowId
						? renderer({ value: cell.value, rowId: row.rowId, columnId: String(cell.columnId), field: cell.field, api })
						: formatValue(cell.value);
				return (
					<div
						key={String(cell.columnId)}
						data-testid="grid-cell"
						data-col-id={String(cell.columnId)}
						style={{ position: 'absolute', left: cell.left, width: cell.width, height: row.height }}
					>
						{content}
					</div>
				);
			});
		case 'group':
			return (
				<div data-testid="grid-group-row" style={{ width: totalWidth, height: row.height }}>
					{/* group header (label + expand toggle) filled in by the grouping tranche */}
				</div>
			);
		case 'detail':
			return (
				<div data-testid="grid-detail-row" style={{ width: totalWidth, height: row.height }}>
					{/* master/detail panel rendered via a detailRenderer prop in the master-detail tranche */}
				</div>
			);
		case 'loading':
		case 'placeholder':
			return (
				<div data-testid="grid-loading-row" style={{ width: totalWidth, height: row.height }}>
					{/* skeleton for an unloaded infinite/server window */}
				</div>
			);
		default:
			return null;
	}
}

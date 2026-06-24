import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ReactNode, UIEvent } from 'react';
import { createGrid } from '@open-grid/core/next';
import type { GridApi, GridCoreOptions } from '@open-grid/core/next';
import { GridApiProvider } from './GridContext.js';

export interface KernelGridProps<TRow> {
	/** Create the grid from options (the adapter owns its lifecycle), … */
	readonly options?: GridCoreOptions<TRow>;
	/** …or supply an externally-owned API (the adapter will not destroy it). */
	readonly api?: GridApi<TRow>;
	readonly height: number;
	readonly width: number;
	/** Optional content rendered inside the provider (toolbars, overlays) — shares the same API. */
	readonly children?: ReactNode;
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

	const plan = api.view.getRenderPlan();

	return (
		<GridApiProvider api={api}>
			<div
				data-testid="kernel-grid"
				onScroll={onScroll}
				style={{ height, width, overflow: 'auto', position: 'relative' }}
			>
				<div style={{ height: plan.totalHeight, width: plan.totalWidth, position: 'relative' }}>
					{plan.rows.map((row) => (
						<div
							key={String(row.visualRowId)}
							data-testid="grid-row"
							data-row-id={row.rowId ? String(row.rowId) : ''}
							style={{ position: 'absolute', top: row.top, height: row.height, width: plan.totalWidth }}
						>
							{row.cells.map((cell) => (
								<div
									key={String(cell.columnId)}
									data-testid="grid-cell"
									data-col-id={String(cell.columnId)}
									style={{ position: 'absolute', left: cell.left, width: cell.width, height: row.height }}
								>
									{formatValue(cell.value)}
								</div>
							))}
						</div>
					))}
				</div>
			</div>
			{props.children}
		</GridApiProvider>
	);
}

function formatValue(value: unknown): string {
	return value == null ? '' : String(value);
}

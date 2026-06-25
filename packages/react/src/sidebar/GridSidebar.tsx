import { useSyncExternalStore, type ReactNode } from 'react';
import type { GridApi } from '@open-grid/core';
import { ColumnsPanel } from './panels/ColumnsPanel.js';
import { FiltersPanel } from './panels/FiltersPanel.js';
import { SortPanel } from './panels/SortPanel.js';
import { ThemesPanel } from './panels/ThemesPanel.js';
import { StubPanel } from './panels/StubPanel.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BuiltInPanelId = 'columns' | 'filters' | 'sort' | 'themes' | 'views' | 'query' | 'dataIntegrity';

export interface SidebarPanelDef<TRowData = unknown> {
	id: string;
	label: string;
	icon?: string;
	render: (api: GridApi<TRowData>) => ReactNode;
}

export interface GridSidebarConfig<TRowData = unknown> {
	/** Pixel width of the open panel (default 264). */
	width?: number;
	/** Which side to dock the tab strip (default 'right'). */
	position?: 'left' | 'right';
	/** Which panel to open by default. */
	defaultOpen?: BuiltInPanelId | string;
	/** Override the set of visible panels. Defaults to all built-in panels. */
	panels?: Array<BuiltInPanelId | SidebarPanelDef<TRowData>>;
}

// ---------------------------------------------------------------------------
// Built-in panel metadata
// ---------------------------------------------------------------------------

const BUILT_IN_META: Record<BuiltInPanelId, { label: string; icon: string }> = {
	columns:       { label: 'Columns',        icon: '⊞' },
	filters:       { label: 'Filters',         icon: '⌾' },
	sort:          { label: 'Sort',            icon: '⇅' },
	themes:        { label: 'Themes',          icon: '◑' },
	views:         { label: 'Views',           icon: '⊕' },
	query:         { label: 'Query',           icon: '⌖' },
	dataIntegrity: { label: 'Data Integrity',  icon: '✓' },
};

const ALL_BUILT_IN: BuiltInPanelId[] = ['columns', 'filters', 'sort', 'themes', 'views', 'query', 'dataIntegrity'];

// ---------------------------------------------------------------------------
// GridSidebar
// ---------------------------------------------------------------------------

interface GridSidebarProps<TRowData> {
	api: GridApi<TRowData>;
	config: GridSidebarConfig<TRowData>;
	/** The grid container element — passed to panels that need to apply CSS scoped to the grid. */
	container?: HTMLElement | null;
}

export function GridSidebar<TRowData = unknown>({ api, config, container }: GridSidebarProps<TRowData>) {
	const openPanel = useSyncExternalStore(
		api.sidebar.subscribe,
		api.sidebar.getOpenPanel,
		api.sidebar.getOpenPanel,
	);

	const panelWidth = config.width ?? 264;
	const position = config.position ?? 'right';

	// Resolve panel list
	const panelDefs = (config.panels ?? ALL_BUILT_IN).map((p): SidebarPanelDef<TRowData> => {
		if (typeof p === 'string') {
			const meta = BUILT_IN_META[p as BuiltInPanelId];
			return {
				id: p,
				label: meta?.label ?? p,
				icon: meta?.icon,
				render: (a) => renderBuiltIn(p as BuiltInPanelId, a as GridApi<unknown>, container ?? null) as ReactNode,
			};
		}
		return p;
	});

	const activePanel = panelDefs.find((p) => p.id === openPanel);

	const tabStrip = (
		<div
			style={{
				width: '44px',
				flexShrink: 0,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				borderLeft: position === 'right' ? '1px solid var(--og-border, #e0e0e0)' : undefined,
				borderRight: position === 'left' ? '1px solid var(--og-border, #e0e0e0)' : undefined,
				background: 'var(--og-header-bg, #f5f5f5)',
				gap: '2px',
				paddingTop: '4px',
			}}
		>
			{panelDefs.map((panel) => {
				const isActive = openPanel === panel.id;
				return (
					<button
						key={panel.id}
						title={panel.label}
						onClick={() => api.sidebar.togglePanel(panel.id)}
						style={{
							width: '36px',
							height: '36px',
							border: 'none',
							borderRadius: '4px',
							background: isActive ? 'var(--og-primary, #4f46e5)' : 'transparent',
							color: isActive ? '#fff' : 'var(--og-cell-text, #555)',
							cursor: 'pointer',
							fontSize: '16px',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							transition: 'background 0.15s',
						}}
					>
						{panel.icon ?? panel.label[0] ?? '?'}
					</button>
				);
			})}
		</div>
	);

	const panelContent = (
		<div
			style={{
				width: openPanel ? `${panelWidth}px` : '0px',
				overflow: 'hidden',
				transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
				flexShrink: 0,
				background: 'var(--og-bg, #fff)',
				borderLeft: position === 'right' ? '1px solid var(--og-border, #e0e0e0)' : undefined,
				borderRight: position === 'left' ? '1px solid var(--og-border, #e0e0e0)' : undefined,
				display: 'flex',
				flexDirection: 'column',
			}}
		>
			{activePanel && (
				<div style={{ minWidth: `${panelWidth}px`, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
					{/* Panel header */}
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							padding: '8px 12px',
							borderBottom: '1px solid var(--og-border, #e0e0e0)',
							background: 'var(--og-header-bg, #f5f5f5)',
							flexShrink: 0,
						}}
					>
						<span style={{ fontSize: '13px', fontWeight: 600 }}>{activePanel.label}</span>
						<button
							onClick={() => api.sidebar.closePanel()}
							style={{
								border: 'none',
								background: 'transparent',
								cursor: 'pointer',
								fontSize: '14px',
								color: 'var(--og-cell-text, #555)',
								padding: '2px 4px',
							}}
						>
							✕
						</button>
					</div>
					{/* Panel body */}
					<div style={{ flex: 1, overflowY: 'auto' }}>
						{activePanel.render(api)}
					</div>
				</div>
			)}
		</div>
	);

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: position === 'left' ? 'row-reverse' : 'row',
				height: '100%',
				flexShrink: 0,
				overflow: 'hidden',
			}}
		>
			{panelContent}
			{tabStrip}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Built-in panel renderer
// ---------------------------------------------------------------------------

function renderBuiltIn(id: BuiltInPanelId, api: GridApi<unknown>, container: HTMLElement | null): ReactNode {
	switch (id) {
		case 'columns':
			return <ColumnsPanel api={api} />;
		case 'filters':
			return <FiltersPanel api={api} />;
		case 'sort':
			return <SortPanel api={api} />;
		case 'themes':
			return <ThemesPanel api={api} container={container} />;
		case 'views':
			return <StubPanel title="Views" />;
		case 'query':
			return <StubPanel title="Query Builder" />;
		case 'dataIntegrity':
			return <StubPanel title="Data Integrity" />;
	}
}

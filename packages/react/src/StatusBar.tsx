import { useSyncExternalStore } from 'react';
import type { GridApi } from '@open-grid/core';

interface StatusBarProps {
	api: GridApi<unknown>;
}

export function StatusBar({ api }: StatusBarProps) {
	const data = useSyncExternalStore(
		api.statusBar.subscribe,
		api.statusBar.getData,
		api.statusBar.getData,
	);

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: '16px',
				padding: '0 12px',
				height: '28px',
				borderTop: '1px solid var(--og-border, #e0e0e0)',
				background: 'var(--og-header-bg, #f5f5f5)',
				fontSize: '12px',
				color: 'var(--og-cell-text-muted, #666)',
				flexShrink: 0,
				overflowX: 'auto',
				whiteSpace: 'nowrap',
			}}
		>
			{data.panels.map((panel) => (
				<span key={panel.id}>
					<span style={{ fontWeight: 500 }}>{panel.label}: </span>
					<span>{panel.value}</span>
				</span>
			))}
		</div>
	);
}

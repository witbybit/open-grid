import { useState, useEffect } from 'react';
import type { GridApi } from '@open-grid/core';
import { BUILT_IN_THEMES, BUILT_IN_THEME_ORDER, isBuiltInThemeName, ThemeManager } from '@open-grid/core';
import type { BuiltInThemeName } from '@open-grid/core';

interface ThemesPanelProps {
	api: GridApi<unknown>;
	container: HTMLElement | null;
}

const THEME_LABELS: Record<BuiltInThemeName, string> = {
	light: 'Light',
	dark: 'Dark',
	'high-contrast': 'High Contrast',
	blue: 'Blue',
	green: 'Green',
	amber: 'Amber',
	rose: 'Rose',
};

export function ThemesPanel({ api: _api, container }: ThemesPanelProps) {
	const [activeTheme, setActiveTheme] = useState<BuiltInThemeName>('light');
	const [manager] = useState(() => new ThemeManager());

	useEffect(() => {
		if (!container) return;
		const instanceId = container.getAttribute('data-og-theme') ?? `og-theme-${Math.random().toString(36).slice(2, 6)}`;
		container.setAttribute('data-og-theme', instanceId);
		const selector = `.og-grid-container[data-og-theme="${instanceId}"]`;
		manager.mount(selector);
		return () => { manager.unmount(); };
	}, [container, manager]);

	function applyTheme(name: BuiltInThemeName) {
		if (!container) return;
		const instanceId = container.getAttribute('data-og-theme');
		if (!instanceId) return;
		const selector = `.og-grid-container[data-og-theme="${instanceId}"]`;
		manager.switchTheme(name, selector);
		setActiveTheme(name);
	}

	return (
		<div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
			<div style={{ fontSize: '12px', color: 'var(--og-cell-text-muted, #888)', marginBottom: '4px' }}>
				Built-in themes
			</div>
			{BUILT_IN_THEME_ORDER.map((name) => {
				if (!isBuiltInThemeName(name)) return null;
				const tokens = BUILT_IN_THEMES[name];
				const isActive = activeTheme === name;
				return (
					<button
						key={name}
						onClick={() => applyTheme(name)}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							padding: '8px 10px',
							border: `2px solid ${isActive ? 'var(--og-primary, #4f46e5)' : 'var(--og-border, #e0e0e0)'}`,
							borderRadius: '6px',
							background: tokens['--og-bg'] ?? '#fff',
							color: tokens['--og-cell-text'] ?? '#222',
							cursor: 'pointer',
							textAlign: 'left',
							fontSize: '13px',
							fontWeight: isActive ? 600 : 400,
						}}
					>
						{/* Color swatch */}
						<div
							style={{
								width: '20px',
								height: '20px',
								borderRadius: '50%',
								background: tokens['--og-primary'] ?? '#4f46e5',
								flexShrink: 0,
								border: '1px solid rgba(0,0,0,0.1)',
							}}
						/>
						{THEME_LABELS[name] ?? name}
						{isActive && <span style={{ marginLeft: 'auto', fontSize: '11px' }}>✓</span>}
					</button>
				);
			})}
		</div>
	);
}

import { useSyncExternalStore } from 'react';
import type { GridApi, SortModel, SortKey } from '@open-grid/core';

interface SortPanelProps {
	api: GridApi<unknown>;
}

export function SortPanel({ api }: SortPanelProps) {
	const sortModel = useSyncExternalStore(
		api.subscribe,
		() => api.pipeline.getSortModel(),
		() => api.pipeline.getSortModel(),
	);

	const cols = useSyncExternalStore(
		api.subscribe,
		() => api.columns.getState(),
		() => api.columns.getState(),
	);

	function addSort(field: string) {
		const col = cols.find((c) => c.field === field || String(c.id) === field);
		if (!col) return;
		const newKey: SortKey = { columnId: col.id, field: col.field ?? field, direction: 'asc' };
		api.pipeline.setSortModel([...sortModel, newKey]);
	}

	function removeSort(index: number) {
		const next = sortModel.filter((_, i) => i !== index);
		api.pipeline.setSortModel(next);
	}

	function toggleDirection(index: number) {
		const next: SortModel = sortModel.map((k, i) =>
			i === index ? { ...k, direction: k.direction === 'asc' ? 'desc' : 'asc' } : k,
		);
		api.pipeline.setSortModel(next);
	}

	function clearAll() {
		api.pipeline.setSortModel([]);
	}

	const sortedFields = new Set(sortModel.map((k) => k.field));
	const availableCols = cols.filter((c) => c.visible && !sortedFields.has(c.field ?? String(c.id)));

	const btnStyle = {
		padding: '4px 8px',
		fontSize: '12px',
		border: '1px solid var(--og-border, #ddd)',
		borderRadius: '4px',
		background: 'transparent',
		cursor: 'pointer',
		color: 'inherit',
	} as const;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px', gap: '8px' }}>
			{/* Active sort keys */}
			{sortModel.length === 0 ? (
				<div style={{ color: 'var(--og-cell-text-muted, #888)', fontSize: '13px', textAlign: 'center', paddingTop: '8px' }}>
					No sorts applied
				</div>
			) : (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
					{sortModel.map((key, i) => (
						<div
							key={`${key.field}-${i}`}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '6px',
								padding: '6px 8px',
								border: '1px solid var(--og-border, #e0e0e0)',
								borderRadius: '4px',
								fontSize: '13px',
							}}
						>
							<span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
								{key.field}
							</span>
							<button style={btnStyle} onClick={() => toggleDirection(i)}>
								{key.direction === 'asc' ? '▲ Asc' : '▼ Desc'}
							</button>
							<button style={btnStyle} onClick={() => removeSort(i)}>✕</button>
						</div>
					))}
				</div>
			)}

			{/* Add sort */}
			{availableCols.length > 0 && (
				<select
					defaultValue=""
					onChange={(e) => { if (e.target.value) { addSort(e.target.value); e.target.value = ''; } }}
					style={{
						padding: '6px 8px',
						fontSize: '13px',
						border: '1px solid var(--og-border, #ddd)',
						borderRadius: '4px',
						background: 'var(--og-cell-bg, #fff)',
						color: 'inherit',
						cursor: 'pointer',
					}}
				>
					<option value="">+ Add sort…</option>
					{availableCols.map((c) => (
						<option key={String(c.id)} value={c.field ?? String(c.id)}>
							{c.header ?? c.field ?? String(c.id)}
						</option>
					))}
				</select>
			)}

			{sortModel.length > 0 && (
				<button style={{ ...btnStyle, alignSelf: 'flex-start' }} onClick={clearAll}>
					Clear all
				</button>
			)}
		</div>
	);
}

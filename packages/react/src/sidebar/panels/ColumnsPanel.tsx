import { useState, useSyncExternalStore } from 'react';
import type { GridApi, ColumnState, GroupByModel, GroupByColumn } from '@open-grid/core';

interface ColumnsPanelProps {
	api: GridApi<unknown>;
}

export function ColumnsPanel({ api }: ColumnsPanelProps) {
	const [search, setSearch] = useState('');

	const cols = useSyncExternalStore(
		api.subscribe,
		() => api.columns.getState(),
		() => api.columns.getState()
	);

	const groupBy = useSyncExternalStore(
		api.subscribe,
		() => api.pipeline.getGroupBy(),
		() => api.pipeline.getGroupBy()
	);

	const filtered = search ? cols.filter((c) => (c.header ?? c.field ?? String(c.id)).toLowerCase().includes(search.toLowerCase())) : cols;

	const groupedColumnIds = new Set(groupBy.map((g) => String(g.columnId)));

	function toggleVisible(col: ColumnState) {
		api.columns.setVisible(col.id, !col.visible);
	}

	function togglePin(col: ColumnState) {
		const next = col.pinned === 'left' ? null : 'left';
		api.columns.setPinned(col.id, next as 'left' | 'right' | null);
	}

	function toggleGroup(col: ColumnState) {
		const isGrouped = groupedColumnIds.has(String(col.id));
		if (isGrouped) {
			const next: GroupByModel = groupBy.filter((g) => String(g.columnId) !== String(col.id));
			api.pipeline.setGroupBy(next);
		} else {
			const next: GroupByModel = [...groupBy, { columnId: col.id, field: col.field ?? String(col.id) } as GroupByColumn];
			api.pipeline.setGroupBy(next);
		}
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			<div style={{ padding: '8px' }}>
				<input
					type='text'
					placeholder='Search columns…'
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					style={{
						width: '100%',
						boxSizing: 'border-box',
						padding: '6px 8px',
						border: '1px solid var(--og-border, #e0e0e0)',
						borderRadius: '4px',
						fontSize: '13px',
						background: 'var(--og-cell-bg, #fff)',
						color: 'var(--og-cell-text, #222)',
					}}
				/>
			</div>
			<div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
				{filtered.map((col) => {
					const label = col.header ?? col.field ?? String(col.id);
					const isGrouped = groupedColumnIds.has(String(col.id));
					return (
						<div
							key={String(col.id)}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '6px',
								padding: '5px 2px',
								borderBottom: '1px solid var(--og-border, #f0f0f0)',
							}}
						>
							<input type='checkbox' checked={col.visible} onChange={() => toggleVisible(col)} style={{ margin: 0, flexShrink: 0 }} />
							<span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
								{label}
							</span>
							<button
								title={col.pinned === 'left' ? 'Unpin' : 'Pin left'}
								onClick={() => togglePin(col)}
								style={{
									padding: '2px 5px',
									fontSize: '11px',
									border: '1px solid var(--og-border, #ddd)',
									borderRadius: '3px',
									background: col.pinned ? 'var(--og-primary, #4f46e5)' : 'transparent',
									color: col.pinned ? '#fff' : 'inherit',
									cursor: 'pointer',
									flexShrink: 0,
								}}
							>
								📌
							</button>
							<button
								title={isGrouped ? 'Remove group' : 'Group by this column'}
								onClick={() => toggleGroup(col)}
								style={{
									padding: '2px 5px',
									fontSize: '11px',
									border: '1px solid var(--og-border, #ddd)',
									borderRadius: '3px',
									background: isGrouped ? 'var(--og-primary, #4f46e5)' : 'transparent',
									color: isGrouped ? '#fff' : 'inherit',
									cursor: 'pointer',
									flexShrink: 0,
								}}
							>
								⊞
							</button>
						</div>
					);
				})}
				{filtered.length === 0 && (
					<div style={{ textAlign: 'center', color: 'var(--og-cell-text-muted, #888)', fontSize: '13px', paddingTop: '16px' }}>
						No columns found
					</div>
				)}
			</div>
		</div>
	);
}

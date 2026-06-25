import { useSyncExternalStore } from 'react';
import type { GridApi, FilterModel, ColumnFilter } from '@open-grid/core';

interface FiltersPanelProps {
	api: GridApi<unknown>;
}

const OPERATORS = ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith', 'gt', 'lt', 'gte', 'lte'] as const;
type Operator = (typeof OPERATORS)[number];

function operatorLabel(op: Operator): string {
	switch (op) {
		case 'contains':
			return 'Contains';
		case 'notContains':
			return 'Not contains';
		case 'equals':
			return 'Equals';
		case 'notEquals':
			return 'Not equals';
		case 'startsWith':
			return 'Starts with';
		case 'endsWith':
			return 'Ends with';
		case 'gt':
			return '>';
		case 'lt':
			return '<';
		case 'gte':
			return '>=';
		case 'lte':
			return '<=';
	}
}

export function FiltersPanel({ api }: FiltersPanelProps) {
	const filterModel = useSyncExternalStore(
		api.subscribe,
		() => api.pipeline.getFilterModel(),
		() => api.pipeline.getFilterModel()
	);

	const cols = useSyncExternalStore(
		api.subscribe,
		() => api.columns.getState(),
		() => api.pipeline.getFilterModel() // stable snapshot for SSR
	).filter((c) => c.visible);

	function setFilter(cf: ColumnFilter) {
		const next: FilterModel = [...filterModel.filter((f) => f.columnId !== cf.columnId), cf];
		api.pipeline.setFilterModel(next);
	}

	function removeFilter(columnId: string) {
		api.pipeline.setFilterModel(filterModel.filter((f) => String(f.columnId) !== columnId));
	}

	function clearAll() {
		api.pipeline.setFilterModel([]);
	}

	const activeById = new Map(filterModel.map((f) => [String(f.columnId), f]));

	const inputStyle = {
		padding: '4px 6px',
		fontSize: '12px',
		border: '1px solid var(--og-border, #ddd)',
		borderRadius: '3px',
		background: 'var(--og-cell-bg, #fff)',
		color: 'inherit',
		width: '100%',
		boxSizing: 'border-box' as const,
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px', gap: '8px', overflowY: 'auto' }}>
			{cols.map((col) => {
				const id = String(col.id);
				const label = col.header ?? col.field ?? id;
				const active = activeById.get(id);
				const operator = (active?.operator as Operator | undefined) ?? 'contains';
				const value = active?.value != null ? String(active.value) : '';

				return (
					<div
						key={id}
						style={{
							border: '1px solid var(--og-border, #e0e0e0)',
							borderRadius: '4px',
							padding: '8px',
							fontSize: '13px',
						}}
					>
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
							<span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
							{active && (
								<button
									onClick={() => removeFilter(id)}
									style={{
										padding: '1px 5px',
										fontSize: '11px',
										border: 'none',
										background: 'transparent',
										cursor: 'pointer',
										color: 'var(--og-error, #d32f2f)',
									}}
								>
									✕
								</button>
							)}
						</div>
						<select
							value={operator}
							onChange={(e) => setFilter({ columnId: col.id, field: col.field ?? id, operator: e.target.value, value })}
							style={{ ...inputStyle, marginBottom: '4px' }}
						>
							{OPERATORS.map((op) => (
								<option key={op} value={op}>
									{operatorLabel(op)}
								</option>
							))}
						</select>
						<input
							type='text'
							placeholder='Filter value…'
							value={value}
							onChange={(e) => setFilter({ columnId: col.id, field: col.field ?? id, operator, value: e.target.value })}
							style={inputStyle}
						/>
					</div>
				);
			})}

			{filterModel.length > 0 && (
				<button
					onClick={clearAll}
					style={{
						alignSelf: 'flex-start',
						padding: '4px 8px',
						fontSize: '12px',
						border: '1px solid var(--og-border, #ddd)',
						borderRadius: '4px',
						background: 'transparent',
						cursor: 'pointer',
						color: 'inherit',
					}}
				>
					Clear all filters
				</button>
			)}
		</div>
	);
}

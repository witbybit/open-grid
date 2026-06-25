import { useState, useSyncExternalStore } from 'react';
import type { GridApi, QueryNode, QueryGroup, QueryCondition, FilterOperator } from '@open-grid/core';
import { queryGroup, queryCondition } from '@open-grid/core';

interface QueryBuilderPanelProps {
	api: GridApi<unknown>;
}

const OPERATORS: { value: FilterOperator; label: string }[] = [
	{ value: 'contains',    label: 'Contains' },
	{ value: 'notContains', label: 'Not contains' },
	{ value: 'equals',      label: 'Equals' },
	{ value: 'notEquals',   label: 'Not equals' },
	{ value: 'startsWith',  label: 'Starts with' },
	{ value: 'endsWith',    label: 'Ends with' },
	{ value: 'gt',          label: '>' },
	{ value: 'lt',          label: '<' },
	{ value: 'gte',         label: '>=' },
	{ value: 'lte',         label: '<=' },
	{ value: 'blank',       label: 'Is blank' },
	{ value: 'notBlank',    label: 'Is not blank' },
];

const inputStyle = {
	padding: '3px 6px',
	fontSize: '12px',
	border: '1px solid var(--og-border, #ddd)',
	borderRadius: '3px',
	background: 'var(--og-cell-bg, #fff)',
	color: 'inherit',
} as const;

const btnStyle = {
	padding: '2px 6px',
	fontSize: '11px',
	border: '1px solid var(--og-border, #ddd)',
	borderRadius: '3px',
	background: 'transparent',
	cursor: 'pointer',
	color: 'inherit',
} as const;

export function QueryBuilderPanel({ api }: QueryBuilderPanelProps) {
	const cols = useSyncExternalStore(
		api.subscribe,
		() => api.columns.getState(),
		() => api.columns.getState(),
	).filter((c) => c.visible);

	const activeQuery = useSyncExternalStore(
		api.subscribe,
		() => api.pipeline.getQuery(),
		() => api.pipeline.getQuery(),
	);

	const [draft, setDraft] = useState<QueryGroup | null>(activeQuery?.type === 'group' ? (activeQuery as QueryGroup) : null);

	const fields = cols.map((c) => ({ field: c.field ?? String(c.id), label: String(c.header ?? c.field ?? c.id) }));
	const firstField = fields[0]?.field ?? '';

	function ensureDraft(): QueryGroup {
		if (draft) return draft;
		const g = queryGroup('and', []);
		setDraft(g);
		return g;
	}

	function addCondition() {
		const g = ensureDraft();
		setDraft({ ...g, children: [...g.children, queryCondition(firstField, 'contains', '')] });
	}

	function addGroup() {
		const g = ensureDraft();
		setDraft({ ...g, children: [...g.children, queryGroup('and', [])] });
	}

	function removeChild(index: number) {
		if (!draft) return;
		const children = draft.children.filter((_, i) => i !== index);
		setDraft({ ...draft, children });
	}

	function updateCondition(index: number, patch: Partial<QueryCondition>) {
		if (!draft) return;
		const child = draft.children[index];
		if (!child || child.type !== 'condition') return;
		const updated: QueryCondition = { ...child, ...patch };
		const children = draft.children.map((c, i) => (i === index ? updated : c));
		setDraft({ ...draft, children });
	}

	function toggleOperator() {
		if (!draft) return;
		setDraft({ ...draft, operator: draft.operator === 'and' ? 'or' : 'and' });
	}

	function applyQuery() {
		if (!draft || draft.children.length === 0) {
			api.pipeline.setQuery(null);
		} else {
			api.pipeline.setQuery(draft);
		}
	}

	function clearQuery() {
		setDraft(null);
		api.pipeline.setQuery(null);
	}

	const isActive = activeQuery !== null;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px', gap: '8px', overflowY: 'auto', fontSize: '13px' }}>
			{/* Header */}
			<div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
				{draft && (
					<button
						onClick={toggleOperator}
						style={{ ...btnStyle, fontWeight: 600, background: 'var(--og-primary, #4f46e5)', color: '#fff', border: 'none', padding: '3px 10px' }}
					>
						{draft.operator.toUpperCase()}
					</button>
				)}
				<button onClick={addCondition} style={btnStyle}>+ Condition</button>
				<button onClick={addGroup} style={btnStyle}>+ Group</button>
			</div>

			{/* Conditions */}
			{draft?.children.map((child, i) => (
				<ConditionRow
					key={i}
					node={child}
					fields={fields}
					onRemove={() => removeChild(i)}
					onUpdate={(patch) => updateCondition(i, patch)}
				/>
			))}

			{(!draft || draft.children.length === 0) && (
				<div style={{ color: 'var(--og-cell-text-muted, #888)', fontSize: '12px', textAlign: 'center', paddingTop: '8px' }}>
					No conditions. Click "+ Condition" to start.
				</div>
			)}

			{/* Actions */}
			<div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
				<button
					onClick={applyQuery}
					style={{ ...btnStyle, background: 'var(--og-primary, #4f46e5)', color: '#fff', border: 'none', padding: '5px 12px', flex: 1 }}
				>
					Apply
				</button>
				{isActive && (
					<button onClick={clearQuery} style={{ ...btnStyle, color: 'var(--og-error, #d32f2f)' }}>
						Clear
					</button>
				)}
			</div>

			{isActive && (
				<div style={{ fontSize: '11px', color: 'var(--og-primary, #4f46e5)', textAlign: 'center' }}>
					Query active
				</div>
			)}
		</div>
	);
}

interface ConditionRowProps {
	node: QueryNode;
	fields: { field: string; label: string }[];
	onRemove(): void;
	onUpdate(patch: Partial<QueryCondition>): void;
}

function ConditionRow({ node, fields, onRemove, onUpdate }: ConditionRowProps) {
	if (node.type === 'group') {
		return (
			<div style={{ border: '1px solid var(--og-border, #ddd)', borderRadius: '4px', padding: '6px', background: 'var(--og-header-bg, #f9f9f9)' }}>
				<div style={{ fontSize: '11px', color: 'var(--og-cell-text-muted, #888)', marginBottom: '4px' }}>
					Nested group ({node.operator.toUpperCase()}) — {node.children.length} condition(s)
				</div>
				<button onClick={onRemove} style={{ ...btnStyle, color: 'var(--og-error, #d32f2f)', fontSize: '10px' }}>Remove group</button>
			</div>
		);
	}

	const cond = node as QueryCondition;
	const needsValue = cond.operator !== 'blank' && cond.operator !== 'notBlank';

	return (
		<div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
			<select
				value={cond.field}
				onChange={(e) => onUpdate({ field: e.target.value })}
				style={{ ...inputStyle, flex: '1 1 80px', minWidth: '60px' }}
			>
				{fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
			</select>
			<select
				value={cond.operator}
				onChange={(e) => onUpdate({ operator: e.target.value as FilterOperator })}
				style={{ ...inputStyle, flex: '1 1 80px', minWidth: '60px' }}
			>
				{OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
			</select>
			{needsValue && (
				<input
					type="text"
					value={cond.value != null ? String(cond.value) : ''}
					onChange={(e) => onUpdate({ value: e.target.value })}
					placeholder="Value"
					style={{ ...inputStyle, flex: '1 1 60px', minWidth: '40px' }}
				/>
			)}
			<button onClick={onRemove} style={{ ...btnStyle, color: 'var(--og-error, #d32f2f)', flexShrink: 0 }}>✕</button>
		</div>
	);
}

import { useState, useSyncExternalStore } from 'react';
import type { GridApi } from '@open-grid/core';

interface ViewsPanelProps {
	api: GridApi<unknown>;
}

export function ViewsPanel({ api }: ViewsPanelProps) {
	const [newName, setNewName] = useState('');
	const [editing, setEditing] = useState<string | null>(null);
	const [editName, setEditName] = useState('');

	const hasWorkspace = api.workspace.hasWorkspace();

	const views = useSyncExternalStore(
		api.workspace.subscribe,
		() => api.workspace.listViews(),
		() => api.workspace.listViews()
	);

	if (!hasWorkspace) {
		return (
			<div style={{ padding: '16px', fontSize: '13px', color: 'var(--og-cell-text-muted, #888)', textAlign: 'center' }}>
				<div style={{ fontSize: '20px', marginBottom: '8px' }}>⊕</div>
				<div>No workspace adapter configured.</div>
				<div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>Pass a workspaceAdapter to createGrid() to enable views.</div>
			</div>
		);
	}

	const btnStyle = {
		padding: '3px 7px',
		fontSize: '11px',
		border: '1px solid var(--og-border, #ddd)',
		borderRadius: '3px',
		background: 'transparent',
		cursor: 'pointer',
		color: 'inherit',
	} as const;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px', gap: '6px', overflowY: 'auto', fontSize: '13px' }}>
			{/* Save current view */}
			<div style={{ display: 'flex', gap: '6px' }}>
				<input
					type='text'
					placeholder='New view name…'
					value={newName}
					onChange={(e) => setNewName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && newName.trim()) {
							api.workspace.saveView(newName.trim());
							setNewName('');
						}
					}}
					style={{
						flex: 1,
						padding: '5px 8px',
						fontSize: '12px',
						border: '1px solid var(--og-border, #ddd)',
						borderRadius: '4px',
						background: 'var(--og-cell-bg, #fff)',
						color: 'inherit',
					}}
				/>
				<button
					disabled={!newName.trim()}
					onClick={() => {
						if (newName.trim()) {
							api.workspace.saveView(newName.trim());
							setNewName('');
						}
					}}
					style={{ ...btnStyle, padding: '5px 10px' }}
				>
					Save
				</button>
			</div>

			{/* View list */}
			{views.length === 0 ? (
				<div style={{ textAlign: 'center', color: 'var(--og-cell-text-muted, #888)', paddingTop: '8px' }}>No saved views</div>
			) : (
				views.map((view) => (
					<div
						key={view.id}
						style={{
							border: '1px solid var(--og-border, #e0e0e0)',
							borderRadius: '4px',
							padding: '6px 8px',
							display: 'flex',
							flexDirection: 'column',
							gap: '4px',
						}}
					>
						{editing === view.id ? (
							<div style={{ display: 'flex', gap: '4px' }}>
								<input
									autoFocus
									value={editName}
									onChange={(e) => setEditName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											api.workspace.renameView(view.id, editName);
											setEditing(null);
										}
										if (e.key === 'Escape') setEditing(null);
									}}
									style={{
										flex: 1,
										padding: '3px 6px',
										fontSize: '12px',
										border: '1px solid var(--og-primary, #4f46e5)',
										borderRadius: '3px',
										background: 'var(--og-cell-bg, #fff)',
										color: 'inherit',
									}}
								/>
								<button
									onClick={() => {
										api.workspace.renameView(view.id, editName);
										setEditing(null);
									}}
									style={btnStyle}
								>
									✓
								</button>
								<button onClick={() => setEditing(null)} style={btnStyle}>
									✕
								</button>
							</div>
						) : (
							<div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
								<span
									style={{
										flex: 1,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
										fontWeight: view.isDefault ? 600 : 400,
									}}
								>
									{view.name}
									{view.isDefault && (
										<span style={{ marginLeft: '4px', fontSize: '10px', color: 'var(--og-primary, #4f46e5)' }}>★</span>
									)}
								</span>
								<button title='Apply view' onClick={() => api.workspace.applyView(view.id)} style={btnStyle}>
									Apply
								</button>
								<button
									title='Rename'
									onClick={() => {
										setEditing(view.id);
										setEditName(view.name);
									}}
									style={btnStyle}
								>
									✎
								</button>
								<button
									title='Delete'
									onClick={() => api.workspace.deleteView(view.id)}
									style={{ ...btnStyle, color: 'var(--og-error, #d32f2f)' }}
								>
									✕
								</button>
							</div>
						)}
					</div>
				))
			)}
		</div>
	);
}

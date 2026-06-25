/**
 * New Engine Demo — proves the Plan 133 Grid component renders a working grid
 * using the new command-driven GridKernel + DomGridRenderer, with zero old engine
 * machinery (no GridStore, no GridEngine).
 */
import React, { useMemo, useState } from 'react';
import { Grid } from '@open-grid/react';
import type { GridColumnDef } from '@open-grid/react';

interface DemoRow {
	id: string;
	name: string;
	role: string;
	team: string;
	score: number;
	status: 'Active' | 'Pending' | 'Inactive';
}

function generateRows(count: number): DemoRow[] {
	const names = ['Alice', 'Bob', 'Cyd', 'Dan', 'Eve', 'Fay', 'Gil', 'Hana', 'Ivan', 'Jess'];
	const roles = ['Engineer', 'Designer', 'PM', 'QA', 'DevOps', 'Data Scientist'];
	const teams = ['Alpha', 'Beta', 'Gamma', 'Delta'];
	const statuses: DemoRow['status'][] = ['Active', 'Pending', 'Inactive'];
	return Array.from({ length: count }, (_, i) => ({
		id: String(i + 1),
		name: `${names[i % names.length]} ${i > 9 ? Math.floor(i / 10) : ''}`.trim(),
		role: roles[i % roles.length]!,
		team: teams[i % teams.length]!,
		score: Math.round(Math.random() * 100),
		status: statuses[i % statuses.length]!,
	}));
}

const COLUMNS: GridColumnDef<DemoRow>[] = [
	{ id: 'id', field: 'id', header: '#', width: 60 },
	{ id: 'name', field: 'name', header: 'Name', width: 160 },
	{ id: 'role', field: 'role', header: 'Role', width: 140 },
	{ id: 'team', field: 'team', header: 'Team', width: 120 },
	{ id: 'score', field: 'score', header: 'Score', width: 90 },
	{ id: 'status', field: 'status', header: 'Status', width: 100 },
];

const PINNED_COLUMNS: GridColumnDef<DemoRow>[] = [
	{ id: 'id', field: 'id', header: '#', width: 60, pinned: 'left' },
	{ id: 'name', field: 'name', header: 'Name', width: 160 },
	{ id: 'role', field: 'role', header: 'Role', width: 140 },
	{ id: 'team', field: 'team', header: 'Team', width: 120 },
	{ id: 'score', field: 'score', header: 'Score', width: 90 },
	{ id: 'status', field: 'status', header: 'Status', width: 100, pinned: 'right' },
];

export default function NewEngineDemo() {
	const [rowCount, setRowCount] = useState(200);
	const [usePinned, setUsePinned] = useState(false);
	const rows = useMemo(() => generateRows(rowCount), [rowCount]);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12, padding: 16 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
				<span
					style={{
						fontSize: 11,
						fontWeight: 700,
						textTransform: 'uppercase',
						letterSpacing: '0.06em',
						color: 'rgba(167,139,250,0.9)',
						background: 'rgba(139,92,246,0.12)',
						border: '1px solid rgba(139,92,246,0.3)',
						borderRadius: 4,
						padding: '2px 8px',
					}}
				>
					New Engine
				</span>
				<span style={{ fontSize: 13, color: '#94a3b8' }}>
					Plan 133 · GridKernel + DomGridRenderer · no GridStore / GridEngine
				</span>
				<div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
					<label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
						<input
							type='checkbox'
							checked={usePinned}
							onChange={(e) => setUsePinned(e.target.checked)}
							style={{ accentColor: '#8b5cf6' }}
						/>
						Pinned columns
					</label>
					<select
						value={rowCount}
						onChange={(e) => setRowCount(Number(e.target.value))}
						style={{
							background: '#1e293b',
							border: '1px solid #334155',
							color: '#e2e8f0',
							borderRadius: 4,
							padding: '2px 8px',
							fontSize: 12,
						}}
					>
						<option value={50}>50 rows</option>
						<option value={200}>200 rows</option>
						<option value={1000}>1 000 rows</option>
						<option value={10000}>10 000 rows</option>
					</select>
				</div>
			</div>
			<div style={{ flex: 1, minHeight: 0 }}>
				<Grid<DemoRow> columns={usePinned ? PINNED_COLUMNS : COLUMNS} rows={rows} getRowId={(r) => r.id} rowHeight={38} />
			</div>
		</div>
	);
}

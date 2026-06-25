/**
 * Full Architecture Demo (Plan 133 Stage 6)
 *
 * Showcases all major features built in Phases 7-13:
 *   P7  — Persistence + Workspace (named views)
 *   P8  — Export + Clipboard (CSV download, copy/paste)
 *   P9  — Query API (rich filter builder)
 *   P10 — Capabilities + Plugins (keyboard nav)
 *   P11 — DAG computed columns + fill engine
 *   P12 — WAAPI layout transitions
 *   P13 — Status bar + pagination + chart overlay
 *
 * Uses ONLY the new GridApi — zero old engine machinery.
 */
import React, { useRef, useState } from 'react';
import { Grid } from '@open-grid/react';
import type { GridColumnDef, GridApi } from '@open-grid/react';
import { ValidationRules, asColumnId } from '@open-grid/core';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

interface SalesRow {
	id: string;
	rep: string;
	region: string;
	product: string;
	units: number;
	price: number;
	revenue: number;
	q: string;
}

const REPS = ['Alice', 'Bob', 'Cyd', 'Dan', 'Eve', 'Fay', 'Gil', 'Hana'];
const REGIONS = ['North', 'South', 'East', 'West'];
const PRODUCTS = ['Widget A', 'Widget B', 'Gadget X', 'Gadget Y', 'Gizmo Z'];
const QS = ['Q1', 'Q2', 'Q3', 'Q4'];

function makeRows(n: number): SalesRow[] {
	return Array.from({ length: n }, (_, i) => {
		const units = 10 + ((i * 7 + 3) % 90);
		const price = 50 + ((i * 13 + 7) % 200);
		return {
			id: String(i + 1),
			rep: REPS[i % REPS.length]!,
			region: REGIONS[i % REGIONS.length]!,
			product: PRODUCTS[i % PRODUCTS.length]!,
			units,
			price,
			revenue: units * price,
			q: QS[i % QS.length]!,
		};
	});
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMNS: GridColumnDef<SalesRow>[] = [
	{ id: 'id',      field: 'id',      header: '#',       width: 60,  pinned: 'left' },
	{ id: 'rep',     field: 'rep',     header: 'Rep',     width: 110, sortable: true },
	{ id: 'region',  field: 'region',  header: 'Region',  width: 90,  sortable: true },
	{ id: 'product', field: 'product', header: 'Product', width: 130, sortable: true },
	{ id: 'q',       field: 'q',       header: 'Quarter', width: 80,  sortable: true },
	{ id: 'units',   field: 'units',   header: 'Units',   width: 80,  sortable: true },
	{ id: 'price',   field: 'price',   header: 'Price',   width: 80,  sortable: true },
	{ id: 'revenue', field: 'revenue', header: 'Revenue', width: 100, sortable: true },
];

const ROWS = makeRows(500);

// ---------------------------------------------------------------------------
// Demo component
// ---------------------------------------------------------------------------

export default function FullArchitectureDemo() {
	const apiRef = useRef<GridApi<SalesRow> | null>(null);
	const [log, setLog] = useState<string[]>([]);

	function addLog(msg: string) {
		setLog((prev) => [`${new Date().toLocaleTimeString()}: ${msg}`, ...prev.slice(0, 9)]);
	}

	function handleMount(api: GridApi<SalesRow>) {
		apiRef.current = api;

		// P11 — DAG: keep revenue column in sync with units * price
		api.dag.addComputed({
			field: 'revenue',
			dependencies: ['units', 'price'],
			compute: (deps) => Number(deps['units']) * Number(deps['price']),
		});

		// P10 — Data integrity: units must be positive
		api.integrity.addColumnValidation({
			field: 'units',
			columnId: asColumnId('units'),
			validators: [ValidationRules.minValue(1)],
			severity: 'error',
		});
		api.integrity.revalidate();

		addLog('Grid ready — DAG revenue + integrity active');
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			{/* Controls */}
			<div style={{
				display: 'flex', gap: 8, padding: '8px 12px', flexShrink: 0,
				background: '#1e293b', borderBottom: '1px solid #334155',
				flexWrap: 'wrap', alignItems: 'center',
			}}>
				<Chip>Plan 133 · Phases 7-13</Chip>

				<Btn onClick={() => {
					apiRef.current?.export.downloadCsv({ filename: 'sales-export' });
					addLog('CSV downloaded');
				}}>Export CSV</Btn>

				<Btn onClick={async () => {
					await apiRef.current?.clipboard.copySelection();
					addLog('Selection copied to clipboard');
				}}>Copy</Btn>

				<Btn onClick={async () => {
					await apiRef.current?.clipboard.paste();
					addLog('Pasted from clipboard');
				}}>Paste</Btn>

				<Btn onClick={() => {
					apiRef.current?.dag.recomputeAll();
					addLog('DAG: revenue recomputed for all rows');
				}}>Recompute DAG</Btn>

				<Btn onClick={() => {
					const api = apiRef.current;
					if (!api) return;
					const vm = api.getRendererView().getVisualModel();
					const q1Ids = new Set(
						vm.toArray()
							.filter((r) => r.kind === 'data' && (r.rowData as SalesRow).q === 'Q1')
							.map((r) => r.rowId),
					);
					api.chart.open({
						type: 'bar',
						categoryField: 'rep',
						valueFields: ['revenue'],
						rowIds: q1Ids,
						title: 'Q1 Revenue by Rep',
					});
					addLog(`Chart opened: Q1 revenue by rep (${q1Ids.size} rows)`);
				}}>Chart Q1</Btn>

				<Btn onClick={() => {
					apiRef.current?.chart.close();
					addLog('Chart closed');
				}}>Close Chart</Btn>

				<Btn onClick={() => {
					const api = apiRef.current;
					if (!api) return;
					api.pipeline.setGroupBy([{ columnId: asColumnId('region'), field: 'region' }]);
					addLog('Grouped by Region');
				}}>Group Region</Btn>

				<Btn onClick={() => {
					apiRef.current?.pipeline.setGroupBy([]);
					addLog('Grouping cleared');
				}}>Ungroup</Btn>

				<Btn onClick={() => {
					const api = apiRef.current;
					if (!api) return;
					// P9 — rich query filter
					api.pipeline.setQuery({
						type: 'group',
						operator: 'and',
						children: [
							{ type: 'condition', field: 'q', operator: 'equals', value: 'Q1' },
							{ type: 'condition', field: 'units', operator: 'gt', value: 50 },
						],
					});
					addLog('Query: Q1 AND units > 50');
				}}>Filter Q1 + Units&gt;50</Btn>

				<Btn onClick={() => {
					apiRef.current?.pipeline.setQuery(null);
					addLog('Query cleared');
				}}>Clear Filter</Btn>

				<span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>
					{ROWS.length} rows · new GridApi
				</span>
			</div>

			{/* Grid */}
			<div style={{ flex: 1, minHeight: 0 }}>
				<Grid<SalesRow>
					columns={COLUMNS}
					rows={ROWS}
					getRowId={(r) => r.id}
					rowHeight={36}
					showGroupPanel
					showFloatingFilters
					showStatusBar
					onMount={handleMount}
				/>
			</div>

			{/* Action log */}
			{log.length > 0 && (
				<div style={{
					padding: '4px 12px',
					background: '#0f172a',
					fontSize: 11,
					color: '#475569',
					borderTop: '1px solid #1e293b',
					display: 'flex',
					gap: 20,
					flexShrink: 0,
					overflowX: 'auto',
				}}>
					{log.slice(0, 4).map((l, i) => (
						<span key={i} style={{ opacity: 1 - i * 0.22, whiteSpace: 'nowrap' }}>{l}</span>
					))}
				</div>
			)}
		</div>
	);
}

function Btn({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
	return (
		<button
			onClick={onClick}
			style={{
				padding: '4px 10px',
				fontSize: 11,
				border: '1px solid #334155',
				borderRadius: 4,
				background: '#0f172a',
				color: '#94a3b8',
				cursor: 'pointer',
			}}
		>
			{children}
		</button>
	);
}

function Chip({ children }: { children: React.ReactNode }) {
	return (
		<span style={{
			fontSize: 10,
			fontWeight: 700,
			textTransform: 'uppercase',
			letterSpacing: '0.06em',
			color: 'rgba(167,139,250,0.9)',
			background: 'rgba(139,92,246,0.12)',
			border: '1px solid rgba(139,92,246,0.3)',
			borderRadius: 4,
			padding: '2px 8px',
		}}>
			{children}
		</span>
	);
}

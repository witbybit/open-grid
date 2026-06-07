import { useMemo, useCallback } from 'react';
import {
	generatePerformanceRows,
	generateCustomShowcaseRows,
	PerformanceRow,
	SpreadsheetRow,
	CustomShowcaseRow,
	PriceBadgeRenderer,
	StarRatingRenderer,
	ProgressBarRenderer,
	ProgressSliderEditor,
	StatusBadgeRenderer,
	StatusDropdownEditor,
	StatusHeaderFilter,
	LatencyProfiler,
	GreeksRenderer,
	RiskBadgeRenderer,
	ServiceBadgeRenderer,
	LatencyRenderer,
	RendererStrategyProbe,
	GanttStatusBadgeRenderer,
	GanttStatusDropdownEditor,
	GanttTimelineRenderer,
} from '../components/GridShared';
import { SparklineRenderer, LivePriceRenderer, HeavyAnalyticsCell } from '../components/FastRenderers';
import {
	useClientGrid,
	useServerGrid,
	type ColumnDef,
	type GridDatasource,
	type FilterModel,
	type SortModel,
	type FilterModelItem,
} from '@open-grid/react';

export interface DashboardStockRow {
	id: string;
	name: string;
	price: string;
	change: string;
	volume: string;
	risk: string;
}

interface UseShowroomStoresProps {
	massiveColumns: boolean;
	visibleColumns: Record<string, boolean>;
}

type ServerAuditRow = {
	id: string;
	timestamp: string;
	service: string;
	severity: string;
	latencyMs: string;
	ipAddress: string;
};

type GanttRow = {
	id: string;
	name: string;
	owner: string;
	sprintDay: number;
	durationDays: number;
	progress: number;
	status: 'Done' | 'In Progress' | 'Pending' | 'Blocked';
};

function setInactiveRiskSideEffects(
	api: { setCellValue: (rowId: string, colField: string, value: unknown) => void },
	rowId: string,
	colField: string,
	value: unknown
) {
	if (colField === 'status' && value === 'Inactive') {
		api.setCellValue(rowId, 'price', '0');
		api.setCellValue(rowId, 'quantity', '0');
	}
}

// ─── Dashboard data generator ────────────────────────────────────────────────

const SEED_STOCKS: Array<{ id: string; name: string; price: number; sector: string }> = [
	{ id: 'AAPL', name: 'Apple Inc.', price: 175.5, sector: 'Tech' },
	{ id: 'MSFT', name: 'Microsoft Corp.', price: 420.2, sector: 'Tech' },
	{ id: 'GOOGL', name: 'Alphabet Inc.', price: 150.1, sector: 'Tech' },
	{ id: 'NVDA', name: 'NVIDIA Corp.', price: 875.0, sector: 'Semis' },
	{ id: 'TSLA', name: 'Tesla Inc.', price: 170.3, sector: 'Auto' },
	{ id: 'AMZN', name: 'Amazon.com Inc.', price: 178.4, sector: 'Retail' },
	{ id: 'NFLX', name: 'Netflix Inc.', price: 610.5, sector: 'Media' },
	{ id: 'AMD', name: 'Advanced Micro Devices', price: 180.2, sector: 'Semis' },
	{ id: 'INTC', name: 'Intel Corp.', price: 42.5, sector: 'Semis' },
	{ id: 'PYPL', name: 'PayPal Holdings', price: 64.8, sector: 'Fintech' },
	{ id: 'META', name: 'Meta Platforms', price: 505.3, sector: 'Tech' },
	{ id: 'BABA', name: 'Alibaba Group', price: 78.4, sector: 'Retail' },
	{ id: 'CRM', name: 'Salesforce Inc.', price: 275.6, sector: 'SaaS' },
	{ id: 'SNOW', name: 'Snowflake Inc.', price: 145.9, sector: 'SaaS' },
	{ id: 'UBER', name: 'Uber Technologies', price: 68.2, sector: 'Transport' },
	{ id: 'LYFT', name: 'Lyft Inc.', price: 14.7, sector: 'Transport' },
	{ id: 'SQ', name: 'Block Inc.', price: 62.4, sector: 'Fintech' },
	{ id: 'SHOP', name: 'Shopify Inc.', price: 72.1, sector: 'SaaS' },
	{ id: 'ZM', name: 'Zoom Video', price: 64.8, sector: 'SaaS' },
	{ id: 'DOCN', name: 'DigitalOcean', price: 36.5, sector: 'Cloud' },
	{ id: 'NET', name: 'Cloudflare Inc.', price: 88.4, sector: 'Cloud' },
	{ id: 'DDOG', name: 'Datadog Inc.', price: 120.7, sector: 'DevOps' },
	{ id: 'MDB', name: 'MongoDB Inc.', price: 225.3, sector: 'Database' },
	{ id: 'ESTC', name: 'Elastic NV', price: 87.6, sector: 'Database' },
	{ id: 'CRWD', name: 'CrowdStrike', price: 315.8, sector: 'Security' },
	{ id: 'PANW', name: 'Palo Alto Networks', price: 285.4, sector: 'Security' },
	{ id: 'OKTA', name: 'Okta Inc.', price: 95.2, sector: 'Security' },
	{ id: 'TWLO', name: 'Twilio Inc.', price: 55.9, sector: 'SaaS' },
	{ id: 'PINS', name: 'Pinterest Inc.', price: 28.3, sector: 'Social' },
	{ id: 'SNAP', name: 'Snap Inc.', price: 12.1, sector: 'Social' },
	{ id: 'RBLX', name: 'Roblox Corp.', price: 38.7, sector: 'Gaming' },
	{ id: 'U', name: 'Unity Software', price: 22.4, sector: 'Gaming' },
	{ id: 'ABNB', name: 'Airbnb Inc.', price: 142.6, sector: 'Travel' },
	{ id: 'BKNG', name: 'Booking Holdings', price: 3650.0, sector: 'Travel' },
	{ id: 'DASH', name: 'DoorDash Inc.', price: 118.4, sector: 'Delivery' },
	{ id: 'HOOD', name: 'Robinhood Markets', price: 18.7, sector: 'Fintech' },
	{ id: 'COIN', name: 'Coinbase Global', price: 204.5, sector: 'Crypto' },
	{ id: 'MSTR', name: 'MicroStrategy', price: 1420.3, sector: 'Crypto' },
	{ id: 'ARM', name: 'Arm Holdings', price: 128.6, sector: 'Semis' },
	{ id: 'SMCI', name: 'Super Micro Computer', price: 790.4, sector: 'Semis' },
	{ id: 'AVGO', name: 'Broadcom Inc.', price: 1380.2, sector: 'Semis' },
	{ id: 'QCOM', name: 'Qualcomm Inc.', price: 168.9, sector: 'Semis' },
	{ id: 'TXN', name: 'Texas Instruments', price: 178.3, sector: 'Semis' },
	{ id: 'AMAT', name: 'Applied Materials', price: 192.7, sector: 'Semis' },
	{ id: 'ASML', name: 'ASML Holding', price: 840.1, sector: 'Semis' },
	{ id: 'LRCX', name: 'Lam Research', price: 890.5, sector: 'Semis' },
	{ id: 'KLAC', name: 'KLA Corp.', price: 720.3, sector: 'Semis' },
	{ id: 'GS', name: 'Goldman Sachs', price: 495.8, sector: 'Finance' },
	{ id: 'JPM', name: 'JPMorgan Chase', price: 198.4, sector: 'Finance' },
	{ id: 'MS', name: 'Morgan Stanley', price: 94.7, sector: 'Finance' },
];

function generateDashboardRows(): DashboardStockRow[] {
	const rows: DashboardStockRow[] = [];
	let seed = 42;
	const rand = () => {
		seed = (seed * 1664525 + 1013904223) & 0xffffffff;
		return (seed >>> 0) / 0xffffffff;
	};

	for (let rep = 0; rep < 10; rep++) {
		for (const stock of SEED_STOCKS) {
			const priceMult = 0.7 + rand() * 0.6;
			const price = stock.price * priceMult;
			const change = (rand() - 0.5) * 12;
			const volume = 5 + rand() * 120;
			const risk = price > 500 || Math.abs(change) > 4 ? 'High' : Math.abs(change) > 2 ? 'Medium' : 'Low';
			const suffix = rep === 0 ? '' : `.${rep}`;
			rows.push({
				id: `${stock.id}${suffix}`,
				name: rep === 0 ? stock.name : `${stock.name} (${stock.sector}-${rep})`,
				price: price.toFixed(2),
				change: `${change >= 0 ? '+' : ''}${change.toFixed(1)}`,
				volume: volume.toFixed(1),
				risk,
			});
		}
	}
	return rows;
}

export function useShowroomStores({ massiveColumns, visibleColumns }: UseShowroomStoresProps) {
	// --------------------------------------------------------------------------
	// A. PAGE 1: CLIENT PERFORMANCE CALCULATION PLAYGROUND (Option Greeks stress-test)
	// --------------------------------------------------------------------------
	const clientColumns = useMemo<ColumnDef<PerformanceRow>[]>(() => {
		const cols: ColumnDef<PerformanceRow>[] = [
			{ field: 'id', header: 'Option ID', width: 180 },
			{ field: 'name', header: 'Underlying', width: 100 },
			{ field: 'price', header: 'Strike ($)', width: 100 },
			{ field: 'quantity', header: 'Implied Vol %', width: 110 },
			{
				field: 'delta',
				header: 'Delta Δ',
				width: 90,
				renderer: {
					kind: 'react',
					component: GreeksRenderer,
					capabilities: {
						scrollBehavior: 'fallback',
						estimatedCost: 'expensive',
						recycle: 'preserve',
						warmCache: true,
					},
				},
				valueGetterDependencies: ['price', 'quantity'],
				valueGetter: ({ row }) => {
					const vol = parseFloat(row.quantity) || 20;
					const strike = parseFloat(row.price) || 100;
					const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
					const delta = 0.5 + 0.5 * Math.tanh(d1);
					return delta.toFixed(4);
				},
			},
			{
				field: 'gamma',
				header: 'Gamma Γ',
				width: 95,
				renderer: {
					kind: 'react',
					component: GreeksRenderer,
					capabilities: {
						scrollBehavior: 'fallback',
						estimatedCost: 'expensive',
						recycle: 'preserve',
						warmCache: true,
					},
				},
				valueGetterDependencies: ['price', 'quantity'],
				valueGetter: ({ row }) => {
					const vol = parseFloat(row.quantity) || 20;
					const strike = parseFloat(row.price) || 100;
					const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
					const gamma = Math.exp((-d1 * d1) / 2) / (100 * (vol / 100) * Math.sqrt(2 * Math.PI));
					return gamma.toFixed(5);
				},
			},
			{
				field: 'vega',
				header: 'Vega ν',
				width: 90,
				renderer: {
					kind: 'react',
					component: GreeksRenderer,
					capabilities: {
						scrollBehavior: 'live',
						estimatedCost: 'cheap',
						recycle: 'preserve',
						supportsRebind: false,
					},
				},
				valueGetterDependencies: ['price', 'quantity'],
				valueGetter: ({ row }) => {
					const vol = parseFloat(row.quantity) || 20;
					const strike = parseFloat(row.price) || 100;
					const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
					const vega = (100 * Math.exp((-d1 * d1) / 2)) / Math.sqrt(2 * Math.PI);
					return (vega / 100).toFixed(4);
				},
			},
			{
				field: 'theta',
				header: 'Theta θ',
				width: 90,
				renderer: {
					kind: 'react',
					component: GreeksRenderer,
					capabilities: {
						scrollBehavior: 'fallback',
						estimatedCost: 'expensive',
						recycle: 'preserve',
						warmCache: true,
					},
				},
				valueGetterDependencies: ['price', 'quantity'],
				valueGetter: ({ row }) => {
					const vol = parseFloat(row.quantity) || 20;
					const strike = parseFloat(row.price) || 100;
					const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
					const theta =
						-(100 * (vol / 100) * Math.exp((-d1 * d1) / 2)) / (2 * Math.sqrt(2 * Math.PI)) -
						0.05 * strike * Math.exp(-0.05) * (0.5 + 0.5 * Math.tanh(d1));
					return (theta / 365).toFixed(4);
				},
			},
			{
				field: 'status',
				header: 'Risk Rating',
				width: 110,
				cellEditor: StatusDropdownEditor,
				renderer: {
					kind: 'react',
					component: RiskBadgeRenderer,
					capabilities: {
						scrollBehavior: 'defer',
						estimatedCost: 'medium',
						interactive: true,
						recycle: 'preserve',
						warmCache: true,
					},
				},
				valueGetter: ({ row }) => {
					if (row.status === 'Active') return 'LOW';
					if (row.status === 'Pending') return 'MEDIUM';
					return 'HIGH';
				},
			},
		];

		if (massiveColumns) {
			for (let i = 0; i < 1000; i++) {
				cols.push({
					field: `col_${i}`,
					header: `Col ${i}`,
					width: 100,
					valueGetter: ({ row }) => (row as any)[`col_${i}`] ?? `Val ${i}`,
				});
			}
		}

		return cols;
	}, [massiveColumns]);

	const perfRows = useMemo(() => generatePerformanceRows(10000, 'R'), []);
	const perfApi = useClientGrid<PerformanceRow>({ rows: perfRows, columns: clientColumns });

	const handlePerfCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			setInactiveRiskSideEffects(perfApi, rowId, colField, val);
		},
		[perfApi]
	);

	const runBulkCalculationTest = useCallback(() => {
		const start = performance.now();

		perfApi.rows().forEach((row, index) => {
			if (index % 10 !== 0) return;

			perfApi.setCellValue(row.id, 'price', (Math.floor(Math.random() * 150) + 10).toString());
			perfApi.setCellValue(row.id, 'quantity', (Math.floor(Math.random() * 5) + 1).toString());
		});

		const duration = performance.now() - start;
		LatencyProfiler.record(duration);
	}, [perfApi]);

	// --------------------------------------------------------------------------
	// B. PAGE 2: INFINITE SERVER CHUNKS SCROLL (Global Audit & Logging Ledger)
	// --------------------------------------------------------------------------
	const serverColumns = useMemo<ColumnDef<ServerAuditRow>[]>(() => {
		return [
			{ field: 'id', header: 'Trace ID', width: 130 },
			{ field: 'timestamp', header: 'Timestamp', width: 220 },
			{
				field: 'service',
				header: 'Microservice',
				width: 140,
				renderer: {
					kind: 'react',
					component: ServiceBadgeRenderer,
					capabilities: { scrollBehavior: 'live', estimatedCost: 'cheap', recycle: 'preserve' },
				},
			},
			{
				field: 'rendererLive',
				header: 'Live Rebind',
				width: 170,
				renderer: {
					kind: 'react',
					component: RendererStrategyProbe,
					capabilities: {
						scrollBehavior: 'live',
						estimatedCost: 'cheap',
						recycle: 'rebind',
						supportsRebind: true,
						warmCache: true,
					},
				},
				valueGetter: ({ row }) => `live|${row.service}`,
			},
			{
				field: 'rendererDefer',
				header: 'Defer Stable',
				width: 170,
				renderer: {
					kind: 'react',
					component: RendererStrategyProbe,
					capabilities: {
						scrollBehavior: 'defer',
						deferFallback: 'snapshot',
						estimatedCost: 'medium',
						interactive: true,
						recycle: 'preserve',
						warmCache: true,
					},
				},
				valueGetterDependencies: ['severity'],
				valueGetter: ({ row }) => `defer|${row.severity}`,
			},
			{
				field: 'severity',
				header: 'Severity',
				width: 120,
				renderer: {
					kind: 'react',
					component: RiskBadgeRenderer,
					capabilities: { scrollBehavior: 'fallback', estimatedCost: 'medium', interactive: false },
				},
			},
			{
				field: 'rendererFallback',
				header: 'Fallback Cache',
				width: 175,
				renderer: {
					kind: 'react',
					component: RendererStrategyProbe,
					capabilities: {
						scrollBehavior: 'fallback',
						estimatedCost: 'expensive',
						recycle: 'preserve',
						warmCache: true,
					},
				},
				valueGetterDependencies: ['latencyMs'],
				valueGetter: ({ row }) => `fallback|${row.latencyMs}ms`,
			},
			{
				field: 'rendererDestroy',
				header: 'Destroy Recycle',
				width: 180,
				renderer: {
					kind: 'react',
					component: RendererStrategyProbe,
					capabilities: {
						scrollBehavior: 'fallback',
						estimatedCost: 'medium',
						recycle: 'destroy',
						warmCache: false,
					},
				},
				valueGetterDependencies: ['ipAddress'],
				valueGetter: ({ row }) => `destroy|${row.ipAddress}`,
			},
			{ field: 'latencyMs', header: 'Latency', width: 110, renderer: { kind: 'react', component: LatencyRenderer } },
			{ field: 'ipAddress', header: 'Origin IP', width: 140 },
		];
	}, []);

	const serverRows = useMemo<ServerAuditRow[]>(() => {
		const services = ['Auth', 'Billing', 'Database', 'Cache', 'API Gateway', 'Shipping'];
		const severities = ['DEBUG', 'INFO', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
		return Array.from({ length: 100000 }, (_, index) => {
			const lat = index % 8 === 0 ? Math.floor(Math.random() * 900) + 350 : Math.floor(Math.random() * 85) + 15;
			const date = new Date(Date.now() - index * 60000).toISOString();
			return {
				id: `TR-${100000 + index}`,
				timestamp: date,
				service: services[index % services.length],
				severity: severities[index % severities.length],
				latencyMs: lat.toString(),
				ipAddress: `192.168.1.${(index * 7) % 255}`,
			};
		});
	}, []);

	const mockDatasource = useMemo<GridDatasource>(() => {
		// Cache sorted/filtered result so concurrent block fetches don't each re-sort 100K rows
		let cachedSortKey = '';
		let cachedFilterKey = '';
		let cachedRows: ServerAuditRow[] = serverRows;

		const buildRows = (sortModel: SortModel | undefined, filterModel: FilterModel | undefined): ServerAuditRow[] => {
			const sortKey = JSON.stringify(sortModel ?? []);
			const filterKey = JSON.stringify(filterModel ?? {});
			if (sortKey === cachedSortKey && filterKey === cachedFilterKey) return cachedRows;

			cachedSortKey = sortKey;
			cachedFilterKey = filterKey;

			let rows: ServerAuditRow[] = serverRows;
			const statusFilter = filterModel?.status as FilterModelItem | undefined;
			if (statusFilter?.filter) {
				const f = statusFilter.filter;
				if (f === 'Active') rows = rows.filter((r) => r.severity === 'CRITICAL' || r.severity === 'ERROR');
				else if (f === 'Pending') rows = rows.filter((r) => r.severity === 'WARNING');
				else if (f === 'Inactive') rows = rows.filter((r) => r.severity === 'INFO' || r.severity === 'DEBUG');
			}
			if (sortModel?.length) {
				rows = [...rows].sort((a, b) => {
					for (const item of sortModel) {
						const field = item.colId as keyof ServerAuditRow;
						const left = a[field];
						const right = b[field];
						const leftNum = Number(left);
						const rightNum = Number(right);
						const cmp =
							!Number.isNaN(leftNum) && !Number.isNaN(rightNum)
								? leftNum - rightNum
								: String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
						if (cmp !== 0) return item.sort === 'desc' ? -cmp : cmp;
					}
					return 0;
				});
			}
			cachedRows = rows;
			return rows;
		};

		return {
			getRows: async (params) => {
				const start = performance.now();
				// Sort/filter before the network delay so concurrent fetches share the cached result
				const rows = buildRows(params.sortModel as SortModel | undefined, params.filterModel as FilterModel | undefined);
				await new Promise((resolve) => setTimeout(resolve, 3000));
				const resultRows = rows.slice(params.startRow, params.endRow);
				LatencyProfiler.record(performance.now() - start);
				return { rows: resultRows, totalCount: rows.length };
			},
		};
	}, [serverRows]);

	const serverApi = useServerGrid<ServerAuditRow>({ datasource: mockDatasource, blockSize: 100, columns: serverColumns });

	// --------------------------------------------------------------------------
	// C. PAGE 3: SPREADSHEET RANGE MULTI-SELECT WORKSPACE (Quantitative Financial Sheet)
	// --------------------------------------------------------------------------
	const spreadsheetColumns = useMemo<ColumnDef<SpreadsheetRow>[]>(
		() => [
			{
				field: 'id',
				header: 'Fiscal Period',
				width: 130,
				valueGetter: ({ node }) => {
					const index = Number(node.id.replace('S-', '')) - 1000;
					const rowIndex = Number.isFinite(index) ? index : 0;
					const year = 2026 + Math.floor(rowIndex / 4);
					const quarter = `Q${(rowIndex % 4) + 1}`;
					return `${year} ${quarter}`;
				},
			},
			{ field: 'A', header: 'Revenue ($M)', width: 120 },
			{ field: 'B', header: 'OpEx ($M)', width: 120 },
			{ field: 'C', header: 'Net Income ($M)', width: 140 },
			{ field: 'D', header: 'CAGR (%)', width: 110 },
			{ field: 'E', header: 'Interest Rate (%)', width: 140 },
			{ field: 'F', header: 'Discount Factor', width: 140 },
		],
		[]
	);

	const spreadsheetRows = useMemo(() => {
		const rows = Array.from({ length: 500 }, (_, index) => {
			const rowId = `S-${1000 + index}`;
			const rev = (120 + index * 4.5).toFixed(1);
			const opex = (75 + index * 1.8).toFixed(1);
			return {
				id: rowId,
				A: rev,
				B: opex,
				C: '',
				D: '5.5',
				E: '4.25',
				F: '',
			};
		});

		for (let i = 0; i < 15; i++) {
			const rowId = `S-${1000 + i}`;
			const row = rows[i];
			if (row) {
				row.C = `=SUM([${rowId}:A],-[${rowId}:B])`;
				row.F = `=[${rowId}:C]*0.8`;
			}
		}

		return rows;
	}, []);

	const spreadsheetApi = useClientGrid<SpreadsheetRow>({ rows: spreadsheetRows, columns: spreadsheetColumns });

	const handleSpreadsheetCellValueChanged = useCallback((_rowId: string, _colField: string, _val: unknown) => {
		// Cell edits are already committed by the grid editor pipeline.
	}, []);

	const applySpreadsheetRangeAction = useCallback(
		(action: 'fill' | 'clear' | 'addPercent' | 'sum') => {
			const state = spreadsheetApi.getState();
			const range = state.selection.range;
			if (!range) {
				alert('Please select a range of cells first using click-and-drag or Shift+Arrows.');
				return;
			}

			const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
			const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);

			if (startColIdx === -1 || endColIdx === -1) return;

			const rowIdsToModify = spreadsheetApi.rows().inRange(range).getIds();
			if (rowIdsToModify.length === 0) return;

			const minCol = Math.min(startColIdx, endColIdx);
			const maxCol = Math.max(startColIdx, endColIdx);

			const colsToModify = state.columns.slice(minCol, maxCol + 1).map((c) => c.field);

			const startTime = performance.now();

			if (action === 'sum') {
				let totalSum = 0;
				for (const rowId of rowIdsToModify) {
					for (const colField of colsToModify) {
						if (colField === 'id') continue;
						const val = parseFloat(String(spreadsheetApi.getCellValue(rowId, colField))) || 0;
						totalSum += val;
					}
				}
				const duration = performance.now() - startTime;
				LatencyProfiler.record(duration);
				alert(`Calculated Selection Range Sum: ${totalSum.toFixed(2)} (Completed in ${duration.toFixed(3)}ms)`);
				return;
			}

			for (const rowId of rowIdsToModify) {
				for (const colField of colsToModify) {
					if (colField === 'id') continue;

					if (action === 'fill') {
						spreadsheetApi.setCellValue(rowId, colField, '100');
					} else if (action === 'clear') {
						spreadsheetApi.setCellValue(rowId, colField, '');
					} else if (action === 'addPercent') {
						const valNum = parseFloat(String(spreadsheetApi.getCellValue(rowId, colField))) || 0;
						spreadsheetApi.setCellValue(rowId, colField, (valNum * 1.1).toFixed(0));
					}
				}
			}

			const duration = performance.now() - startTime;
			LatencyProfiler.record(duration);
		},
		[spreadsheetApi]
	);

	// --------------------------------------------------------------------------
	// D. PAGE 4: ADVANCED CUSTOM EDITORS & RENDERERS SHOWCASE (Asset Control Desk)
	// --------------------------------------------------------------------------
	const customColumns = useMemo<ColumnDef<CustomShowcaseRow>[]>(
		() => [
			{ field: 'id', header: 'Asset ID', width: 100 },
			{ field: 'name', header: 'Premium Asset', width: 180 },
			{ field: 'price', header: 'Acquisition Cost ($)', width: 150, renderer: { kind: 'react', component: PriceBadgeRenderer } },
			{ field: 'rating', header: 'Client Rating', width: 160, renderer: { kind: 'react', component: StarRatingRenderer } },
			{
				field: 'progress',
				header: 'Deployment Status',
				width: 170,
				renderer: { kind: 'react', component: ProgressBarRenderer },
				cellEditor: ProgressSliderEditor,
			},
			{
				field: 'status',
				header: 'Operational Status',
				width: 140,
				renderer: { kind: 'react', component: StatusBadgeRenderer },
				cellEditor: StatusDropdownEditor,
				headerMenuComponent: StatusHeaderFilter,
			},
		],
		[]
	);

	const customRows = useMemo(() => generateCustomShowcaseRows(50), []);
	const customApi = useClientGrid<CustomShowcaseRow>({ rows: customRows, columns: customColumns });

	const handleCustomCellValueChanged = useCallback((_rowId: string, _colField: string, _val: unknown) => {
		// Cell edits are already committed by the grid editor pipeline.
	}, []);

	// --------------------------------------------------------------------------
	// E. PAGE 5: DYNAMIC LAYOUT & VISIBILITY RESIZING (100 Rows)
	// --------------------------------------------------------------------------
	const layoutColumnsFull = useMemo<ColumnDef<PerformanceRow>[]>(
		() => [
			{ field: 'id', header: 'Option ID', width: 180 },
			{ field: 'name', header: 'Underlying', width: 100 },
			{ field: 'price', header: 'Strike ($)', width: 100 },
			{ field: 'quantity', header: 'Implied Vol %', width: 110 },
			{
				field: 'subtotal',
				header: 'Delta Δ',
				width: 100,
				renderer: { kind: 'react', component: GreeksRenderer },
				valueGetterDependencies: ['price', 'quantity'],
				valueGetter: ({ row }) => {
					const vol = parseFloat(row.quantity) || 20;
					const strike = parseFloat(row.price) || 100;
					const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
					const delta = 0.5 + 0.5 * Math.tanh(d1);
					return delta.toFixed(4);
				},
			},
			{
				field: 'status',
				header: 'Risk Profile',
				width: 120,
				cellEditor: StatusDropdownEditor,
				renderer: { kind: 'react', component: RiskBadgeRenderer },
				valueGetter: ({ row }) => {
					if (row.status === 'Active') return 'LOW';
					if (row.status === 'Pending') return 'MEDIUM';
					return 'HIGH';
				},
			},
		],
		[]
	);

	const layoutColumns = useMemo<ColumnDef<PerformanceRow>[]>(() => {
		return layoutColumnsFull.filter((col) => visibleColumns[col.field]);
	}, [layoutColumnsFull, visibleColumns]);

	const layoutRows = useMemo(() => generatePerformanceRows(100, 'R'), []);
	const layoutApi = useClientGrid<PerformanceRow>({ rows: layoutRows, columns: layoutColumns });

	const handleLayoutCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			setInactiveRiskSideEffects(layoutApi, rowId, colField, val);
		},
		[layoutApi]
	);

	// --------------------------------------------------------------------------
	// F. PAGE 6: HEADLESS SKINS & THEMES PLAYGROUND (CSS Themes Studio)
	// --------------------------------------------------------------------------
	const skinsColumns = useMemo<ColumnDef<PerformanceRow>[]>(() => {
		return [
			{ field: 'id', header: 'Token ID', width: 150 },
			{ field: 'name', header: 'Token Key', width: 160 },
			{ field: 'price', header: 'Raw Value ($)', width: 130, renderer: { kind: 'react', component: PriceBadgeRenderer } },
			{ field: 'quantity', header: 'Allocated Scale', width: 130 },
			{
				field: 'status',
				header: 'Luxe Status',
				width: 130,
				cellEditor: StatusDropdownEditor,
				renderer: { kind: 'react', component: RiskBadgeRenderer },
				valueGetter: ({ row }) => {
					if (row.status === 'Active') return 'LOW';
					if (row.status === 'Pending') return 'MEDIUM';
					return 'HIGH';
				},
			},
		];
	}, []);

	const skinsRows = useMemo(() => generatePerformanceRows(50, 'SR'), []);
	const skinsApi = useClientGrid<PerformanceRow>({ rows: skinsRows, columns: skinsColumns });

	const handleSkinsCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			setInactiveRiskSideEffects(skinsApi, rowId, colField, val);
		},
		[skinsApi]
	);

	// --------------------------------------------------------------------------
	// G. PAGE 7: REAL-TIME PORTFOLIO EVENT-DRIVEN ANALYTICS DASHBOARD
	// --------------------------------------------------------------------------
	const dashboardColumns = useMemo<ColumnDef<DashboardStockRow>[]>(
		() => [
			{ field: 'id', header: 'Ticker', width: 80 },
			{ field: 'name', header: 'Company', width: 160 },
			{
				// DOM renderer — zero React overhead: canvas sparkline + price value.
				// Grid calls DomCellRenderer.mount() once per slot, then update() on each tick.
				// No React, no scheduler, no reconciler — pure DOM.
				field: 'price',
				header: 'Price (DOM)',
				width: 130,
				renderer: {
					kind: 'dom',
					renderer: SparklineRenderer,
					capabilities: {
						scrollBehavior: 'live',
						recycle: 'rebind',
						warmCache: true,
					},
				},
			},
			{
				// Imperative React renderer — forwardRef + useImperativeHandle.
				// Grid calls ref.current.update() directly — bypasses React scheduler entirely.
				// Flash animation is direct DOM mutation (span.style.color), zero vDOM diff.
				field: 'change',
				header: 'Change % (Imperative)',
				width: 165,
				renderer: {
					kind: 'imperativeReact',
					component: LivePriceRenderer,
					capabilities: {
						scrollBehavior: 'live',
						recycle: 'rebind',
					},
				},
			},
			{
				// Standard React renderer with memo — goes through full React scheduler.
				// Shows derived risk score to simulate heavier computation per render.
				field: 'volume',
				header: 'Vol/Analytics (React)',
				width: 165,
				renderer: {
					kind: 'react',
					component: HeavyAnalyticsCell,
					capabilities: {
						scrollBehavior: 'fallback',
						recycle: 'preserve',
						estimatedCost: 'medium',
					},
				},
			},
			{ field: 'risk', header: 'Risk', width: 90 },
		],
		[]
	);

	const dashboardRows = useMemo<DashboardStockRow[]>(() => generateDashboardRows(), []);

	const dashboardApi = useClientGrid<DashboardStockRow>({ rows: dashboardRows, columns: dashboardColumns });

	const handleDashboardCellValueChanged = useCallback((_rowId: string, _colField: string, _val: unknown) => {
		// Cell edits are already committed by the grid editor pipeline.
	}, []);

	// --------------------------------------------------------------------------
	// H. PAGE 8: GANTT SCHEDULE & PROJECT WORKSPACE (Gantt & Project Scheduling Arena)
	// --------------------------------------------------------------------------
	const ganttColumns = useMemo<ColumnDef<GanttRow>[]>(() => {
		return [
			{ field: 'id', header: 'Task ID', width: 90 },
			{ field: 'name', header: 'Task Description', width: 170 },
			{ field: 'owner', header: 'Owner', width: 110 },
			{ field: 'sprintDay', header: 'Sprint Start', width: 100 },
			{ field: 'durationDays', header: 'Duration (Days)', width: 120 },
			{ field: 'progress', header: 'Progress (%)', width: 110 },
			{
				field: 'status',
				header: 'Status',
				width: 120,
				renderer: { kind: 'react', component: GanttStatusBadgeRenderer },
				cellEditor: GanttStatusDropdownEditor,
			},
			{
				field: 'timeline',
				header: 'Gantt Sprint Timeline (30 Days)',
				width: 280,
				renderer: { kind: 'react', component: GanttTimelineRenderer },
			},
		];
	}, []);

	const ganttRows = useMemo<GanttRow[]>(() => {
		const tasks = [
			'Project Blueprint Mapping',
			'User Persona Def & Scoping',
			'Visual Branding & Palette Setup',
			'Database Schema Architecture',
			'API Endpoints Design',
			'Auth Token Core Integration',
			'DOM Recycle Engine Refactoring',
			'Layout Render Optimization',
			'Drag-to-Fill Anchor Handle',
			'Extrapolation Mathematics',
			'Reference Shifter Compiler',
			'Theme Customizer Style Slots',
			'Dynamic Component Integration',
			'A/B Performance Benchmarking',
			'Executive Showroom Playroom',
			'Type-safety & ESM Packaging',
			'Production Bundler Testing',
		];
		const owners = ['Rishi', 'Alice', 'Sarah', 'Bob'];

		return Array.from({ length: 30 }, (_, index) => {
			const taskName = tasks[index % tasks.length];
			const owner = owners[index % owners.length];
			const status: GanttRow['status'] = index < 6 ? 'Done' : index < 12 ? 'In Progress' : index % 7 === 0 ? 'Blocked' : 'Pending';
			const progress = status === 'Done' ? 100 : status === 'In Progress' ? Math.floor(Math.random() * 60) + 20 : 0;
			const duration = Math.floor(Math.random() * 5) + 2;
			const startDay = index === 0 ? 1 : Math.max(1, index * 2 - 1);

			return {
				id: `T-${1000 + index}`,
				name: taskName,
				owner,
				sprintDay: startDay,
				durationDays: duration,
				progress,
				status,
			};
		});
	}, []);

	const ganttApi = useClientGrid<GanttRow>({ rows: ganttRows, columns: ganttColumns });

	const handleGanttCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			if (colField === 'status') {
				if (val === 'Done') ganttApi.setCellValue(rowId, 'progress', 100);
				else if (val === 'Pending') ganttApi.setCellValue(rowId, 'progress', 0);
			}
		},
		[ganttApi]
	);

	return {
		// A. Perf Calculations Playground
		perfApi,
		perfRows,
		handlePerfCellValueChanged,
		runBulkCalculationTest,

		// B. Infinite Server Scroll
		serverApi,
		serverRows,

		// C. Spreadsheet selection
		spreadsheetApi,
		spreadsheetRows,
		handleSpreadsheetCellValueChanged,
		applySpreadsheetRangeAction,

		// D. Custom editors
		customApi,
		customRows,
		handleCustomCellValueChanged,

		// E. Dynamic layouts
		layoutApi,
		layoutRows,
		handleLayoutCellValueChanged,
		layoutColumnsFull,

		// F. Headless skins
		skinsApi,
		skinsRows,
		handleSkinsCellValueChanged,

		// G. Analytics dashboard
		dashboardApi,
		dashboardRows,
		handleDashboardCellValueChanged,

		// H. Gantt Workspace
		ganttApi,
		ganttRows,
		handleGanttCellValueChanged,
	};
}

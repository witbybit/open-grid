import { useMemo, useCallback, useEffect } from 'react';
import {
	ClientRowModelController,
	ServerRowModelController,
	ColumnDef,
	GridStore,
	IGridDatasource,
	FilterModel,
	SortModel,
	FilterModelItem,
} from '@open-grid/core';
import {
	generatePerformanceRows,
	generateSpreadsheetRows,
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
	LatencyProfiler,
	GreeksRenderer,
	RiskBadgeRenderer,
	ServiceBadgeRenderer,
	LatencyRenderer,
} from '../components/GridShared';

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
				cellRenderer: GreeksRenderer,
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
				cellRenderer: GreeksRenderer,
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
				cellRenderer: GreeksRenderer,
				valueGetter: ({ row }) => {
					const vol = parseFloat(row.quantity) || 20;
					const strike = parseFloat(row.price) || 100;
					const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
					const vega = 100 * Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
					return (vega / 100).toFixed(4);
				},
			},
			{
				field: 'theta',
				header: 'Theta θ',
				width: 90,
				cellRenderer: GreeksRenderer,
				valueGetter: ({ row }) => {
					const vol = parseFloat(row.quantity) || 20;
					const strike = parseFloat(row.price) || 100;
					const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
					const theta = - (100 * (vol / 100) * Math.exp((-d1 * d1) / 2)) / (2 * Math.sqrt(2 * Math.PI)) - 0.05 * strike * Math.exp(-0.05) * (0.5 + 0.5 * Math.tanh(d1));
					return (theta / 365).toFixed(4);
				},
			},
			{
				field: 'status',
				header: 'Risk Rating',
				width: 110,
				cellEditor: StatusDropdownEditor,
				cellRenderer: RiskBadgeRenderer,
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
					valueGetter: ({ row }) => {
						return (row as any)[`col_${i}`] ?? `Val ${i}`;
					},
				});
			}
		}
		return cols;
	}, [massiveColumns]);

	const perfStore = useMemo(() => {
		return new GridStore<PerformanceRow>({
			rowHeights: {},
			columnWidths: clientColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [clientColumns]);

	const perfRows = useMemo(() => generatePerformanceRows(10000, 'R'), []);

	const perfController = useMemo(() => {
		return new ClientRowModelController<PerformanceRow>(perfStore, {
			rows: perfRows,
			columns: clientColumns,
		});
	}, [perfStore, perfRows, clientColumns]);

	const handlePerfCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			perfController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						let updated = { ...row, [colField]: val as any };
						if (colField === 'status' && val === 'Inactive') {
							updated.price = '0';
							updated.quantity = '0';
						}
						return updated;
					}
					return row;
				})
			);
		},
		[perfController]
	);

	const runBulkCalculationTest = useCallback(() => {
		const start = performance.now();
		perfController.updateRows((rows) => {
			return rows.map((row, index) => {
				if (index % 10 === 0) {
					return {
						...row,
						price: (Math.floor(Math.random() * 150) + 10).toString(),
						quantity: (Math.floor(Math.random() * 5) + 1).toString(),
					};
				}
				return row;
			});
		});
		const duration = performance.now() - start;
		LatencyProfiler.record(duration);
	}, [perfController]);

	// --------------------------------------------------------------------------
	// B. PAGE 2: INFINITE SERVER CHUNKS SCROLL (Global Audit & Logging Ledger)
	// --------------------------------------------------------------------------
	const serverColumns = useMemo<ColumnDef<any>[]>(() => {
		return [
			{ field: 'id', header: 'Trace ID', width: 130 },
			{ field: 'timestamp', header: 'Timestamp', width: 220 },
			{ field: 'service', header: 'Microservice', width: 140, cellRenderer: ServiceBadgeRenderer },
			{ field: 'severity', header: 'Severity', width: 120, cellRenderer: RiskBadgeRenderer },
			{ field: 'latencyMs', header: 'Latency', width: 110, cellRenderer: LatencyRenderer },
			{ field: 'ipAddress', header: 'Origin IP', width: 140 },
		];
	}, []);

	const serverStore = useMemo(() => {
		return new GridStore<any>({
			rowHeights: {},
			columnWidths: serverColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [serverColumns]);

	const serverRows = useMemo(() => {
		const services = ['Auth', 'Billing', 'Database', 'Cache', 'API Gateway', 'Shipping'];
		const severities = ['DEBUG', 'INFO', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
		return Array.from({ length: 100000 }, (_, index) => {
			const lat = index % 8 === 0 
				? Math.floor(Math.random() * 900) + 350 
				: Math.floor(Math.random() * 85) + 15;
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

	const mockDatasource = useMemo<IGridDatasource>(() => {
		return {
			getRows: async (params) => {
				const start = performance.now();
				// Simulated server response lag
				await new Promise((resolve) => setTimeout(resolve, 3000));

				const filterModel = params.filterModel as FilterModel | undefined;
				const sortModel = params.sortModel as SortModel | undefined;

				let rows = serverRows;

				const statusFilter = filterModel?.status as FilterModelItem | undefined;
				if (statusFilter?.filter) {
					const f = statusFilter.filter;
					if (f === 'Active') {
						rows = rows.filter((row) => row.severity === 'CRITICAL' || row.severity === 'ERROR');
					} else if (f === 'Pending') {
						rows = rows.filter((row) => row.severity === 'WARNING');
					} else if (f === 'Inactive') {
						rows = rows.filter((row) => row.severity === 'INFO' || row.severity === 'DEBUG');
					}
				}

				if (sortModel?.length) {
					rows = [...rows].sort((a, b) => {
						for (const item of sortModel) {
							const field = item.colId as keyof any;
							const left = a[field];
							const right = b[field];
							const leftNumber = Number(left);
							const rightNumber = Number(right);
							const comparison =
								!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)
									? leftNumber - rightNumber
									: String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
							if (comparison !== 0) return item.sort === 'desc' ? -comparison : comparison;
						}
						return 0;
					});
				}

				const resultRows = rows.slice(params.startRow, params.endRow);
				const duration = performance.now() - start;
				LatencyProfiler.record(duration);

				serverStore.dispatchEvent('serverBlockLoaded', {
					loadedBlockStart: params.startRow,
					loadedBlockEnd: params.endRow,
					totalRecords: rows.length,
					durationMs: duration,
				});

				return {
					rows: resultRows,
					totalCount: rows.length,
				};
			},
		};
	}, [serverRows, serverStore]);

	const serverController = useMemo(() => {
		return new ServerRowModelController<any>(serverStore, {
			datasource: mockDatasource,
			blockSize: 100,
			columns: serverColumns,
		});
	}, [serverStore, mockDatasource, serverColumns]);

	// --------------------------------------------------------------------------
	// C. PAGE 3: SPREADSHEET RANGE MULTI-SELECT WORKSPACE (Quantitative Financial Sheet)
	// --------------------------------------------------------------------------
	const spreadsheetColumns = useMemo<ColumnDef<SpreadsheetRow>[]>(
		() => [
			{ 
				field: 'id', 
				header: 'Fiscal Period', 
				width: 130,
				valueGetter: ({ row, rowIndex }) => {
					const year = 2026 + Math.floor(rowIndex / 4);
					const quarter = `Q${(rowIndex % 4) + 1}`;
					return `${year} ${quarter}`;
				}
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

	const spreadsheetStore = useMemo(() => {
		return new GridStore<SpreadsheetRow>({
			rowHeights: {},
			columnWidths: spreadsheetColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [spreadsheetColumns]);

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

		// Seed initial reactive cash flow formulas for first 15 periods
		for (let i = 0; i < 15; i++) {
			const rowId = `S-${1000 + i}`;
			const row = rows[i];
			if (row) {
				row.C = `=SUM([${rowId}:A],-[${rowId}:B])`; // Net income = Rev - OpEx
				row.F = `=[${rowId}:C]*0.8`; // Simulated Discount factor
			}
		}
		return rows;
	}, []);

	const spreadsheetController = useMemo(() => {
		return new ClientRowModelController<SpreadsheetRow>(spreadsheetStore, {
			rows: spreadsheetRows,
			columns: spreadsheetColumns,
		});
	}, [spreadsheetStore, spreadsheetRows, spreadsheetColumns]);

	const handleSpreadsheetCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			spreadsheetController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						return { ...row, [colField]: val as string };
					}
					return row;
				})
			);
		},
		[spreadsheetController]
	);

	const applySpreadsheetRangeAction = useCallback(
		(action: 'fill' | 'clear' | 'addPercent' | 'sum') => {
			const state = spreadsheetStore.getState();
			const range = state.selectedRange;
			if (!range) {
				alert('Please select a range of cells first using click-and-drag or Shift+Arrows.');
				return;
			}

			const rowModel = spreadsheetStore.getRowModel();
			if (!rowModel) return;

			const startIdx = rowModel.getRowIndexById(range.start.rowId);
			const endIdx = rowModel.getRowIndexById(range.end.rowId);
			const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
			const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);

			if (startIdx === -1 || endIdx === -1 || startColIdx === -1 || endColIdx === -1) return;

			const minRow = Math.min(startIdx, endIdx);
			const maxRow = Math.max(startIdx, endIdx);
			const minCol = Math.min(startColIdx, endColIdx);
			const maxCol = Math.max(startColIdx, endColIdx);

			const colsToModify = state.columns.slice(minCol, maxCol + 1).map((c) => c.field);
			const rowIdsToModify: string[] = [];
			for (let i = minRow; i <= maxRow; i++) {
				const node = rowModel.getRowNode ? rowModel.getRowNode(i) : null;
				if (node) rowIdsToModify.push(node.id);
			}

			const startTime = performance.now();

			if (action === 'sum') {
				let totalSum = 0;
				for (const rowId of rowIdsToModify) {
					for (const colField of colsToModify) {
						if (colField === 'id') continue;
						const val = parseFloat(String(spreadsheetStore.getCellValue(rowId, colField))) || 0;
						totalSum += val;
					}
				}
				const duration = performance.now() - startTime;
				LatencyProfiler.record(duration);
				alert(`Calculated Selection Range Sum: ${totalSum.toFixed(2)} (Completed in ${duration.toFixed(3)}ms)`);
				return;
			}

			spreadsheetController.updateRows((rows) => {
				return rows.map((row) => {
					if (rowIdsToModify.includes(row.id)) {
						let nextRow = { ...row };
						for (const colField of colsToModify) {
							if (colField === 'id') continue;
							if (action === 'fill') {
								(nextRow as any)[colField] = '100';
							} else if (action === 'clear') {
								(nextRow as any)[colField] = '';
							} else if (action === 'addPercent') {
								const valNum = parseFloat((row as any)[colField]) || 0;
								(nextRow as any)[colField] = (valNum * 1.1).toFixed(0);
							}
						}
						return nextRow;
					}
					return row;
				});
			});

			const duration = performance.now() - startTime;
			LatencyProfiler.record(duration);
		},
		[spreadsheetStore, spreadsheetController]
	);

	// --------------------------------------------------------------------------
	// D. PAGE 4: ADVANCED CUSTOM EDITORS & RENDERERS SHOWCASE (Asset Control Desk)
	// --------------------------------------------------------------------------
	const customColumns = useMemo<ColumnDef<CustomShowcaseRow>[]>(
		() => [
			{ field: 'id', header: 'Asset ID', width: 100 },
			{ field: 'name', header: 'Premium Asset', width: 180 },
			{
				field: 'price',
				header: 'Acquisition Cost ($)',
				width: 150,
				cellRenderer: PriceBadgeRenderer,
			},
			{
				field: 'rating',
				header: 'Client Rating',
				width: 160,
				cellRenderer: StarRatingRenderer,
			},
			{
				field: 'progress',
				header: 'Deployment Status',
				width: 170,
				cellRenderer: ProgressBarRenderer,
				cellEditor: ProgressSliderEditor,
			},
			{
				field: 'status',
				header: 'Operational Status',
				width: 140,
				cellRenderer: StatusBadgeRenderer,
				cellEditor: StatusDropdownEditor,
			},
		],
		[]
	);

	const customStore = useMemo(() => {
		return new GridStore<CustomShowcaseRow>({
			rowHeights: {},
			columnWidths: customColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [customColumns]);

	const customRows = useMemo(() => generateCustomShowcaseRows(50), []);

	const customController = useMemo(() => {
		return new ClientRowModelController<CustomShowcaseRow>(customStore, {
			rows: customRows,
			columns: customColumns,
		});
	}, [customStore, customRows, customColumns]);

	const handleCustomCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			customController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						return { ...row, [colField]: val as string };
					}
					return row;
				})
			);
		},
		[customController]
	);

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
				cellRenderer: GreeksRenderer,
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
				cellRenderer: RiskBadgeRenderer,
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

	const layoutStore = useMemo(() => {
		return new GridStore<PerformanceRow>({
			rowHeights: {},
			columnWidths: layoutColumnsFull.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [layoutColumnsFull]);

	const layoutRows = useMemo(() => generatePerformanceRows(100, 'R'), []);

	const layoutController = useMemo(() => {
		return new ClientRowModelController<PerformanceRow>(layoutStore, {
			rows: layoutRows,
			columns: layoutColumns,
		});
	}, [layoutStore, layoutRows, layoutColumns]);

	useEffect(() => {
		layoutStore.setState({ columns: layoutColumns });
	}, [layoutStore, layoutColumns]);

	const handleLayoutCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			layoutController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						let updated = { ...row, [colField]: val as any };
						if (colField === 'status' && val === 'Inactive') {
							updated.price = '0';
							updated.quantity = '0';
						}
						return updated;
					}
					return row;
				})
			);
		},
		[layoutController]
	);

	// --------------------------------------------------------------------------
	// F. PAGE 6: HEADLESS SKINS & THEMES PLAYGROUND (CSS Themes Studio)
	// --------------------------------------------------------------------------
	const skinsColumns = useMemo<ColumnDef<PerformanceRow>[]>(() => {
		return [
			{ field: 'id', header: 'Token ID', width: 150 },
			{ field: 'name', header: 'Token Key', width: 160 },
			{ field: 'price', header: 'Raw Value ($)', width: 130, cellRenderer: PriceBadgeRenderer },
			{ field: 'quantity', header: 'Allocated Scale', width: 130 },
			{
				field: 'status',
				header: 'Luxe Status',
				width: 130,
				cellEditor: StatusDropdownEditor,
				cellRenderer: RiskBadgeRenderer,
				valueGetter: ({ row }) => {
					if (row.status === 'Active') return 'LOW';
					if (row.status === 'Pending') return 'MEDIUM';
					return 'HIGH';
				},
			},
		];
	}, []);

	const skinsStore = useMemo(() => {
		return new GridStore<PerformanceRow>({
			rowHeights: {},
			columnWidths: skinsColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [skinsColumns]);

	const skinsRows = useMemo(() => generatePerformanceRows(50, 'S'), []);

	const skinsController = useMemo(() => {
		return new ClientRowModelController<PerformanceRow>(skinsStore, {
			rows: skinsRows,
			columns: skinsColumns,
		});
	}, [skinsStore, skinsRows, skinsColumns]);

	const handleSkinsCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			skinsController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						let updated = { ...row, [colField]: val as any };
						if (colField === 'status' && val === 'Inactive') {
							updated.price = '0';
							updated.quantity = '0';
						}
						return updated;
					}
					return row;
				})
			);
		},
		[skinsController]
	);

	// --------------------------------------------------------------------------
	// G. PAGE 7: REAL-TIME PORTFOLIO EVENT-DRIVEN ANALYTICS DASHBOARD
	// --------------------------------------------------------------------------
	const dashboardColumns = useMemo<ColumnDef<DashboardStockRow>[]>(
		() => [
			{ field: 'id', header: 'Ticker Symbol', width: 110 },
			{ field: 'name', header: 'Company Name', width: 170 },
			{ field: 'price', header: 'Market Price ($)', width: 130 },
			{ field: 'change', header: 'Daily Change (%)', width: 130 },
			{ field: 'volume', header: 'Volume (M Shares)', width: 130 },
			{ field: 'risk', header: 'Risk Profile', width: 110 },
		],
		[]
	);

	const dashboardStore = useMemo(() => {
		return new GridStore<DashboardStockRow>({
			rowHeights: {},
			columnWidths: dashboardColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [dashboardColumns]);

	const dashboardRows = useMemo<DashboardStockRow[]>(
		() => [
			{ id: 'AAPL', name: 'Apple Inc.', price: '175.50', change: '+1.2', volume: '52.4', risk: 'Low' },
			{ id: 'MSFT', name: 'Microsoft Corp.', price: '420.20', change: '+0.8', volume: '22.8', risk: 'Low' },
			{ id: 'GOOGL', name: 'Alphabet Inc.', price: '150.10', change: '-0.4', volume: '28.1', risk: 'Low' },
			{ id: 'NVDA', name: 'NVIDIA Corp.', price: '875.00', change: '+4.5', volume: '44.2', risk: 'High' },
			{ id: 'TSLA', name: 'Tesla Inc.', price: '170.30', change: '-2.1', volume: '88.5', risk: 'High' },
			{ id: 'AMZN', name: 'Amazon.com Inc.', price: '178.40', change: '+1.5', volume: '31.6', risk: 'Medium' },
			{ id: 'NFLX', name: 'Netflix Inc.', price: '610.50', change: '+3.2', volume: '10.5', risk: 'Medium' },
			{ id: 'AMD', name: 'Advanced Micro Devices', price: '180.20', change: '-1.8', volume: '62.0', risk: 'High' },
			{ id: 'INTC', name: 'Intel Corp.', price: '42.50', change: '-0.5', volume: '35.4', risk: 'Medium' },
			{ id: 'PYPL', name: 'PayPal Holdings', price: '64.80', change: '+0.3', volume: '12.2', risk: 'Medium' },
		],
		[]
	);

	const dashboardController = useMemo(() => {
		return new ClientRowModelController<DashboardStockRow>(dashboardStore, {
			rows: dashboardRows,
			columns: dashboardColumns,
		});
	}, [dashboardStore, dashboardRows, dashboardColumns]);

	const handleDashboardCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			dashboardController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						return { ...row, [colField]: val as string };
					}
					return row;
				})
			);
		},
		[dashboardController]
	);

	return {
		// A. Perf Calculations Playground
		perfStore,
		perfController,
		perfRows,
		handlePerfCellValueChanged,
		runBulkCalculationTest,

		// B. Infinite Server Scroll
		serverStore,
		serverController,
		serverRows,

		// C. Spreadsheet selection
		spreadsheetStore,
		spreadsheetController,
		spreadsheetRows,
		handleSpreadsheetCellValueChanged,
		applySpreadsheetRangeAction,

		// D. Custom editors
		customStore,
		customController,
		customRows,
		handleCustomCellValueChanged,

		// E. Dynamic layouts
		layoutStore,
		layoutController,
		layoutRows,
		handleLayoutCellValueChanged,
		layoutColumnsFull,

		// F. Headless skins
		skinsStore,
		skinsController,
		skinsRows,
		handleSkinsCellValueChanged,

		// G. Analytics dashboard
		dashboardStore,
		dashboardController,
		dashboardRows,
		handleDashboardCellValueChanged,
	};
}

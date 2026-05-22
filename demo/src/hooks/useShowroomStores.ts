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
	// A. PAGE 1: CLIENT PERFORMANCE CALCULATION PLAYGROUND (10k Rows)
	// --------------------------------------------------------------------------
	const clientColumns = useMemo<ColumnDef<PerformanceRow>[]>(() => {
		const cols: ColumnDef<PerformanceRow>[] = [
			{ field: 'id', header: 'Row ID', width: 80 },
			{ field: 'name', header: 'Product Name', width: 170 },
			{ field: 'price', header: 'Price ($)', width: 110 },
			{ field: 'quantity', header: 'Quantity', width: 90 },
			{
				field: 'subtotal',
				header: 'Subtotal ($)',
				width: 130,
				valueGetter: ({ row }) => {
					const price = parseFloat(row.price) || 0;
					const qty = parseFloat(row.quantity) || 0;
					return (price * qty).toFixed(2);
				},
			},
			{
				field: 'status',
				header: 'Status',
				width: 110,
				cellEditor: StatusDropdownEditor,
				cellRenderer: StatusBadgeRenderer,
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
	// B. PAGE 2: INFINITE SERVER CHUNKS SCROLL (100k Rows)
	// --------------------------------------------------------------------------
	const serverColumns = useMemo<ColumnDef<PerformanceRow>[]>(() => clientColumns, [clientColumns]);

	const serverStore = useMemo(() => {
		return new GridStore<PerformanceRow>({
			rowHeights: {},
			columnWidths: serverColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [serverColumns]);

	const serverRows = useMemo(() => generatePerformanceRows(100000, 'SR'), []);

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
					rows = rows.filter((row) => row.status === statusFilter.filter);
				}

				if (sortModel?.length) {
					rows = [...rows].sort((a, b) => {
						for (const item of sortModel) {
							const field = item.colId as keyof PerformanceRow;
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
		return new ServerRowModelController<PerformanceRow>(serverStore, {
			datasource: mockDatasource,
			blockSize: 100,
			columns: serverColumns,
		});
	}, [serverStore, mockDatasource, serverColumns]);

	// --------------------------------------------------------------------------
	// C. PAGE 3: SPREADSHEET RANGE MULTI-SELECT WORKSPACE
	// --------------------------------------------------------------------------
	const spreadsheetColumns = useMemo<ColumnDef<SpreadsheetRow>[]>(
		() => [
			{ field: 'id', header: 'Cell ID', width: 80 },
			{ field: 'A', header: 'Column A', width: 110 },
			{ field: 'B', header: 'Column B', width: 110 },
			{ field: 'C', header: 'Column C', width: 110 },
			{ field: 'D', header: 'Column D', width: 110 },
			{ field: 'E', header: 'Column E', width: 110 },
			{ field: 'F', header: 'Column F', width: 110 },
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
		const rows = generateSpreadsheetRows(500);
		for (let i = 0; i < 15; i++) {
			const rowId = `S-${1000 + i}`;
			const row = rows.find((r) => r.id === rowId);
			if (row) {
				row.C = `=SUM([${rowId}:A],[${rowId}:B])`;
				row.D = `=[${rowId}:C]*2`;
				row.E = `=[${rowId}:D]+10`;
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
	// D. PAGE 4: ADVANCED CUSTOM EDITORS & RENDERERS SHOWCASE (50 Rows)
	// --------------------------------------------------------------------------
	const customColumns = useMemo<ColumnDef<CustomShowcaseRow>[]>(
		() => [
			{ field: 'id', header: 'Product ID', width: 80 },
			{ field: 'name', header: 'Premium Product', width: 170 },
			{
				field: 'price',
				header: 'Unit Cost ($)',
				width: 120,
				cellRenderer: PriceBadgeRenderer,
			},
			{
				field: 'rating',
				header: 'Satisfaction Rating',
				width: 160,
				cellRenderer: StarRatingRenderer,
			},
			{
				field: 'progress',
				header: 'Fulfillment progress',
				width: 160,
				cellRenderer: ProgressBarRenderer,
				cellEditor: ProgressSliderEditor,
			},
			{
				field: 'status',
				header: 'Current Status',
				width: 120,
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
			{ field: 'id', header: 'Row ID', width: 80 },
			{ field: 'name', header: 'Product Name', width: 160 },
			{ field: 'price', header: 'Price ($)', width: 110 },
			{ field: 'quantity', header: 'Quantity', width: 90 },
			{
				field: 'subtotal',
				header: 'Subtotal ($)',
				width: 130,
				valueGetter: ({ row }) => {
					const price = parseFloat(row.price) || 0;
					const qty = parseFloat(row.quantity) || 0;
					return (price * qty).toFixed(2);
				},
			},
			{
				field: 'status',
				header: 'Status',
				width: 110,
				cellEditor: StatusDropdownEditor,
				cellRenderer: StatusBadgeRenderer,
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
	// F. PAGE 6: HEADLESS SKINS & THEMES PLAYGROUND (50 Rows)
	// --------------------------------------------------------------------------
	const skinsColumns = useMemo<ColumnDef<PerformanceRow>[]>(() => {
		return [
			{ field: 'id', header: 'Skin Row ID', width: 90 },
			{ field: 'name', header: 'Design Token', width: 170 },
			{ field: 'price', header: 'Cost Basis ($)', width: 110 },
			{ field: 'quantity', header: 'Allocated Vol', width: 100 },
			{
				field: 'status',
				header: 'Aesthetic Status',
				width: 130,
				cellEditor: StatusDropdownEditor,
				cellRenderer: StatusBadgeRenderer,
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

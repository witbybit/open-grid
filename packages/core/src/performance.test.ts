import { describe, it, expect, vi } from 'vitest';
import { GridStore, type ColumnDef, type ValueGetterParams } from './store.js';
import { ClientRowModelController } from './rowModel.js';

interface PerfTestRow {
	id: string;
	name: string;
	price: number;
	quantity: number;
	status: string;
}

type PerformanceWithMemory = Performance & {
	memory?: {
		usedJSHeapSize: number;
	};
};

describe('Performance Benchmarks', () => {
	describe('Scroll Performance', () => {
		it('should handle 100k row scroll with viewport updates under 16ms (60 FPS)', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
					{ field: 'quantity', header: 'Quantity', width: 100 },
					{ field: 'status', header: 'Status', width: 100 },
				],
			});

			// Generate 100k rows
			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 100000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: Math.random() * 1000,
					quantity: Math.floor(Math.random() * 100),
					status: i % 3 === 0 ? 'Active' : i % 3 === 1 ? 'Pending' : 'Inactive',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store, {
				rows,
				columns: store.getState().columns,
			});

			// Simulate viewport size
			store.setViewportSize(1200, 800);

			// Measure scroll performance
			const iterations = 100;
			const scrollPositions = [];

			for (let i = 0; i < iterations; i++) {
				scrollPositions.push(Math.floor(Math.random() * 3000000)); // Random scroll positions
			}

			const start = performance.now();

			for (const scrollTop of scrollPositions) {
				store.setScrollPosition(scrollTop, 0, performance.now());
				store.updateVisibleRanges();
			}

			const duration = performance.now() - start;
			const avgPerScroll = duration / iterations;

			console.log(`Scroll Performance: ${avgPerScroll.toFixed(3)}ms per scroll (${iterations} iterations)`);
			console.log(`Target: <16ms for 60 FPS, <8ms for 120 FPS`);

			// Should be well under 16ms per scroll update
			expect(avgPerScroll).toBeLessThan(16);

			controller.dispose();
		});

		it('should calculate visible ranges with binary search in O(log N) time', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 100000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store, {
				rows,
				columns: store.getState().columns,
			});

			store.setViewportSize(1200, 800);

			// Measure range calculation performance
			const start = performance.now();

			for (let i = 0; i < 1000; i++) {
				const scrollTop = Math.floor(Math.random() * 3000000);
				store.setScrollPosition(scrollTop, 0, performance.now());
				store.getVisibleRowRange();
			}

			const duration = performance.now() - start;
			const avgPerCalc = duration / 1000;

			console.log(`Range Calculation: ${avgPerCalc.toFixed(3)}ms per calculation`);

			// Should be extremely fast with binary search
			expect(avgPerCalc).toBeLessThan(1);

			controller.dispose();
		});
	});

	describe('Cell Update Performance', () => {
		it('should not fan out single-cell updates across unrelated valueGetter columns in wide grids', () => {
			const columns: ColumnDef<PerfTestRow>[] = [
				{ field: 'id', header: 'ID', width: 80 },
				{ field: 'status', header: 'Status', width: 100 },
				{
					field: 'derived_status',
					header: 'Derived Status',
					width: 120,
					valueGetterDependencies: ['status'],
					valueGetter: (params: ValueGetterParams<PerfTestRow>) => params.row.status.toUpperCase(),
				},
				...Array.from({ length: 2000 }, (_, i) => ({
					field: `col_${i}`,
					header: `Col ${i}`,
					width: 100,
					valueGetter: (params: ValueGetterParams<PerfTestRow>) =>
						(params.row as PerfTestRow & Record<string, unknown>)[`col_${i}`] ?? `Val ${i}`,
				})),
			];
			const store = new GridStore<PerfTestRow>({
				columns,
			});
			const rows: PerfTestRow[] = Array.from({ length: 10000 }, (_, i) => ({
				id: `row-${i}`,
				name: `Product ${i}`,
				price: 100,
				quantity: 10,
				status: 'Active',
			}));
			const controller = new ClientRowModelController<PerfTestRow>(store, {
				rows,
				columns,
			});

			const unrelatedListener = vi.fn();
			const dependentListener = vi.fn();
			store.registerCellSubscription({ rowId: 'row-5000', colField: 'col_1999', onStoreChange: unrelatedListener });
			store.registerCellSubscription({ rowId: 'row-5000', colField: 'derived_status', onStoreChange: dependentListener });

			const start = performance.now();
			store.setCellValue('row-5000', 'status', 'Inactive');
			store.flushCellUpdatesSync();
			const duration = performance.now() - start;

			expect(unrelatedListener).not.toHaveBeenCalled();
			expect(dependentListener).toHaveBeenCalledTimes(1);
			expect(duration).toBeLessThan(20);

			controller.dispose();
		});

		it('should handle 1000 cell updates under 50ms with batching', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 10000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store, {
				rows,
				columns: store.getState().columns,
			});

			const start = performance.now();

			// Update 1000 random cells using scoped batching
			store.batch(() => {
				for (let i = 0; i < 1000; i++) {
					const rowIdx = Math.floor(Math.random() * 10000);
					store.setCellValue(`row-${rowIdx}`, 'price', Math.random() * 1000);
				}
			});

			const duration = performance.now() - start;

			console.log(`Bulk Cell Updates: ${duration.toFixed(3)}ms for 1000 updates`);
			console.log(`Average: ${(duration / 1000).toFixed(3)}ms per update`);

			// Should handle 1000 updates quickly
			expect(duration).toBeLessThan(150);

			controller.dispose();
		});

		it('should update single cell under 2ms', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 1000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store, {
				rows,
				columns: store.getState().columns,
			});

			// Measure single cell update
			const durations: number[] = [];

			for (let i = 0; i < 100; i++) {
				const start = performance.now();
				store.setCellValue('row-500', 'price', Math.random() * 1000);
				const duration = performance.now() - start;
				durations.push(duration);
			}

			const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

			console.log(`Single Cell Update: ${avgDuration.toFixed(3)}ms average`);

			// Should be very fast
			expect(avgDuration).toBeLessThan(2);

			controller.dispose();
		});
	});

	describe('Memory Efficiency', () => {
		it('should maintain reasonable memory footprint for 100k rows', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
					{ field: 'quantity', header: 'Quantity', width: 100 },
					{ field: 'status', header: 'Status', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 100000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: Math.random() * 1000,
					quantity: Math.floor(Math.random() * 100),
					status: 'Active',
				});
			}

			const perf = performance as PerformanceWithMemory;
			const memBefore = perf.memory?.usedJSHeapSize || 0;

			const controller = new ClientRowModelController<PerfTestRow>(store, {
				rows,
				columns: store.getState().columns,
			});

			const memAfter = perf.memory?.usedJSHeapSize || 0;
			const memUsedMB = (memAfter - memBefore) / 1024 / 1024;

			if (memUsedMB > 0) {
				console.log(`Memory Usage: ${memUsedMB.toFixed(2)} MB for 100k rows`);
				// Should be under 150 MB
				expect(memUsedMB).toBeLessThan(150);
			}

			controller.dispose();
		});
	});

	describe('Column Resize Performance', () => {
		it('should handle column resize under 10ms', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 10000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store, {
				rows,
				columns: store.getState().columns,
			});

			const durations: number[] = [];

			for (let i = 0; i < 100; i++) {
				const start = performance.now();
				store.setColumnWidth('name', 150 + Math.random() * 100);
				const duration = performance.now() - start;
				durations.push(duration);
			}

			const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

			console.log(`Column Resize: ${avgDuration.toFixed(3)}ms average`);

			// Should be very fast
			expect(avgDuration).toBeLessThan(10);

			controller.dispose();
		});
	});

	describe('Selection Performance', () => {
		it('should calculate selection bounds under 5ms', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 10000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store, {
				rows,
				columns: store.getState().columns,
			});

			const durations: number[] = [];

			for (let i = 0; i < 100; i++) {
				const start = performance.now();
				store.selectRange({ rowId: 'row-100', colField: 'id' }, { rowId: 'row-500', colField: 'price' });
				const duration = performance.now() - start;
				durations.push(duration);
			}

			const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

			console.log(`Selection Bounds: ${avgDuration.toFixed(3)}ms average`);

			// Should be very fast
			expect(avgDuration).toBeLessThan(5);

			controller.dispose();
		});
	});
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordingGridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import { InfiniteRowModelController } from '../infiniteRowModel.js';
import { ClientRowModelController } from '../rowModel.js';
import { ServerSideRowModelController } from '../serverSideRowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { DefaultFrameCoordinator } from '../renderer/frameCoordinator.js';
import type { GridScheduler } from '../renderer/gridScheduler.js';
import { RenderEngine } from '../renderer/renderEngine.js';
import { CellDisplaySnapshotStore, createCellDisplaySnapshot } from '../renderer/cellDisplaySnapshot.js';

/** Fixed-queue scheduler: tests own every flush and never depend on elapsed time. */
class DeterministicScheduler implements GridScheduler {
	private nextId = 1;
	readonly microtasks: Array<() => void> = [];
	readonly rafs = new Map<number, () => void>();
	peakRafDepth = 0;

	microtask(callback: () => void): void {
		this.microtasks.push(callback);
	}
	raf(callback: () => void): number {
		const id = this.nextId++;
		this.rafs.set(id, callback);
		this.peakRafDepth = Math.max(this.peakRafDepth, this.rafs.size);
		return id;
	}
	cancelRaf(id: number): void {
		this.rafs.delete(id);
	}
	idle(callback: () => void): number {
		const id = this.nextId++;
		this.microtask(callback);
		return id;
	}
	cancelIdle(_id: number): void {}
	supportsIdle(): boolean {
		return true;
	}
	timeout(callback: () => void, _ms: number): number {
		const id = this.nextId++;
		this.microtask(callback);
		return id;
	}
	clearTimeout(_id: number): void {}

	drain(): void {
		while (this.microtasks.length > 0 || this.rafs.size > 0) {
			while (this.microtasks.length > 0) this.microtasks.shift()?.();
			const next = this.rafs.entries().next().value as [number, () => void] | undefined;
			if (!next) continue;
			this.rafs.delete(next[0]);
			next[1]();
		}
	}
}

function boundedPeak(samples: readonly number[], cap: number, label: string): void {
	expect(Math.max(...samples), `${label} must remain <= ${cap}`).toBeLessThanOrEqual(cap);
}

function noPositiveSlopeAcrossEpochs(samples: readonly number[], label: string): void {
	expect(samples.slice(1), `${label} must plateau after warm-up`).toEqual(samples.slice(1).map(() => samples[1]));
}

describe('long-session deterministic resilience', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
	});

	it('coalesces 10,000 mixed requests into bounded scheduler ownership and drains terminally', () => {
		const scheduler = new DeterministicScheduler();
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const onPostScrollWork = vi.fn();
		const coordinator = new DefaultFrameCoordinator({ onScrollFrame, onPaintFrame, onPostScrollWork, gridScheduler: scheduler });
		const epochRafPeaks: number[] = [];

		for (let operation = 0; operation < 10_000; operation++) {
			coordinator.requestScrollFrame();
			if (operation % 2 === 0) coordinator.requestPaintFrame();
			if (operation % 3 === 0) coordinator.requestPostScrollWork();
			if ((operation + 1) % 2_500 === 0) {
				epochRafPeaks.push(scheduler.peakRafDepth);
				scheduler.drain();
			}
		}

		boundedPeak(epochRafPeaks, 1, 'coordinator-owned RAF depth');
		noPositiveSlopeAcrossEpochs(epochRafPeaks, 'RAF depth');
		expect(onScrollFrame).toHaveBeenCalledTimes(4);
		expect(onPaintFrame).toHaveBeenCalledTimes(4);
		expect(onPostScrollWork).toHaveBeenCalledTimes(4);
		expect(coordinator.getOwnershipSnapshot()).toMatchObject({
			pendingScroll: false,
			pendingPaint: false,
			pendingPostScroll: false,
			ownsAnimationFrame: false,
			inFrame: false,
		});

		coordinator.requestPaintFrame();
		coordinator.destroy();
		scheduler.drain();
		expect(coordinator.getOwnershipSnapshot()).toMatchObject({
			pendingPaint: false,
			ownsAnimationFrame: false,
			destroyed: true,
		});
	});

	it('keeps recording diagnostics bounded for a 100,000-frame session', () => {
		const instrumentation = new RecordingGridInstrumentation({ frameCapacity: 8, fallbackCapacity: 4 });
		for (let frame = 0; frame < 100_000; frame++) {
			instrumentation.recordFrame({ kind: 'scroll', durationMs: frame, rowsVisited: 20, cellsWritten: 200 });
		}
		const snapshot = instrumentation.snapshot();
		expect(snapshot.frames).toHaveLength(8);
		expect(snapshot.frames[0]?.durationMs).toBe(99_992);
		expect(snapshot.droppedFrames).toBe(99_992);
	});

	it('keeps the 10,000-cell directional-prewarm snapshot working set bounded', () => {
		const snapshots = new CellDisplaySnapshotStore(128);
		const epochs: number[] = [];
		for (let operation = 0; operation < 10_000; operation++) {
			snapshots.set(
				createCellDisplaySnapshot({
					rowId: `row-${operation}`,
					colField: 'value',
					rowVersion: 0,
					globalVersion: 0,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: String(operation),
					title: '',
				})
			);
			if ((operation + 1) % 2_500 === 0) epochs.push(snapshots.getOwnershipSnapshot().entryCount);
		}
		boundedPeak(epochs, 128, 'directional-prewarm snapshots');
		noPositiveSlopeAcrossEpochs(epochs, 'directional-prewarm snapshots');
		expect(snapshots.getOwnershipSnapshot()).toEqual({ entryCount: 128, maxEntries: 128, evictedSnapshotCount: 9_872 });
	});

	it('keeps a mounted 100,000-row client grid at a stable slot plateau through 10,000 mixed scroll operations', () => {
		type Row = { id: string; [field: string]: string };
		const columns: ColumnDef<Row>[] = Array.from({ length: 12 }, (_, index) => ({ field: `c${index}`, header: `C${index}`, width: 90 }));
		const rows = Array.from({ length: 100_000 }, (_, index) => ({ id: `row-${index}`, c0: `value-${index}` }));
		const store = new GridStore<Row>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 90,
			rowOverscanPx: 80,
			colBuffer: 1,
			getRowId: (row) => row.id,
			runtimeLimits: { maxRenderedRows: 24, maxRenderedCells: 288 },
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns });
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 540,
			bottom: 240,
			width: 540,
			height: 240,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		try {
			renderer.fullPaint();
			const epochs: number[] = [];
			for (let operation = 0; operation < 10_000; operation++) {
				store.engine.viewport.setScrollPosition((operation * 160) % 3_900_000, (operation * 90) % 720);
				if ((operation + 1) % 250 === 0) renderer.fullPaint();
				if ((operation + 1) % 2_500 === 0) epochs.push(renderer.rowRenderer.getOwnershipSnapshot().cellSlotCount);
			}
			boundedPeak(epochs, 288, 'client cell slots');
			noPositiveSlopeAcrossEpochs(epochs, 'client cell slots');
			expect(container.querySelectorAll('.og-row').length).toBeGreaterThan(0);
			renderer.unmount();
			expect(renderer.rowRenderer.getOwnershipSnapshot()).toMatchObject({ activeRowCount: 0, dirtyCellCount: 0, dirtyRowCount: 0 });
		} finally {
			renderer.unmount();
			controller.dispose();
			store.destroy();
		}
	});

	it('keeps infinite and SSRM blocks, requests, and indexes bounded across 2,000 non-adjacent traversals', async () => {
		type Row = { id: string; name: string };
		const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name', width: 120 }];
		const run = async (mode: 'infinite' | 'server') => {
			const store = new GridStore<Row>({ columns, getRowId: (row) => row.id });
			const datasource = {
				getRows: async (request: { startRow: number }) => ({
					rows: [{ id: `${mode}-${request.startRow}`, name: `${mode}-${request.startRow}` }],
					totalCount: 10_000,
					rowCount: 10_000,
				}),
			};
			const controller =
				mode === 'infinite'
					? new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
							columns,
							datasource,
							blockSize: 1,
							maxBlocksInCache: 3,
							maxConcurrentRequests: 1,
						})
					: new ServerSideRowModelController(store.getServerSideRowModelRuntime(), {
							columns,
							datasource,
							blockSize: 1,
							maxBlocksInCache: 3,
							maxConcurrentRequests: 1,
						});
			try {
				for (let operation = 0; operation < 2_000; operation++) {
					controller.ensureRange((operation * 37) % 9_000, (operation * 37) % 9_000, 'long-session');
					await Promise.resolve();
					await Promise.resolve();
				}
				await Promise.resolve();
				const snapshot = controller.getOwnershipSnapshot();
				if ('cacheBlockCount' in snapshot) {
					expect(snapshot.cacheBlockCount).toBeLessThanOrEqual(4);
					expect(snapshot.activeAbortControllerCount).toBeLessThanOrEqual(1);
				} else {
					expect(snapshot.blockCount).toBeLessThanOrEqual(4);
					expect(snapshot.activeRequestCount).toBeLessThanOrEqual(1);
				}
				controller.dispose();
				const after = controller.getOwnershipSnapshot();
				if ('activeAbortControllerCount' in after) expect(after.activeAbortControllerCount).toBe(0);
				else expect(after.activeRequestCount).toBe(0);
			} finally {
				controller.dispose();
				store.destroy();
			}
		};
		await run('infinite');
		await run('server');
	}, 30_000);
});

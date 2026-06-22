import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridTransactionStreamImpl } from './GridTransactionStream.js';
import type { GridTransactionStreamDeps } from './GridTransactionStream.js';
import type { GridScheduler } from '../../renderer/gridScheduler.js';

// Thin scheduler shim that delegates to global setTimeout (intercepted by vi.useFakeTimers)
const testScheduler: GridScheduler = {
	timeout: (cb, ms) => setTimeout(cb, ms) as unknown as ReturnType<typeof setTimeout>,
	clearTimeout: (id) => clearTimeout(id as unknown as Parameters<typeof clearTimeout>[0]),
	microtask: (cb) => queueMicrotask(cb),
	raf: (cb) => requestAnimationFrame(cb),
	cancelRaf: (id) => cancelAnimationFrame(id),
	idle: (cb) => {
		cb();
		return 0;
	},
	cancelIdle: () => {},
};

type Row = { id: string; name: string; amount: number };

function makeDeps(overrides?: Partial<GridTransactionStreamDeps<Row>>) {
	const commitCells = vi.fn();
	const applyRowPatch = vi.fn();
	const isCellBeingEdited = vi.fn().mockReturnValue(false);
	const requestInsightRepaint = vi.fn();
	const onDestroy = vi.fn();
	return {
		deps: {
			commitCells,
			applyRowPatch,
			isCellBeingEdited,
			requestInsightRepaint,
			onDestroy,
			scheduler: testScheduler,
			...overrides,
		} satisfies GridTransactionStreamDeps<Row>,
		commitCells,
		applyRowPatch,
		isCellBeingEdited,
		requestInsightRepaint,
		onDestroy,
	};
}

describe('GridTransactionStreamImpl', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('registers as insight layer with id "liveStream"', () => {
		const { deps } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps);
		expect(stream.id).toBe('liveStream');
	});

	it('push cell update and flush calls commitCells', () => {
		const { deps, commitCells } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { batchMs: 16 });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 999 }]);
		vi.advanceTimersByTime(20);
		expect(commitCells).toHaveBeenCalledOnce();
		expect(commitCells.mock.calls[0][0]).toEqual([{ rowId: 'r1', colField: 'amount', value: 999 }]);
	});

	it('coalesces repeated cell updates to latest value', () => {
		const { deps, commitCells } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { batchMs: 50 });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 100 }]);
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 200 }]);
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 999 }]);
		vi.advanceTimersByTime(60);
		expect(commitCells).toHaveBeenCalledOnce();
		const committed = commitCells.mock.calls[0][0];
		expect(committed).toHaveLength(1);
		expect(committed[0].value).toBe(999);
	});

	it('flush() immediately commits pending cells', () => {
		const { deps, commitCells } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { batchMs: 1000 });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 42 }]);
		stream.flush();
		expect(commitCells).toHaveBeenCalledOnce();
	});

	it('push row patch calls applyRowPatch on flush', () => {
		const { deps, applyRowPatch } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { batchMs: 16 });
		stream.pushRows([{ rowId: 'r1', patch: { name: 'Updated' } }]);
		vi.advanceTimersByTime(20);
		expect(applyRowPatch).toHaveBeenCalledOnce();
		expect(applyRowPatch).toHaveBeenCalledWith('r1', { name: 'Updated' });
	});

	it('row patches are merged for same rowId', () => {
		const { deps, applyRowPatch } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { batchMs: 50 });
		stream.pushRows([{ rowId: 'r1', patch: { name: 'Alice' } }]);
		stream.pushRows([{ rowId: 'r1', patch: { amount: 500 } }]);
		vi.advanceTimersByTime(60);
		expect(applyRowPatch).toHaveBeenCalledOnce();
		expect(applyRowPatch.mock.calls[0][1]).toMatchObject({ name: 'Alice', amount: 500 });
	});

	it('pause prevents flushing', () => {
		const { deps, commitCells } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { batchMs: 16 });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 99 }]);
		stream.pause();
		vi.advanceTimersByTime(100);
		expect(commitCells).not.toHaveBeenCalled();
	});

	it('resume flushes pending updates', () => {
		const { deps, commitCells } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { batchMs: 16 });
		stream.pause();
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 99 }]);
		stream.resume();
		vi.advanceTimersByTime(20);
		expect(commitCells).toHaveBeenCalledOnce();
	});

	it('destroy clears pending work and calls onDestroy', () => {
		const { deps, commitCells, onDestroy } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { batchMs: 16 });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 99 }]);
		stream.destroy();
		vi.advanceTimersByTime(100);
		expect(commitCells).not.toHaveBeenCalled();
		expect(onDestroy).toHaveBeenCalledOnce();
	});

	it('history suppressed by default — commitCells path used (not batchCellValues)', () => {
		const { deps, commitCells } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps); // default history: 'suppress'
		expect(stream.getState()).toMatchObject({ committedBatches: 0 });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 1 }]);
		stream.flush();
		// commitCells is the suppress-history path
		expect(commitCells).toHaveBeenCalledOnce();
	});

	it('dirty cell update is skipped when dirtyCellPolicy is "skip"', () => {
		const { deps, commitCells, isCellBeingEdited } = makeDeps();
		isCellBeingEdited.mockImplementation((r, c) => r === 'r1' && c === 'amount');
		const stream = new GridTransactionStreamImpl<Row>(deps, { dirtyCellPolicy: 'skip' });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 999 }]);
		stream.flush();
		expect(commitCells).not.toHaveBeenCalled();
	});

	it('skipped dirty update increments diagnostics', () => {
		const { deps, isCellBeingEdited } = makeDeps();
		isCellBeingEdited.mockReturnValue(true);
		const stream = new GridTransactionStreamImpl<Row>(deps, { dirtyCellPolicy: 'skip' });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 5 }]);
		stream.flush();
		expect(stream.getState().skippedDirtyUpdates).toBe(1);
	});

	it('flash decoration appears after commit', () => {
		const { deps } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { flashChanges: true, batchMs: 16 });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 7 }]);
		vi.advanceTimersByTime(20);
		const decs = stream.getCellDecorations('r1', 'amount');
		expect(decs).toHaveLength(1);
		expect(decs[0].className).toBe('og-cell-live-flash');
	});

	it('flash decoration expires after duration', () => {
		const { deps } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { flashChanges: true, batchMs: 16 });
		stream.pushCells([{ rowId: 'r1', colField: 'amount', value: 7 }]);
		vi.advanceTimersByTime(20);
		expect(stream.getCellDecorations('r1', 'amount')).toHaveLength(1);
		vi.advanceTimersByTime(700); // past FLASH_DURATION_MS (600ms)
		expect(stream.getCellDecorations('r1', 'amount')).toHaveLength(0);
	});

	it('backpressure prevents unbounded queue when maxBatchSize exceeded', () => {
		const { deps } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps, { maxBatchSize: 3 });
		// Push 5 unique cells — only 3 should be queued, 2 dropped
		for (let i = 0; i < 5; i++) {
			stream.pushCells([{ rowId: `r${i}`, colField: 'amount', value: i }]);
		}
		const state = stream.getState();
		expect(state.pendingUpdates).toBeLessThanOrEqual(3);
		expect(state.droppedUpdates).toBeGreaterThan(0);
	});

	it('no direct row mutation — applyRowPatch callback used', () => {
		const { deps, applyRowPatch } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps);
		stream.pushRows([{ rowId: 'r1', patch: { name: 'test' } }]);
		stream.flush();
		// Only via the dep callback, not via any direct reference to row data
		expect(applyRowPatch).toHaveBeenCalledOnce();
	});

	it('getDiagnostics returns current stream state', () => {
		const { deps } = makeDeps();
		const stream = new GridTransactionStreamImpl<Row>(deps);
		stream.pushCells([{ rowId: 'r1', colField: 'x', value: 1 }]);
		const diag = stream.getDiagnostics() as ReturnType<typeof stream.getState>;
		expect(diag.pendingUpdates).toBe(1);
	});
});

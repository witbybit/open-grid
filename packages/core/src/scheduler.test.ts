import { describe, it, expect } from 'vitest';
import { FrameScheduler, Priority, FrameBudget, TransactionScheduler, PriorityLane } from './scheduler.js';

describe('FrameBudget', () => {
	it('should track elapsed and remaining time against budget', () => {
		const budget = new FrameBudget(10); // 10ms budget
		const start = 1000;

		// Stub performance.now
		let mockTime = start;
		const originalNow = performance.now;
		performance.now = () => mockTime;

		try {
			budget.startFrame(start);
			expect(budget.elapsed()).toBe(0);
			expect(budget.remaining()).toBe(10);
			expect(budget.hasRemaining()).toBe(true);

			mockTime = 1005; // 5ms elapsed
			expect(budget.elapsed()).toBe(5);
			expect(budget.remaining()).toBe(5);
			expect(budget.hasRemaining()).toBe(true);

			mockTime = 1012; // 12ms elapsed (exceeded)
			expect(budget.elapsed()).toBe(12);
			expect(budget.remaining()).toBe(0);
			expect(budget.hasRemaining()).toBe(false);
		} finally {
			performance.now = originalNow;
		}
	});
});

describe('FrameScheduler Priority Queues and Budgeting', () => {
	it('should execute critical tasks synchronously and immediately', () => {
		const scheduler = new FrameScheduler(5);
		let executed = false;

		scheduler.schedule(Priority.CRITICAL, () => {
			executed = true;
		});

		expect(executed).toBe(true);
	});

	it('should run high-priority immediately and defer normal-priority when budget is exhausted', () => {
		const scheduler = new FrameScheduler(5); // 5ms budget
		const tracking: string[] = [];

		let mockTime = 1000;
		const originalNow = performance.now;
		performance.now = () => mockTime;

		let rafCallback: ((ts: number) => void) | null = null;
		const originalRAF = (globalThis as any).requestAnimationFrame;
		(globalThis as any).requestAnimationFrame = (cb: any) => {
			rafCallback = cb;
			return 123;
		};
		const originalCancelRAF = (globalThis as any).cancelAnimationFrame;
		(globalThis as any).cancelAnimationFrame = () => {
			rafCallback = null;
		};

		try {
			// Schedule SCROLL task (high-priority, always execute)
			scheduler.schedule(Priority.SCROLL, () => {
				tracking.push('scroll-1');
				mockTime += 2; // spends 2ms
			});

			// Schedule INPUT task (normal priority, budget-gated)
			scheduler.schedule(Priority.INPUT, () => {
				tracking.push('input-1');
				mockTime += 4; // spends 4ms, total elapsed in frame = 6ms (budget exhausted)
			});

			// Schedule SELECTION task (normal priority, budget-gated)
			scheduler.schedule(Priority.SELECTION, () => {
				tracking.push('selection-1');
			});

			// Schedule DATA_UPDATE task (low priority, budget-gated)
			scheduler.schedule(Priority.DATA_UPDATE, () => {
				tracking.push('data-1');
			});

			// Trigger frame 1
			expect(rafCallback).not.toBeNull();
			const cb1 = rafCallback!;
			rafCallback = null;
			cb1(mockTime);

			// Frame 1 should run scroll-1 (Phase 1), input-1 (Phase 2, which exhausts budget), and then defer others.
			expect(tracking).toEqual(['scroll-1', 'input-1']);

			// Since tasks are deferred, a new frame must be scheduled
			expect(rafCallback).not.toBeNull();
			const cb2 = rafCallback!;
			rafCallback = null;

			// Reset mock time for frame 2
			mockTime = 2000;
			cb2(mockTime);

			// Frame 2 should process deferred SELECTION and DATA_UPDATE tasks
			expect(tracking).toEqual(['scroll-1', 'input-1', 'selection-1', 'data-1']);
			expect(rafCallback).toBeNull(); // All tasks completed
		} finally {
			performance.now = originalNow;
			(globalThis as any).requestAnimationFrame = originalRAF;
			(globalThis as any).cancelAnimationFrame = originalCancelRAF;
		}
	});

	it('should support task cancellation before execution', () => {
		const scheduler = new FrameScheduler(5);
		const tracking: string[] = [];

		let mockTime = 1000;
		const originalNow = performance.now;
		performance.now = () => mockTime;

		let rafCallback: ((ts: number) => void) | null = null;
		const originalRAF = (globalThis as any).requestAnimationFrame;
		(globalThis as any).requestAnimationFrame = (cb: any) => {
			rafCallback = cb;
			return 123;
		};

		try {
			scheduler.schedule(Priority.SCROLL, () => {
				tracking.push('scroll-1');
			});

			const handle = scheduler.schedule(Priority.INPUT, () => {
				tracking.push('input-1');
			});

			// Cancel input-1 task
			handle.cancel();

			expect(rafCallback).not.toBeNull();
			const cb1 = rafCallback!;
			rafCallback = null;
			cb1(mockTime);

			expect(tracking).toEqual(['scroll-1']);
		} finally {
			performance.now = originalNow;
			(globalThis as any).requestAnimationFrame = originalRAF;
		}
	});
});

describe('FrameScheduler Yieldable Continuation Tasks', () => {
	it('should run yieldable tasks across multiple frames and allow preemption', () => {
		const scheduler = new FrameScheduler(5); // 5ms budget
		const tracking: string[] = [];
		let mockTime = 1000;
		const originalNow = performance.now;
		performance.now = () => mockTime;

		let rafCallback: ((ts: number) => void) | null = null;
		const originalRAF = (globalThis as any).requestAnimationFrame;
		(globalThis as any).requestAnimationFrame = (cb: any) => {
			rafCallback = cb;
			return 123;
		};

		try {
			let workCount = 0;
			scheduler.scheduleYieldable(Priority.RECALC, (hasRemaining) => {
				while (hasRemaining()) {
					workCount++;
					tracking.push(`work-${workCount}`);
					mockTime += 3; // spend 3ms per work step
					if (workCount === 3) {
						return false; // completed
					}
				}
				return true; // yield, more work left
			});

			// Execute Frame 1
			expect(rafCallback).not.toBeNull();
			const cb1 = rafCallback!;
			rafCallback = null;
			cb1(mockTime);

			// Frame 1 budget = 5ms.
			// Work 1 spends 3ms. mockTime = 1003. hasRemaining = true.
			// Work 2 spends 3ms. mockTime = 1006. hasRemaining = false. Yield!
			expect(tracking).toEqual(['work-1', 'work-2']);

			// Schedule high-priority task to run in Frame 2
			scheduler.schedule(Priority.SCROLL, () => {
				tracking.push('scroll-1');
			});

			// Execute Frame 2
			expect(rafCallback).not.toBeNull();
			const cb2 = rafCallback!;
			rafCallback = null;
			cb2(mockTime);

			// High-priority SCROLL runs first, then RECALC work resumes.
			// Work 3 spends 3ms, mockTime = 1009. workCount === 3 => done.
			expect(tracking).toEqual(['work-1', 'work-2', 'scroll-1', 'work-3']);
			expect(rafCallback).toBeNull(); // All tasks done, loop terminates
		} finally {
			performance.now = originalNow;
			(globalThis as any).requestAnimationFrame = originalRAF;
		}
	});
});

describe('TransactionScheduler Backward Compatibility', () => {
	it('should support synchronous immediately-executed Interactive lane and flushAllSync', () => {
		const scheduler = new TransactionScheduler();
		const tracking: string[] = [];

		scheduler.schedule(PriorityLane.Stream, () => tracking.push('stream-1'));
		scheduler.schedule(PriorityLane.Render, () => tracking.push('render-1'));
		scheduler.schedule(PriorityLane.Interactive, () => tracking.push('interactive-1'));

		// Interactive lane executes immediately (CRITICAL priority maps to immediate sync)
		expect(tracking).toContain('interactive-1');
		expect(tracking).not.toContain('render-1');
		expect(tracking).not.toContain('stream-1');

		// Synchronous flush of all queued tasks
		scheduler.flushAllSync();
		expect(tracking).toEqual(['interactive-1', 'render-1', 'stream-1']);
	});
});

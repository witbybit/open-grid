export enum Priority {
	// ─── SYNC (execute immediately, block frame) ─────
	CRITICAL = 0, // Error recovery, corruption repair

	// ─── HIGH (execute in current rAF frame) ─────────
	SCROLL = 1, // Scroll-driven viewport updates
	ANIMATION = 2, // Active animations (resize drag, etc.)

	// ─── NORMAL (execute if frame budget allows) ──────
	INPUT = 3, // User input (click, keyboard)
	EDIT = 4, // Cell editing operations
	SELECTION = 5, // Selection range updates

	// ─── LOW (defer to next frame or idle) ────────────
	DATA_UPDATE = 6, // Data changes from external sources
	HOVER = 7, // Hover effects

	// ─── IDLE (execute during idle periods) ───────────
	RECALC = 8, // Formula recalculation
	MEASUREMENT = 9, // Auto-size measurements
	PREFETCH = 10, // Predictive data loading
}

export enum PriorityLane {
	Interactive = 0, // Immediate execution (e.g. typing, arrow navigation)
	Render = 1, // requestAnimationFrame (e.g. scrolling, layout changes, resizing)
	Stream = 2, // Microtask/delayed execution (e.g. websocket stream updates)
	Recalculation = 3, // Idle callback / deferred execution (e.g. formulas, sorting, filtering)
}

export interface Task {
	id: string;
	run: () => void;
}

export interface TaskHandle {
	cancel: () => void;
}

export type YieldableWork = (hasRemaining: () => boolean) => boolean;

export interface YieldableTask {
	work: YieldableWork;
	priority: Priority;
	progress?: number;
}

/**
 * FrameBudget — Tracks time remaining in the current animation frame.
 */
export class FrameBudget {
	private budgetMs: number;
	private frameStart: number = 0;

	constructor(budgetMs: number = 7) {
		this.budgetMs = budgetMs;
	}

	startFrame(timestamp?: number): void {
		this.frameStart = timestamp || performance.now();
	}

	hasRemaining(): boolean {
		return performance.now() - this.frameStart < this.budgetMs;
	}

	elapsed(): number {
		return performance.now() - this.frameStart;
	}

	remaining(): number {
		return Math.max(0, this.budgetMs - this.elapsed());
	}
}

/**
 * FrameScheduler — Frame-budget-aware task scheduler.
 *
 * Runs on a requestAnimationFrame loop and processes tasks in priority order.
 * Defers work exceeding the frame budget to the subsequent frames.
 */
export class FrameScheduler {
	private queues = new Map<Priority, Task[]>();
	private frameId: any = null;
	private isRunning = false;
	private frameBudget: FrameBudget;
	private currentYieldableTask: YieldableTask | null = null;
	private idleCallbackId: any = null;

	constructor(budgetMs: number = 7) {
		this.frameBudget = new FrameBudget(budgetMs);
		for (const priority of Object.values(Priority)) {
			if (typeof priority === 'number') {
				this.queues.set(priority, []);
			}
		}
	}

	/**
	 * Schedule a task at a given priority.
	 * CRITICAL priority tasks run synchronously and immediately.
	 */
	public schedule(priority: Priority, task: () => void): TaskHandle {
		if (priority === Priority.CRITICAL) {
			try {
				task();
			} catch (e) {
				console.error(`FrameScheduler: Error executing CRITICAL task`, e);
			}
			return { cancel: () => {} };
		}

		const id = Math.random().toString(36).substring(2, 9);
		const item: Task = { id, run: task };
		this.queues.get(priority)!.push(item);

		this.ensureFrameLoop();

		return {
			cancel: () => {
				const queue = this.queues.get(priority);
				if (queue) {
					const index = queue.findIndex((t) => t.id === id);
					if (index !== -1) {
						queue.splice(index, 1);
					}
				}
			},
		};
	}

	/**
	 * Schedule a yieldable task via a continuation function.
	 */
	public scheduleYieldable(priority: Priority, work: YieldableWork): void {
		this.currentYieldableTask = {
			work,
			priority,
		};
		this.ensureFrameLoop();
	}

	private ensureFrameLoop(): void {
		if (this.isRunning) return;
		this.isRunning = true;

		if (this.idleCallbackId !== null) {
			if (typeof cancelIdleCallback !== 'undefined') {
				cancelIdleCallback(this.idleCallbackId);
			}
			this.idleCallbackId = null;
		}

		if (typeof requestAnimationFrame !== 'undefined') {
			this.frameId = requestAnimationFrame((timestamp) => this.frameLoop(timestamp));
		} else {
			queueMicrotask(() => {
				this.frameLoop(performance.now());
			});
		}
	}

	private frameLoop = (timestamp: number): void => {
		this.frameBudget.startFrame(timestamp);

		// Phase 1: High priority lanes (SCROLL, ANIMATION) — always execute, never deferred
		this.flushQueue(Priority.SCROLL);
		this.flushQueue(Priority.ANIMATION);

		// Phase 2: Normal priority lanes (INPUT, EDIT, SELECTION) — budget-gated
		if (this.frameBudget.hasRemaining()) this.flushQueue(Priority.INPUT);
		if (this.frameBudget.hasRemaining()) this.flushQueue(Priority.EDIT);
		if (this.frameBudget.hasRemaining()) this.flushQueue(Priority.SELECTION);

		// Phase 3: Low priority lanes (DATA_UPDATE, HOVER) — budget-gated
		if (this.frameBudget.hasRemaining()) this.flushQueue(Priority.DATA_UPDATE);
		if (this.frameBudget.hasRemaining()) this.flushQueue(Priority.HOVER);

		// Phase 4: Interruptible work execution
		if (this.frameBudget.hasRemaining() && this.currentYieldableTask) {
			this.processYieldableWork();
		}

		// Continue the frame loop or delegate to requestIdleCallback
		if (this.hasWork()) {
			if (typeof requestAnimationFrame !== 'undefined') {
				this.frameId = requestAnimationFrame((ts) => this.frameLoop(ts));
			} else {
				queueMicrotask(() => this.frameLoop(performance.now()));
			}
		} else {
			this.isRunning = false;
			this.frameId = null;

			if (this.hasIdleWork()) {
				this.scheduleIdleCallback();
			}
		}
	};

	private processYieldableWork(): void {
		if (!this.currentYieldableTask) return;
		const task = this.currentYieldableTask;

		try {
			const hasMore = task.work(() => this.frameBudget.hasRemaining());
			if (!hasMore) {
				this.currentYieldableTask = null;
			}
		} catch (e) {
			console.error(`FrameScheduler: Error in yieldable task`, e);
			this.currentYieldableTask = null;
		}
	}

	private flushQueue(priority: Priority): void {
		const queue = this.queues.get(priority);
		if (!queue || queue.length === 0) return;

		const tasksToRun = [...queue];
		queue.length = 0;

		for (let i = 0; i < tasksToRun.length; i++) {
			try {
				tasksToRun[i].run();
			} catch (e) {
				console.error(`FrameScheduler: Error executing task at priority ${priority}`, e);
			}
		}
	}

	private hasWork(): boolean {
		for (const priority of [
			Priority.SCROLL,
			Priority.ANIMATION,
			Priority.INPUT,
			Priority.EDIT,
			Priority.SELECTION,
			Priority.DATA_UPDATE,
			Priority.HOVER,
		]) {
			const queue = this.queues.get(priority);
			if (queue && queue.length > 0) return true;
		}
		return this.currentYieldableTask !== null;
	}

	private hasIdleWork(): boolean {
		for (const priority of [Priority.RECALC, Priority.MEASUREMENT, Priority.PREFETCH]) {
			const queue = this.queues.get(priority);
			if (queue && queue.length > 0) return true;
		}
		return false;
	}

	private scheduleIdleCallback(): void {
		if (this.idleCallbackId !== null) return;

		if (typeof requestIdleCallback !== 'undefined') {
			this.idleCallbackId = requestIdleCallback((deadline) => {
				this.idleCallbackId = null;
				this.runIdleWork(() => deadline.timeRemaining() > 1);
			});
		} else {
			if (typeof requestAnimationFrame !== 'undefined') {
				this.idleCallbackId = requestAnimationFrame(() => {
					this.idleCallbackId = null;
					const start = performance.now();
					this.runIdleWork(() => performance.now() - start < 5);
				});
			} else {
				queueMicrotask(() => {
					this.runIdleWork(() => true);
				});
			}
		}
	}

	private runIdleWork(hasTime: () => boolean): void {
		const idlePriorities = [Priority.RECALC, Priority.MEASUREMENT, Priority.PREFETCH];

		for (const priority of idlePriorities) {
			const queue = this.queues.get(priority);
			if (!queue) continue;

			while (queue.length > 0 && hasTime()) {
				const task = queue.shift();
				if (task) {
					try {
						task.run();
					} catch (e) {
						console.error(`FrameScheduler: Error executing idle task at priority ${priority}`, e);
					}
				}
			}

			if (queue.length > 0) {
				this.scheduleIdleCallback();
				break;
			}
		}
	}

	public flushAllSync(): void {
		if (this.frameId !== null) {
			if (typeof cancelAnimationFrame !== 'undefined') {
				cancelAnimationFrame(this.frameId);
			}
			this.frameId = null;
		}
		this.isRunning = false;

		if (this.idleCallbackId !== null) {
			if (typeof cancelIdleCallback !== 'undefined') {
				cancelIdleCallback(this.idleCallbackId);
			} else if (typeof cancelAnimationFrame !== 'undefined') {
				cancelAnimationFrame(this.idleCallbackId);
			}
			this.idleCallbackId = null;
		}

		for (const priority of Object.values(Priority)) {
			if (typeof priority === 'number') {
				this.flushQueue(priority);
			}
		}

		if (this.currentYieldableTask) {
			try {
				let done = false;
				while (!done) {
					done = !this.currentYieldableTask.work(() => true);
				}
			} catch (e) {
				console.error(`FrameScheduler: Error flushing yieldable task synchronously`, e);
			}
			this.currentYieldableTask = null;
		}
	}
}

/**
 * TransactionScheduler — Backward compatibility facade.
 * Delegates work directly to the modern FrameScheduler.
 */
export class TransactionScheduler {
	private frameScheduler: FrameScheduler;

	constructor() {
		this.frameScheduler = new FrameScheduler();
	}

	public schedule(lane: PriorityLane, update: () => void): void {
		let priority: Priority;
		switch (lane) {
			case PriorityLane.Interactive:
				priority = Priority.CRITICAL;
				break;
			case PriorityLane.Render:
				priority = Priority.SCROLL;
				break;
			case PriorityLane.Stream:
				priority = Priority.DATA_UPDATE;
				break;
			case PriorityLane.Recalculation:
				priority = Priority.RECALC;
				break;
			default:
				priority = Priority.INPUT;
		}

		this.frameScheduler.schedule(priority, update);
	}

	public flushAllSync(): void {
		this.frameScheduler.flushAllSync();
	}
}

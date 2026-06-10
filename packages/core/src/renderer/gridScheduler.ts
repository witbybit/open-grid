/** Subset of the DOM IdleDeadline interface (kept structural for non-DOM test envs). */
export interface GridIdleDeadline {
	timeRemaining(): number;
	readonly didTimeout: boolean;
}

export interface GridScheduler {
	/** Schedule a callback after the current microtask queue drains. */
	microtask(callback: () => void): void;
	/** Schedule a callback on the next animation frame. */
	raf(callback: () => void): number;
	cancelRaf(id: number): void;
	/**
	 * Schedule a callback in idle time, falling back to RAF when unavailable.
	 * Passes the IdleDeadline through (when available) so callers can budget work by
	 * remaining time instead of fixed op counts. A timeout guarantees the callback
	 * runs even on busy pages where idle time never arrives.
	 */
	idle(callback: (deadline?: GridIdleDeadline) => void): number;
	cancelIdle(id: number): void;
	/** Schedule a callback after a delay (ms). */
	timeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
	clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

export class DefaultGridScheduler implements GridScheduler {
	microtask(callback: () => void): void {
		if (typeof queueMicrotask !== 'undefined') {
			queueMicrotask(callback);
		} else {
			Promise.resolve().then(callback);
		}
	}

	raf(callback: () => void): number {
		if (typeof requestAnimationFrame !== 'undefined') {
			return requestAnimationFrame(callback);
		}
		callback();
		return 0;
	}

	cancelRaf(id: number): void {
		if (typeof cancelAnimationFrame !== 'undefined') {
			cancelAnimationFrame(id);
		}
	}

	idle(callback: (deadline?: GridIdleDeadline) => void): number {
		if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
			return (
				window as unknown as {
					requestIdleCallback: (cb: (deadline: GridIdleDeadline) => void, opts?: { timeout: number }) => number;
				}
			).requestIdleCallback(callback, { timeout: 100 });
		}
		return this.raf(() => callback());
	}

	cancelIdle(id: number): void {
		if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
			(window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id);
		} else {
			this.cancelRaf(id);
		}
	}

	timeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
		return setTimeout(callback, ms);
	}

	clearTimeout(id: ReturnType<typeof setTimeout>): void {
		clearTimeout(id);
	}
}

export const defaultGridScheduler: GridScheduler = new DefaultGridScheduler();

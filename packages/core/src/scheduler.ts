export enum PriorityLane {
	Interactive = 0, // Immediate execution (e.g. typing, arrow navigation)
	Render = 1, // requestAnimationFrame (e.g. scrolling, layout changes, resizing)
	Stream = 2, // Microtask/delayed execution (e.g. websocket stream updates)
	Recalculation = 3, // Idle callback / deferred execution (e.g. formulas, sorting, filtering)
}

export class TransactionScheduler {
	private pendingQueue = new Map<PriorityLane, Array<() => void>>();
	private frameRequested = false;
	private streamTimeout: any = null;
	private idleCallbackId: any = null;

	public schedule(lane: PriorityLane, update: () => void): void {
		if (!this.pendingQueue.has(lane)) {
			this.pendingQueue.set(lane, []);
		}
		this.pendingQueue.get(lane)!.push(update);

		if (lane === PriorityLane.Interactive) {
			this.flushLane(PriorityLane.Interactive);
		} else if (lane === PriorityLane.Render) {
			this.requestFrame();
		} else if (lane === PriorityLane.Stream) {
			this.requestStreamFlush();
		} else if (lane === PriorityLane.Recalculation) {
			this.requestIdleFlush();
		}
	}

	private requestFrame(): void {
		if (this.frameRequested) return;
		this.frameRequested = true;
		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(() => {
				this.frameRequested = false;
				this.flushLane(PriorityLane.Render);
			});
		} else {
			// Fallback for Node / testing environments
			setTimeout(() => {
				this.frameRequested = false;
				this.flushLane(PriorityLane.Render);
			}, 0);
		}
	}

	private requestStreamFlush(): void {
		if (this.streamTimeout) return;
		this.streamTimeout = setTimeout(() => {
			this.streamTimeout = null;
			this.flushLane(PriorityLane.Stream);
		}, 50); // Throttled streaming into 50ms batching windows
	}

	private requestIdleFlush(): void {
		if (this.idleCallbackId) return;
		if (typeof requestIdleCallback !== 'undefined') {
			this.idleCallbackId = requestIdleCallback(() => {
				this.idleCallbackId = null;
				this.flushLane(PriorityLane.Recalculation);
			});
		} else {
			this.idleCallbackId = setTimeout(() => {
				this.idleCallbackId = null;
				this.flushLane(PriorityLane.Recalculation);
			}, 100);
		}
	}

	private flushLane(lane: PriorityLane): void {
		const updates = this.pendingQueue.get(lane);
		if (!updates || updates.length === 0) return;
		this.pendingQueue.set(lane, []);

		for (let i = 0; i < updates.length; i++) {
			try {
				updates[i]();
			} catch (e) {
				console.error(`GridEngine: Error executing scheduler task in lane ${lane}`, e);
			}
		}
	}

	public flushAllSync(): void {
		if (this.streamTimeout) {
			clearTimeout(this.streamTimeout);
			this.streamTimeout = null;
		}
		if (this.idleCallbackId) {
			if (typeof cancelIdleCallback !== 'undefined') {
				cancelIdleCallback(this.idleCallbackId);
			} else {
				clearTimeout(this.idleCallbackId);
			}
			this.idleCallbackId = null;
		}
		for (const lane of [PriorityLane.Interactive, PriorityLane.Render, PriorityLane.Stream, PriorityLane.Recalculation]) {
			this.flushLane(lane);
		}
	}
}

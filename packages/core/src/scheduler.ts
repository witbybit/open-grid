export enum PriorityLane {
	Interactive = 0, // Immediate execution (e.g. typing, arrow navigation)
	Render = 1, // requestAnimationFrame (e.g. scrolling, layout changes, resizing)
	Stream = 2, // Microtask/delayed execution (e.g. websocket stream updates)
	Recalculation = 3, // Idle callback / deferred execution (e.g. formulas, sorting, filtering)
}

export class TransactionScheduler {
	private pendingQueue = new Map<PriorityLane, Array<() => void>>();
	private frameRequested = false;
	private streamFrameId: any = null;
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
			queueMicrotask(() => {
				this.frameRequested = false;
				this.flushLane(PriorityLane.Render);
			});
		}
	}

	private requestStreamFlush(): void {
		if (this.streamFrameId !== null) return;
		if (typeof requestAnimationFrame !== 'undefined') {
			this.streamFrameId = requestAnimationFrame(() => {
				this.streamFrameId = null;
				this.flushLane(PriorityLane.Stream);
			});
		} else {
			queueMicrotask(() => {
				this.streamFrameId = null;
				this.flushLane(PriorityLane.Stream);
			});
		}
	}

	private requestIdleFlush(): void {
		if (this.idleCallbackId !== null) return;
		if (typeof requestIdleCallback !== 'undefined') {
			this.idleCallbackId = requestIdleCallback(() => {
				this.idleCallbackId = null;
				this.flushLane(PriorityLane.Recalculation);
			});
		} else if (typeof requestAnimationFrame !== 'undefined') {
			this.idleCallbackId = requestAnimationFrame(() => {
				this.idleCallbackId = null;
				this.flushLane(PriorityLane.Recalculation);
			});
		} else {
			queueMicrotask(() => {
				this.idleCallbackId = null;
				this.flushLane(PriorityLane.Recalculation);
			});
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
		if (this.streamFrameId !== null) {
			if (typeof cancelAnimationFrame !== 'undefined') {
				cancelAnimationFrame(this.streamFrameId);
			}
			this.streamFrameId = null;
		}
		if (this.idleCallbackId !== null) {
			if (typeof cancelIdleCallback !== 'undefined') {
				cancelIdleCallback(this.idleCallbackId);
			} else if (typeof cancelAnimationFrame !== 'undefined') {
				cancelAnimationFrame(this.idleCallbackId);
			}
			this.idleCallbackId = null;
		}
		for (const lane of [PriorityLane.Interactive, PriorityLane.Render, PriorityLane.Stream, PriorityLane.Recalculation]) {
			this.flushLane(lane);
		}
	}
}

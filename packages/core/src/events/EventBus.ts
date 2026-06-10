import type { GridEvent, GridEventListener, GridEventPayloadMap } from '../store.js';

export class EventBus<TRowData = unknown> {
	private eventListeners = new Map<string, Set<GridEventListener<unknown>>>();

	public addEventListener<K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	): () => void {
		if (!this.eventListeners.has(type)) {
			this.eventListeners.set(type, new Set());
		}
		const set = this.eventListeners.get(type)!;
		set.add(callback as GridEventListener<unknown>);
		return () => {
			set.delete(callback as GridEventListener<unknown>);
			if (set.size === 0) {
				this.eventListeners.delete(type);
			}
		};
	}

	public dispatchEvent<K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void {
		const set = this.eventListeners.get(type);
		if (set) {
			const event: GridEvent<GridEventPayloadMap<TRowData>[K]> = { type, payload };
			set.forEach((listener) => {
				try {
					listener(event as GridEvent<unknown>);
				} catch (e) {
					console.error(`EventBus: Error in event listener for "${type}"`, e);
				}
			});
		}
	}

	public hasListeners(type: keyof GridEventPayloadMap<TRowData>): boolean {
		return (this.eventListeners.get(type)?.size ?? 0) > 0;
	}

	public clear(): void {
		this.eventListeners.clear();
	}
}

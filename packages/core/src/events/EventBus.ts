import type { GridEvent, GridEventListener } from '../store.js';

export class EventBus {
	private eventListeners = new Map<string, Set<GridEventListener<unknown>>>();

	public addEventListener = <T = unknown>(type: string, callback: GridEventListener<T>): (() => void) => {
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
	};

	public dispatchEvent = <T = unknown>(type: string, payload: T): void => {
		const set = this.eventListeners.get(type);
		if (set) {
			const event: GridEvent<T> = { type, payload };
			set.forEach((listener) => {
				try {
					listener(event);
				} catch (e) {
					console.error(`EventBus: Error in event listener for "${type}"`, e);
				}
			});
		}
	};

	public hasListeners(type: string): boolean {
		return (this.eventListeners.get(type)?.size ?? 0) > 0;
	}

	public clear(): void {
		this.eventListeners.clear();
	}
}

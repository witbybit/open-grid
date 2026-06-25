/**
 * Lightweight pub/sub store for sidebar UI state. Sidebar open/close is pure UI state
 * (no undo, no kernel transaction) so it lives outside the kernel intentionally.
 */
export class SidebarStore {
	private _openPanel: string | null = null;
	private readonly listeners = new Set<() => void>();

	getOpenPanel(): string | null {
		return this._openPanel;
	}

	openPanel(id: string): void {
		if (this._openPanel !== id) {
			this._openPanel = id;
			this.notify();
		}
	}

	closePanel(): void {
		if (this._openPanel !== null) {
			this._openPanel = null;
			this.notify();
		}
	}

	togglePanel(id: string): void {
		this._openPanel = this._openPanel === id ? null : id;
		this.notify();
	}

	subscribe = (fn: () => void): (() => void) => {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	};

	destroy(): void {
		this.listeners.clear();
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}
}

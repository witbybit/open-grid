export interface PortalEntry {
	readonly cellKey: string;
	readonly container: HTMLElement;
	readonly rowId: string | number | null;
	readonly field: string;
	readonly value: unknown;
	readonly row: unknown;
	readonly column: unknown;
	readonly isEditing: boolean;
}

/** Lightweight store for React portals mounted into DomGridRenderer cell slots. */
export class GridPortalStore {
	private readonly entries = new Map<string, PortalEntry>();
	private readonly listeners = new Set<() => void>();
	// Stable snapshot ref — only reallocated when entries change.
	private snapshot: PortalEntry[] = [];

	mount(entry: PortalEntry): void {
		this.entries.set(entry.cellKey, entry);
		this.snapshot = Array.from(this.entries.values());
		this.notify();
	}

	unmount(cellKey: string): void {
		if (this.entries.delete(cellKey)) {
			this.snapshot = Array.from(this.entries.values());
			this.notify();
		}
	}

	/** Stable snapshot for useSyncExternalStore — only a new array reference when entries changed. */
	getEntries = (): PortalEntry[] => this.snapshot;

	subscribe = (fn: () => void): (() => void) => {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	};

	destroy(): void {
		this.entries.clear();
		this.snapshot = [];
		this.listeners.clear();
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}
}

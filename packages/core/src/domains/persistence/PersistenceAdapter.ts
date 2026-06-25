import type { SerializedGridState } from './GridStateSchema.js';

export interface PersistenceAdapter {
	load(): SerializedGridState | null;
	save(state: SerializedGridState): void;
	clear(): void;
}

export function createLocalStorageAdapter(key: string): PersistenceAdapter {
	return {
		load(): SerializedGridState | null {
			try {
				const raw = localStorage.getItem(key);
				if (!raw) return null;
				return JSON.parse(raw) as SerializedGridState;
			} catch {
				return null;
			}
		},
		save(state: SerializedGridState): void {
			try {
				localStorage.setItem(key, JSON.stringify(state));
			} catch {
				// storage quota exceeded — ignore
			}
		},
		clear(): void {
			localStorage.removeItem(key);
		},
	};
}

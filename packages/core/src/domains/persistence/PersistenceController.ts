import type { GridEventListener } from '../../kernel/GridEvent.js';
import type { PersistenceAdapter } from './PersistenceAdapter.js';
import type { GridStateReadPort, GridStateWritePort, SerializedGridState } from './GridStateSchema.js';
import { createGridStateSnapshot, applyGridState, isValidGridState } from './GridStateSchema.js';

export type PersistenceStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Debounced auto-save controller. Subscribes to kernel events for persistence-relevant changes
 * and auto-saves after a configurable debounce window.
 */
export class PersistenceController {
	private autoSave = false;
	private status: PersistenceStatus = 'idle';
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly statusListeners = new Set<() => void>();

	constructor(
		private readonly adapter: PersistenceAdapter,
		private readonly readPort: GridStateReadPort,
		private readonly writePort: GridStateWritePort,
		private readonly debounceMs = 500
	) {}

	/**
	 * Wire to kernel.subscribe(). Returns an unsubscribe function.
	 */
	subscribeToKernel(subscribe: (listener: GridEventListener) => () => void): () => void {
		return subscribe((event) => {
			if (!this.autoSave) return;
			if (event.type === 'rows.replaced' || event.type === 'pipeline.changed' || event.type === 'columns.changed') {
				this.scheduleAutoSave();
			}
		});
	}

	enable(): void {
		this.autoSave = true;
	}

	disable(): void {
		this.autoSave = false;
		this.cancelDebounce();
	}

	isEnabled(): boolean {
		return this.autoSave;
	}

	saveNow(): void {
		this.cancelDebounce();
		this.doSave();
	}

	clearPersistedState(): void {
		this.adapter.clear();
		this.setStatus('idle');
	}

	loadAndApply(): boolean {
		const raw = this.adapter.load();
		if (!raw || !isValidGridState(raw)) return false;
		applyGridState(raw, this.writePort);
		return true;
	}

	getStatus(): PersistenceStatus {
		return this.status;
	}

	subscribeToStatus = (fn: () => void): (() => void) => {
		this.statusListeners.add(fn);
		return () => {
			this.statusListeners.delete(fn);
		};
	};

	getGridState(): SerializedGridState {
		return createGridStateSnapshot(this.readPort);
	}

	applyState(state: SerializedGridState): void {
		applyGridState(state, this.writePort);
	}

	destroy(): void {
		this.cancelDebounce();
		this.statusListeners.clear();
	}

	private scheduleAutoSave(): void {
		this.cancelDebounce();
		this.setStatus('saving');
		this.debounceTimer = setTimeout(() => {
			this.doSave();
		}, this.debounceMs);
	}

	private cancelDebounce(): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private doSave(): void {
		try {
			const snapshot = createGridStateSnapshot(this.readPort);
			this.adapter.save(snapshot);
			this.setStatus('saved');
		} catch {
			this.setStatus('error');
		}
	}

	private setStatus(s: PersistenceStatus): void {
		this.status = s;
		this.statusListeners.forEach((fn) => fn());
	}
}

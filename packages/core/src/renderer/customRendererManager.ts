import type { ColumnDef, RowNode, CellRendererPhase } from '../store.js';
import type { GridCellContentMount, GridCellContentUnmount, RendererLifecycleOperation } from './IGridRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { createEditRendererKey, createSlotRendererKey, createIndexRendererKey } from './identityKeys.js';

export interface RendererInstance<TRowData = unknown> {
	rendererKey: string;
	cellKey: string;
	container: HTMLDivElement;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase: CellRendererPhase;
	isScrolling: boolean;
	isFocused: boolean;
	isSelected: boolean;
	lastAccessTime: number;
}

export interface AcquireRendererParams<TRowData = unknown> {
	rendererKey: string;
	cellKey: string;
	parentContainer: HTMLElement;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase: CellRendererPhase;
	isScrolling: boolean;
	isFocused: boolean;
	isSelected: boolean;
}

export type ReleaseReason = 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated';

export interface CustomRendererStats {
	activeCount: number;
	warmCount: number;
	totalAcquires: number;
	warmHits: number;
	warmMisses: number;
	evictions: number;
	// Phase 7: hydration budget tracking
	hydrationChunks: number;
	maxHydratedInOneChunk: number;
	// Phase 8: warm DOM move tracking
	warmMovesDeferred: number;
	warmMovesFlushed: number;
}

export class CustomRendererManager<TRowData = unknown> {
	public onMountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	public onUnmountCellContent?: (unmount: GridCellContentUnmount) => void;

	private activeRenderersByCellKey = new Map<string, RendererInstance<TRowData>>();
	private activeRenderersByRendererKey = new Map<string, RendererInstance<TRowData>>();
	private activeRendererKeyByParentContainer = new Map<HTMLElement, string>();
	private warmRenderersByRendererKey = new Map<string, RendererInstance<TRowData>>();
	private lruOrder = new Map<string, number>();
	private lruCounter = 0;

	// Limits
	private maxWarm = 50;
	private ttlMs = 30000; // 30s TTL

	// Stats
	private stats: CustomRendererStats = {
		activeCount: 0,
		warmCount: 0,
		totalAcquires: 0,
		warmHits: 0,
		warmMisses: 0,
		evictions: 0,
		hydrationChunks: 0,
		maxHydratedInOneChunk: 0,
		warmMovesDeferred: 0,
		warmMovesFlushed: 0,
	};

	// Phase 8: pending warm DOM moves deferred during scroll
	private pendingWarmMoves: RendererInstance<TRowData>[] = [];

	private hiddenContainer: HTMLDivElement | null = null;

	constructor(private engine?: GridEngine<TRowData>) {}

	private ensureHiddenContainer(): HTMLDivElement | null {
		if (!this.hiddenContainer && typeof document !== 'undefined') {
			this.hiddenContainer = document.createElement('div');
			this.hiddenContainer.className = 'og-hidden-renderer-container';
			this.hiddenContainer.style.display = 'none';
			document.body.appendChild(this.hiddenContainer);
		}
		return this.hiddenContainer;
	}

	public getStats(): CustomRendererStats {
		this.stats.activeCount = this.activeRenderersByRendererKey.size;
		this.stats.warmCount = this.warmRenderersByRendererKey.size;
		return { ...this.stats };
	}

	public resetStats(): void {
		this.stats = {
			activeCount: this.activeRenderersByRendererKey.size,
			warmCount: this.warmRenderersByRendererKey.size,
			totalAcquires: 0,
			warmHits: 0,
			warmMisses: 0,
			evictions: 0,
			hydrationChunks: 0,
			maxHydratedInOneChunk: 0,
			warmMovesDeferred: 0,
			warmMovesFlushed: 0,
		};
	}

	public setLimits(maxWarm: number, ttlMs: number): void {
		this.maxWarm = maxWarm;
		this.ttlMs = ttlMs;
		this.pruneWarmCache();
	}

	public getRendererKey(col: ColumnDef<TRowData>, rowId: string, rowIndex: number, colIndex: number, isEditing: boolean): string {
		if (isEditing) {
			return createEditRendererKey(rowId, col.field);
		}
		const pooledRow = (this.engine as any)?.rowRenderer?.activeRows.get(rowIndex);
		if (pooledRow?.id) {
			return createSlotRendererKey(pooledRow.id, col.field);
		}
		return createIndexRendererKey(rowIndex, colIndex, col.field);
	}

	public acquire(params: AcquireRendererParams<TRowData>): RendererInstance<TRowData> {
		this.stats.totalAcquires++;
		if (params.isScrolling && this.engine) {
			this.engine.customRendererMountsDuringScroll++;
		}
		if (!params.isScrolling && !this.engine?.isScrolling) {
			this.pruneWarmCache();
		}

		// 1. Check if already active
		let instance = this.activeRenderersByRendererKey.get(params.rendererKey);
		if (!instance) {
			const logicalInstance = this.activeRenderersByCellKey.get(params.cellKey);
			if (logicalInstance?.rendererKey === params.rendererKey) {
				instance = logicalInstance;
			}
		}
		if (instance) {
			this.rebindInstance(instance, params, 'update');
			return instance;
		}

		// 2. Check if in warm cache
		instance = this.warmRenderersByRendererKey.get(params.rendererKey);
		if (instance) {
			this.stats.warmHits++;
			if (this.engine) {
				this.engine.customRendererWarmHits++;
			}
			this.warmRenderersByRendererKey.delete(params.rendererKey);
			this.lruOrder.delete(params.rendererKey);
			this.rebindInstance(instance, params, 'restore');
			return instance;
		}

		// 3. Warm Miss: Create a new container element and trigger React portal mount
		this.stats.warmMisses++;
		if (this.engine) {
			this.engine.customRendererWarmMisses++;
		}
		const container = document.createElement('div');
		container.className = 'og-custom-renderer-container';
		container.dataset.rendererKey = params.rendererKey;
		container.dataset.cellKey = params.cellKey;
		params.parentContainer.appendChild(container);

		const newInstance: RendererInstance<TRowData> = {
			rendererKey: params.rendererKey,
			cellKey: params.cellKey,
			container,
			value: params.value,
			node: params.node,
			col: params.col,
			isEditing: params.isEditing,
			isLoading: params.isLoading,
			phase: params.phase,
			isScrolling: params.isScrolling,
			isFocused: params.isFocused,
			isSelected: params.isSelected,
			lastAccessTime: ++this.lruCounter,
		};

		this.removeSiblingContainers(newInstance.rendererKey, params.parentContainer, newInstance.container);
		this.registerActive(newInstance);

		this.onMountCellContent?.({
			cellKey: params.cellKey,
			container,
			value: params.value,
			node: params.node,
			col: params.col,
			isEditing: params.isEditing,
			isLoading: params.isLoading,
			phase: params.phase,
			isScrolling: params.isScrolling,
			isFocused: params.isFocused,
			isSelected: params.isSelected,
			lifecycleOperation: 'mount',
		});

		return newInstance;
	}

	public releaseByCellKey(cellKey: string, reason: ReleaseReason): boolean {
		const instance = this.activeRenderersByCellKey.get(cellKey);
		if (!instance) return false;
		return this.releaseInstance(instance, reason);
	}

	public releaseByParentContainer(parentContainer: HTMLElement, reason: ReleaseReason): boolean {
		const rendererKey = this.activeRendererKeyByParentContainer.get(parentContainer);
		if (!rendererKey) return false;
		const instance = this.activeRenderersByRendererKey.get(rendererKey);
		if (!instance) {
			this.activeRendererKeyByParentContainer.delete(parentContainer);
			return false;
		}
		return this.releaseInstance(instance, reason);
	}

	private releaseInstance(instance: RendererInstance<TRowData>, reason: ReleaseReason): boolean {
		this.unregisterActive(instance);

		// If reason is scrolled-out, cache it in warm cache instead of destroying
		if (reason === 'scrolled-out' && this.maxWarm > 0) {
			instance.lastAccessTime = ++this.lruCounter;
			this.touchWarm(instance);

			// Phase 8: always move to hiddenContainer immediately (display:none, no layout cost)
			// so the container stays connected and pool cells are clean.
			// Defer only pruneWarmCache until after scroll to avoid DOM destruction churn.
			const hiddenContainer = this.ensureHiddenContainer();
			if (hiddenContainer && instance.container.parentElement !== hiddenContainer) {
				hiddenContainer.appendChild(instance.container);
			}
			if (this.engine?.isScrolling) {
				// Track deferred prune for stats; actual prune runs in flushPendingWarmMoves
				this.pendingWarmMoves.push(instance);
				this.stats.warmMovesDeferred++;
			} else {
				this.pruneWarmCache();
			}
			return true;
		}

		// Otherwise, destroy immediately
		this.destroyInstance(instance);
		return true;
	}

	/**
	 * Phase 8: Flush deferred warm DOM moves in budgeted chunks after scroll idle.
	 * Returns the number of moves performed.
	 */
	public flushPendingWarmMoves(maxItems = 16): number {
		if (this.pendingWarmMoves.length === 0) return 0;
		const hiddenContainer = this.ensureHiddenContainer();
		if (!hiddenContainer) {
			this.pendingWarmMoves.length = 0;
			return 0;
		}
		const count = Math.min(maxItems, this.pendingWarmMoves.length);
		let moved = 0;
		for (let i = 0; i < count; i++) {
			const inst = this.pendingWarmMoves.shift()!;
			// Only move if still in warm cache (not re-acquired between scroll and flush)
			if (this.warmRenderersByRendererKey.has(inst.rendererKey)) {
				if (inst.container.parentElement !== hiddenContainer) {
					hiddenContainer.appendChild(inst.container);
					moved++;
				}
			}
		}
		this.stats.warmMovesFlushed += moved;
		if (!this.engine?.isScrolling) {
			this.pruneWarmCache();
		}
		return moved;
	}

	/**
	 * Phase 7: Flush hydration budget for CustomRendererManager-owned warm moves.
	 * Stats tracking for hydration chunks and max hydrated per frame.
	 */
	public flushHydrationBudget(options: { maxItems?: number } = {}): { warmMovesFlushed: number } {
		const maxItems = options.maxItems ?? 16;
		const moved = this.flushPendingWarmMoves(maxItems);
		if (moved > 0) {
			this.stats.hydrationChunks++;
			this.stats.maxHydratedInOneChunk = Math.max(this.stats.maxHydratedInOneChunk, moved);
		}
		return { warmMovesFlushed: moved };
	}

	public hasActiveRenderer(cellKey: string): boolean {
		return this.activeRenderersByCellKey.has(cellKey);
	}

	public releaseAll(): void {
		this.pendingWarmMoves.length = 0;
		for (const instance of this.activeRenderersByRendererKey.values()) {
			this.destroyInstance(instance);
		}
		this.activeRenderersByCellKey.clear();
		this.activeRenderersByRendererKey.clear();
		this.activeRendererKeyByParentContainer.clear();

		for (const instance of this.warmRenderersByRendererKey.values()) {
			this.destroyInstance(instance);
		}
		this.warmRenderersByRendererKey.clear();
		this.lruOrder.clear();
		this.lruCounter = 0;
		this.hiddenContainer?.remove();
		this.hiddenContainer = null;
	}

	private registerActive(instance: RendererInstance<TRowData>): void {
		this.activeRenderersByCellKey.set(instance.cellKey, instance);
		this.activeRenderersByRendererKey.set(instance.rendererKey, instance);
		const parent = instance.container.parentElement;
		if (parent) {
			this.activeRendererKeyByParentContainer.set(parent, instance.rendererKey);
		}
	}

	private unregisterActive(instance: RendererInstance<TRowData>): void {
		this.activeRenderersByCellKey.delete(instance.cellKey);
		this.activeRenderersByRendererKey.delete(instance.rendererKey);
		const parent = instance.container.parentElement;
		if (parent && this.activeRendererKeyByParentContainer.get(parent) === instance.rendererKey) {
			this.activeRendererKeyByParentContainer.delete(parent);
		}
	}

	private rebindInstance(
		instance: RendererInstance<TRowData>,
		params: AcquireRendererParams<TRowData>,
		operation: RendererLifecycleOperation = 'update'
	): void {
		// Detect whether any props the renderer cares about actually changed before
		// notifying React — avoids a reconciliation round trip on stayed cells.
		const needsUpdate =
			instance.value !== params.value ||
			instance.node !== params.node ||
			instance.col !== params.col ||
			instance.isEditing !== params.isEditing ||
			instance.isLoading !== params.isLoading ||
			instance.isFocused !== params.isFocused ||
			instance.isSelected !== params.isSelected ||
			instance.phase !== params.phase ||
			instance.isScrolling !== params.isScrolling ||
			instance.rendererKey !== params.rendererKey ||
			instance.cellKey !== params.cellKey;

		this.unregisterActive(instance);
		instance.rendererKey = params.rendererKey;
		instance.cellKey = params.cellKey;
		instance.value = params.value;
		instance.node = params.node;
		instance.col = params.col;
		instance.isEditing = params.isEditing;
		instance.isLoading = params.isLoading;
		instance.phase = params.phase;
		instance.isScrolling = params.isScrolling;
		instance.isFocused = params.isFocused;
		instance.isSelected = params.isSelected;
		instance.lastAccessTime = Date.now();
		instance.container.dataset.rendererKey = params.rendererKey;
		instance.container.dataset.cellKey = params.cellKey;

		if (instance.container.parentElement !== params.parentContainer) {
			params.parentContainer.appendChild(instance.container);
		}
		this.removeSiblingContainers(instance.rendererKey, params.parentContainer, instance.container);
		this.registerActive(instance);

		if (needsUpdate) {
			this.onMountCellContent?.({
				cellKey: params.cellKey,
				container: instance.container,
				value: params.value,
				node: params.node,
				col: params.col,
				isEditing: params.isEditing,
				isLoading: params.isLoading,
				phase: params.phase,
				isScrolling: params.isScrolling,
				isFocused: params.isFocused,
				isSelected: params.isSelected,
				lifecycleOperation: operation,
			});
		}
	}

	private removeSiblingContainers(rendererKey: string, parentContainer: HTMLElement, activeContainer: HTMLElement): void {
		const previousRendererKey = this.activeRendererKeyByParentContainer.get(parentContainer);
		if (previousRendererKey && previousRendererKey !== rendererKey) {
			const previousInstance = this.activeRenderersByRendererKey.get(previousRendererKey);
			if (previousInstance) {
				this.unregisterActive(previousInstance);
				this.destroyInstance(previousInstance);
			}
		}
		this.activeRendererKeyByParentContainer.set(parentContainer, rendererKey);

		const children = parentContainer.children;
		for (let i = children.length - 1; i >= 0; i--) {
			const child = children[i];
			if (child !== activeContainer && child.classList.contains('og-custom-renderer-container')) {
				child.remove();
			}
		}
	}

	private touchWarm(instance: RendererInstance<TRowData>): void {
		this.warmRenderersByRendererKey.set(instance.rendererKey, instance);
		this.lruOrder.set(instance.rendererKey, this.lruCounter++);
	}

	private destroyInstance(instance: RendererInstance<TRowData>): void {
		const activeInstance = this.activeRenderersByCellKey.get(instance.cellKey);
		if (activeInstance === undefined || activeInstance === instance) {
			this.onUnmountCellContent?.({
				cellKey: instance.cellKey,
				container: instance.container,
				flushSync: false,
			});
		}
		delete instance.container.dataset.rendererKey;
		delete instance.container.dataset.cellKey;
		instance.container.remove();
	}

	private pruneWarmCache(): void {
		// 1. Prune by size limit
		while (this.warmRenderersByRendererKey.size > this.maxWarm && this.lruOrder.size > 0) {
			let oldestKey: string | null = null;
			let minVal = Infinity;
			for (const [key, val] of this.lruOrder.entries()) {
				if (val < minVal) {
					minVal = val;
					oldestKey = key;
				}
			}
			if (oldestKey) {
				const instance = this.warmRenderersByRendererKey.get(oldestKey);
				this.lruOrder.delete(oldestKey);
				if (instance) {
					this.warmRenderersByRendererKey.delete(oldestKey);
					this.stats.evictions++;
					this.destroyInstance(instance);
				}
			} else {
				break;
			}
		}

		// 2. Prune by access count gap (TTL equivalent: if not accessed in last maxWarm*2 acquires, evict)
		const staleThreshold = this.lruCounter - this.maxWarm * 2;
		for (const [key, instance] of this.warmRenderersByRendererKey.entries()) {
			if (instance.lastAccessTime < staleThreshold) {
				this.warmRenderersByRendererKey.delete(key);
				this.lruOrder.delete(key);
				this.stats.evictions++;
				this.destroyInstance(instance);
			}
		}
	}
}

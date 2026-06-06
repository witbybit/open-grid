import type { ColumnDef, RowNode, CellRendererPhase } from '../store.js';
import type { GridCellContentMount, GridCellContentUnmount } from './IGridRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';

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
}

export class CustomRendererManager<TRowData = unknown> {
	public onMountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	public onUnmountCellContent?: (unmount: GridCellContentUnmount) => void;

	private activeRenderersByCellKey = new Map<string, RendererInstance<TRowData>>();
	private activeRenderersByRendererKey = new Map<string, RendererInstance<TRowData>>();
	private activeRendererKeyByParentContainer = new Map<HTMLElement, string>();
	private warmRenderersByRendererKey = new Map<string, RendererInstance<TRowData>>();
	private lruList: string[] = []; // rendererKeys in LRU order (oldest first)

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
	};

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
		};
	}

	public setLimits(maxWarm: number, ttlMs: number): void {
		this.maxWarm = maxWarm;
		this.ttlMs = ttlMs;
		this.pruneWarmCache();
	}

	public getRendererKey(col: ColumnDef<TRowData>, rowId: string, rowIndex: number, colIndex: number, isEditing: boolean): string {
		if (isEditing) {
			return `${rowId}:${col.field}`;
		}
		const pooledRow = (this.engine as any)?.rowRenderer?.activeRows.get(rowIndex);
		if (pooledRow?.id) {
			return `${col.field}@${pooledRow.id}`;
		}
		return `${col.field}@${rowIndex}:${colIndex}`;
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
		let instance = this.activeRenderersByRendererKey.get(params.rendererKey) ?? this.activeRenderersByCellKey.get(params.cellKey);
		if (instance) {
			this.rebindInstance(instance, params);
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
			this.lruList = this.lruList.filter((key) => key !== params.rendererKey);
			this.rebindInstance(instance, params);
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
			lastAccessTime: Date.now(),
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
			// Move container to hidden host
			const hiddenContainer = this.ensureHiddenContainer();
			if (hiddenContainer && instance.container.parentElement !== hiddenContainer) {
				hiddenContainer.appendChild(instance.container);
			}

			instance.lastAccessTime = Date.now();
			this.touchWarm(instance);

			if (!this.engine?.isScrolling) {
				this.pruneWarmCache();
			}
			return true;
		}

		// Otherwise, destroy immediately
		this.destroyInstance(instance);
		return true;
	}

	public hasActiveRenderer(cellKey: string): boolean {
		return this.activeRenderersByCellKey.has(cellKey);
	}

	public releaseAll(): void {
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
		this.lruList = [];
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

	private rebindInstance(instance: RendererInstance<TRowData>, params: AcquireRendererParams<TRowData>): void {
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
		});
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

		for (const child of Array.from(parentContainer.children)) {
			if (child !== activeContainer && child.classList.contains('og-custom-renderer-container')) {
				child.remove();
			}
		}
	}

	private touchWarm(instance: RendererInstance<TRowData>): void {
		this.warmRenderersByRendererKey.set(instance.rendererKey, instance);
		this.lruList = this.lruList.filter((key) => key !== instance.rendererKey);
		this.lruList.push(instance.rendererKey);
	}

	private destroyInstance(instance: RendererInstance<TRowData>): void {
		this.onUnmountCellContent?.({
			cellKey: instance.cellKey,
			container: instance.container,
			flushSync: false,
		});
		delete instance.container.dataset.rendererKey;
		delete instance.container.dataset.cellKey;
		instance.container.remove();
	}

	private pruneWarmCache(): void {
		// 1. Prune by size limit
		while (this.warmRenderersByRendererKey.size > this.maxWarm && this.lruList.length > 0) {
			const oldestKey = this.lruList.shift()!;
			const instance = this.warmRenderersByRendererKey.get(oldestKey);
			if (instance) {
				this.warmRenderersByRendererKey.delete(oldestKey);
				this.stats.evictions++;
				this.destroyInstance(instance);
			}
		}

		// 2. Prune by TTL
		const now = Date.now();
		for (const [key, instance] of Array.from(this.warmRenderersByRendererKey.entries())) {
			if (now - instance.lastAccessTime > this.ttlMs) {
				this.warmRenderersByRendererKey.delete(key);
				this.lruList = this.lruList.filter((k) => k !== key);
				this.stats.evictions++;
				this.destroyInstance(instance);
			}
		}
	}
}

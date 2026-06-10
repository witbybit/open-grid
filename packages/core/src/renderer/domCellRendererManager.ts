import type { ColumnDef, RowNode, CellRendererPhase, DomCellRenderer, DomCellRendererHandle } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';

interface DomRendererInstance<TRowData = unknown> {
	rendererKey: string;
	cellKey: string;
	container: HTMLDivElement;
	handle: DomCellRendererHandle;
	renderer: DomCellRenderer<TRowData>;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	phase: CellRendererPhase;
	isScrolling: boolean;
	isFocused: boolean;
	isSelected: boolean;
	lastAccessTime: number;
}

export interface AcquireDomRendererParams<TRowData = unknown> {
	rendererKey: string;
	cellKey: string;
	parentContainer: HTMLElement;
	renderer: DomCellRenderer<TRowData>;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	phase: CellRendererPhase;
	isScrolling: boolean;
	isFocused: boolean;
	isSelected: boolean;
}

export type DomReleaseReason = 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated';

export class DomCellRendererManager<TRowData = unknown> {
	private activeByKey = new Map<string, DomRendererInstance<TRowData>>();
	private activeByCellKey = new Map<string, DomRendererInstance<TRowData>>();
	private activeKeyByParent = new Map<HTMLElement, string>();
	private warmByKey = new Map<string, DomRendererInstance<TRowData>>();
	private lruOrder = new Map<string, number>();
	private lruCounter = 0;

	private maxWarm = 50;
	private hiddenContainer: HTMLDivElement | null = null;

	constructor(private engine?: GridEngine<TRowData>) {}

	private ensureHiddenContainer(): HTMLDivElement | null {
		if (!this.hiddenContainer && typeof document !== 'undefined') {
			this.hiddenContainer = document.createElement('div');
			this.hiddenContainer.className = 'og-hidden-dom-renderer-container';
			this.hiddenContainer.style.display = 'none';
			document.body.appendChild(this.hiddenContainer);
		}
		return this.hiddenContainer;
	}

	public acquire(params: AcquireDomRendererParams<TRowData>): void {
		// 1. Already active — just update
		let instance = this.activeByKey.get(params.rendererKey) ?? this.activeByCellKey.get(params.cellKey);
		if (instance) {
			this.rebindInstance(instance, params);
			return;
		}

		// 2. Warm cache hit — move back to active, update
		instance = this.warmByKey.get(params.rendererKey);
		if (instance) {
			this.warmByKey.delete(params.rendererKey);
			this.lruOrder.delete(params.rendererKey);
			this.rebindInstance(instance, params);
			return;
		}

		// 3. Cold mount — create container, call renderer.mount()
		const container = document.createElement('div');
		container.className = 'og-dom-renderer-container';
		container.dataset.rendererKey = params.rendererKey;
		container.dataset.cellKey = params.cellKey;
		params.parentContainer.appendChild(container);

		const mountParams = {
			container,
			value: params.value,
			node: params.node,
			col: params.col,
			isEditing: params.isEditing,
			isScrolling: params.isScrolling,
			phase: params.phase,
			isFocused: params.isFocused,
			isSelected: params.isSelected,
		};

		const handle = params.renderer.mount(container, mountParams);

		const newInstance: DomRendererInstance<TRowData> = {
			rendererKey: params.rendererKey,
			cellKey: params.cellKey,
			container,
			handle,
			renderer: params.renderer,
			value: params.value,
			node: params.node,
			col: params.col,
			isEditing: params.isEditing,
			phase: params.phase,
			isScrolling: params.isScrolling,
			isFocused: params.isFocused,
			isSelected: params.isSelected,
			lastAccessTime: ++this.lruCounter,
		};

		this.removeSiblingContainers(params.rendererKey, params.parentContainer, container);
		this.registerActive(newInstance);
	}

	public releaseByCellKey(cellKey: string, reason: DomReleaseReason): boolean {
		const instance = this.activeByCellKey.get(cellKey);
		if (!instance) return false;
		this.releaseInstance(instance, reason);
		return true;
	}

	public releaseByParentContainer(parentContainer: HTMLElement, reason: DomReleaseReason): boolean {
		const rendererKey = this.activeKeyByParent.get(parentContainer);
		if (!rendererKey) return false;
		const instance = this.activeByKey.get(rendererKey);
		if (!instance) {
			this.activeKeyByParent.delete(parentContainer);
			return false;
		}
		this.releaseInstance(instance, reason);
		return true;
	}

	public hasActiveDomRenderer(cellKey: string): boolean {
		return this.activeByCellKey.has(cellKey);
	}

	public releaseAll(): void {
		for (const instance of this.activeByKey.values()) this.destroyInstance(instance);
		this.activeByKey.clear();
		this.activeByCellKey.clear();
		this.activeKeyByParent.clear();
		for (const instance of this.warmByKey.values()) this.destroyInstance(instance);
		this.warmByKey.clear();
		this.lruOrder.clear();
		this.lruCounter = 0;
		this.hiddenContainer?.remove();
		this.hiddenContainer = null;
	}

	private releaseInstance(instance: DomRendererInstance<TRowData>, reason: DomReleaseReason): void {
		this.unregisterActive(instance);

		if (reason === 'scrolled-out' && this.maxWarm > 0) {
			const hidden = this.ensureHiddenContainer();
			if (hidden && instance.container.parentElement !== hidden) {
				hidden.appendChild(instance.container);
			}
			instance.lastAccessTime = ++this.lruCounter;
			this.warmByKey.set(instance.rendererKey, instance);
			this.lruOrder.set(instance.rendererKey, this.lruCounter);
			if (!this.engine?.isScrolling) this.pruneWarmCache();
			return;
		}

		this.destroyInstance(instance);
	}

	private rebindInstance(instance: DomRendererInstance<TRowData>, params: AcquireDomRendererParams<TRowData>): void {
		const needsUpdate =
			instance.value !== params.value ||
			instance.node !== params.node ||
			instance.col !== params.col ||
			instance.isEditing !== params.isEditing ||
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
		instance.phase = params.phase;
		instance.isScrolling = params.isScrolling;
		instance.isFocused = params.isFocused;
		instance.isSelected = params.isSelected;
		instance.lastAccessTime = ++this.lruCounter;
		instance.container.dataset.rendererKey = params.rendererKey;
		instance.container.dataset.cellKey = params.cellKey;

		if (instance.container.parentElement !== params.parentContainer) {
			params.parentContainer.appendChild(instance.container);
		}
		this.removeSiblingContainers(instance.rendererKey, params.parentContainer, instance.container);
		this.registerActive(instance);

		if (needsUpdate) {
			// Direct DOM call — zero React overhead
			instance.handle.update({
				container: instance.container,
				value: params.value,
				node: params.node,
				col: params.col,
				isEditing: params.isEditing,
				isScrolling: params.isScrolling,
				phase: params.phase,
				isFocused: params.isFocused,
				isSelected: params.isSelected,
			});
		}
	}

	private registerActive(instance: DomRendererInstance<TRowData>): void {
		this.activeByKey.set(instance.rendererKey, instance);
		this.activeByCellKey.set(instance.cellKey, instance);
		const parent = instance.container.parentElement;
		if (parent) this.activeKeyByParent.set(parent, instance.rendererKey);
	}

	private unregisterActive(instance: DomRendererInstance<TRowData>): void {
		this.activeByKey.delete(instance.rendererKey);
		this.activeByCellKey.delete(instance.cellKey);
		const parent = instance.container.parentElement;
		if (parent && this.activeKeyByParent.get(parent) === instance.rendererKey) {
			this.activeKeyByParent.delete(parent);
		}
	}

	private destroyInstance(instance: DomRendererInstance<TRowData>): void {
		try {
			instance.handle.destroy?.();
		} catch {}
		delete instance.container.dataset.rendererKey;
		delete instance.container.dataset.cellKey;
		instance.container.remove();
	}

	private removeSiblingContainers(rendererKey: string, parentContainer: HTMLElement, activeContainer: HTMLElement): void {
		const previousKey = this.activeKeyByParent.get(parentContainer);
		if (previousKey && previousKey !== rendererKey) {
			const prev = this.activeByKey.get(previousKey);
			if (prev) {
				this.unregisterActive(prev);
				this.destroyInstance(prev);
			}
		}
		this.activeKeyByParent.set(parentContainer, rendererKey);

		const children = parentContainer.children;
		for (let i = children.length - 1; i >= 0; i--) {
			const child = children[i];
			if (child !== activeContainer && child.classList.contains('og-dom-renderer-container')) {
				child.remove();
			}
		}
	}

	private pruneWarmCache(): void {
		while (this.warmByKey.size > this.maxWarm && this.lruOrder.size > 0) {
			let oldest: string | null = null;
			let minVal = Infinity;
			for (const [key, val] of this.lruOrder) {
				if (val < minVal) {
					minVal = val;
					oldest = key;
				}
			}
			if (oldest) {
				const inst = this.warmByKey.get(oldest);
				this.lruOrder.delete(oldest);
				if (inst) {
					this.warmByKey.delete(oldest);
					this.destroyInstance(inst);
				}
			} else break;
		}

		const staleThreshold = this.lruCounter - this.maxWarm * 2;
		for (const [key, inst] of this.warmByKey) {
			if (inst.lastAccessTime < staleThreshold) {
				this.warmByKey.delete(key);
				this.lruOrder.delete(key);
				this.destroyInstance(inst);
			}
		}
	}
}

/**
 * DOMPool — Generic DOM node pool with acquire/release semantics.
 *
 * Inspired by game engine object pools. Nodes are never garbage
 * collected during normal operation. They are created once and
 * recycled indefinitely.
 *
 * Sizing:
 * - Initial capacity = estimated visible count + buffer
 * - Auto-grows on demand
 * - Excess nodes kept hidden in a document fragment (off-DOM)
 */
export class DOMPool<T extends HTMLElement> {
	private available: T[] = [];
	private factory: () => T;
	private totalCreated = 0;
	private hotReleaseCount = 0;
	private coldReleaseCount = 0;

	constructor(factory: () => T, initialCapacity: number = 50) {
		this.factory = factory;

		// Pre-warm the pool
		for (let i = 0; i < initialCapacity; i++) {
			const node = this.factory();
			this.available.push(node);
			this.totalCreated++;
		}
	}

	/**
	 * Acquire a node from the pool.
	 * Returns a recycled node if available, or creates a new one.
	 */
	public acquire(): T {
		if (this.available.length > 0) {
			return this.available.pop()!;
		}
		// Pool exhausted — grow
		const node = this.factory();
		this.totalCreated++;
		return node;
	}

	/**
	 * Release a node back to the pool.
	 * Resets properties to avoid memory leaks or layout pollution.
	 */
	public release(node: T): void {
		this.releaseCold(node);
	}

	/**
	 * Hot release is used during scroll recycling. It only detaches and stores
	 * the node; the next bind overwrites the hot properties it needs.
	 */
	public releaseHot(node: T): void {
		this.available.push(node);
		this.hotReleaseCount++;
	}

	/**
	 * Cold release is used for teardown and non-scroll cleanup where full DOM
	 * sanitization is worth the cost.
	 */
	public releaseCold(node: T): void {
		node.textContent = '';
		node.className = '';

		// Clear inline styles cleanly
		node.removeAttribute('style');

		// Clear datasets
		if (node.dataset) {
			for (const key in node.dataset) {
				delete node.dataset[key];
			}
		}

		this.available.push(node);
		this.coldReleaseCount++;
	}

	/** Current pool size (available nodes) */
	public get availableCount(): number {
		return this.available.length;
	}

	/** Total nodes ever created */
	public get totalCount(): number {
		return this.totalCreated;
	}

	public get hotReleases(): number {
		return this.hotReleaseCount;
	}

	public get coldReleases(): number {
		return this.coldReleaseCount;
	}

	public resetStats(): void {
		this.hotReleaseCount = 0;
		this.coldReleaseCount = 0;
	}

	/** Clear the pool and release references */
	public clear(): void {
		this.available.length = 0;
	}
}

/**
 * PooledRow represents a recycled row container with its cell slots.
 */
export interface PooledRow {
	element: HTMLDivElement;
	leftElement?: HTMLDivElement;
	rightElement?: HTMLDivElement;
	cells: Map<number, HTMLDivElement>; // Map of active cells by column index
	boundRowId: string;
}

import type { GridEngine } from '../engine/GridEngine.js';

/**
 * ScrollEngine coordinates passive scroll events from the DOM scroll viewport,
 * tracks scrolling velocity, and maps natural scroll positions to virtual coordinate offsets.
 *
 * Performance guarantees:
 * - Event listeners bound passively to prevent main-thread scrolling jank
 * - High-resolution timing used for velocity calculations
 * - Zero allocations on scroll event hot path
 */
export class ScrollEngine<TRowData = unknown> {
	private engine: GridEngine<TRowData>;
	private scrollContainer: HTMLElement | null = null;
	private onScrollCallback: ((scrollTop: number, scrollLeft: number) => void) | null = null;

	// High-resolution velocity tracking state
	private lastScrollTop = 0;
	private lastScrollLeft = 0;
	private lastTimestamp = 0;
	private velocityY = 0; // px/ms
	private velocityX = 0; // px/ms

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
	}

	/**
	 * Bind the scroll engine to the scrollable viewport container.
	 */
	public bind(scrollContainer: HTMLElement, onScroll: (scrollTop: number, scrollLeft: number) => void): void {
		this.unbind();
		this.scrollContainer = scrollContainer;
		this.onScrollCallback = onScroll;

		this.lastScrollTop = scrollContainer.scrollTop;
		this.lastScrollLeft = scrollContainer.scrollLeft;
		this.lastTimestamp = performance.now();
		this.velocityY = 0;
		this.velocityX = 0;

		// Standard passive listener to avoid blocking main thread compositor scrolls
		scrollContainer.addEventListener('scroll', this.handleScroll, { passive: true });
	}

	/**
	 * Unbind event listeners and release references.
	 */
	public unbind(): void {
		if (this.scrollContainer) {
			this.scrollContainer.removeEventListener('scroll', this.handleScroll);
			this.scrollContainer = null;
		}
		this.onScrollCallback = null;
	}

	/**
	 * Active scroll handler - runs inside browser compositor lane, keeps allocations strictly at zero.
	 */
	private handleScroll = (): void => {
		if (!this.scrollContainer || !this.onScrollCallback) return;

		const scrollTop = this.scrollContainer.scrollTop;
		const scrollLeft = this.scrollContainer.scrollLeft;
		const now = performance.now();
		const timeDelta = now - this.lastTimestamp;

		if (timeDelta > 0) {
			this.velocityY = (scrollTop - this.lastScrollTop) / timeDelta;
			this.velocityX = (scrollLeft - this.lastScrollLeft) / timeDelta;
		} else {
			this.velocityY = 0;
			this.velocityX = 0;
		}

		this.lastScrollTop = scrollTop;
		this.lastScrollLeft = scrollLeft;
		this.lastTimestamp = now;

		// Delegate callback (which will update ViewportModel and trigger transforms)
		this.onScrollCallback(scrollTop, scrollLeft);
	};

	/**
	 * Retrieve calculated real-time scroll velocity.
	 */
	public getVelocity(): { vx: number; vy: number } {
		return { vx: this.velocityX, vy: this.velocityY };
	}

	/**
	 * Programmatically update scroll offsets.
	 */
	public scrollTo(scrollTop: number, scrollLeft: number): void {
		if (this.scrollContainer) {
			this.scrollContainer.scrollTop = scrollTop;
			this.scrollContainer.scrollLeft = scrollLeft;

			// Sync tracking immediately to prevent jump-back on subsequent scroll events
			this.lastScrollTop = scrollTop;
			this.lastScrollLeft = scrollLeft;
			this.lastTimestamp = performance.now();
			this.velocityY = 0;
			this.velocityX = 0;
		}
	}
}

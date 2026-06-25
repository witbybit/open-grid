/**
 * ScrollEngine coordinates passive scroll events from the DOM scroll viewport,
 * tracks scrolling velocity, and exposes a unified ScrollState.
 *
 * Performance guarantees:
 * - Event listeners bound passively to prevent main-thread scrolling jank
 * - High-resolution timing used for velocity calculations
 * - Zero allocations on scroll event hot path (single mutable state object)
 */

export interface ScrollState {
	scrollTop: number;
	scrollLeft: number;
	velocityY: number; // px/ms
	velocityX: number; // px/ms
	isScrolling: boolean;
}

export interface ScrollEngineOptions {
	onScroll: (state: ScrollState) => void;
	onScrollEnd: (state: ScrollState) => void;
	/** Debounce delay in ms for fallback scroll-end detection. Default: 50 */
	scrollEndDebounceMs?: number;
}

export class ScrollEngine {
	private element: HTMLElement;
	private options: ScrollEngineOptions;
	private scrollEndDebounceMs: number;

	// Single mutable state object — never replaced, only mutated in-place.
	private state: ScrollState = {
		scrollTop: 0,
		scrollLeft: 0,
		velocityY: 0,
		velocityX: 0,
		isScrolling: false,
	};

	// Velocity tracking — not part of public state to avoid aliasing issues.
	private lastScrollTop = 0;
	private lastScrollLeft = 0;
	private lastTimestamp = 0;

	private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
	// Feature-detected once in constructor — per-event `in` checks show up in profiles.
	private supportsScrollEnd = false;

	constructor(element: HTMLElement, options: ScrollEngineOptions) {
		this.element = element;
		this.options = options;
		this.scrollEndDebounceMs = options.scrollEndDebounceMs ?? 50;

		// Seed tracking state from element's current position.
		this.lastScrollTop = element.scrollTop;
		this.lastScrollLeft = element.scrollLeft;
		this.lastTimestamp = performance.now();

		this.state.scrollTop = element.scrollTop;
		this.state.scrollLeft = element.scrollLeft;

		// Feature-detect native scrollend once.
		this.supportsScrollEnd = typeof window !== 'undefined' && ('onscrollend' in window || 'onscrollend' in HTMLElement.prototype);

		element.addEventListener('scroll', this.handleScroll, { passive: true });

		if (this.supportsScrollEnd) {
			element.addEventListener('scrollend', this.handleScrollEnd);
		}
	}

	/**
	 * Return the current scroll state.
	 * Callers must not mutate the returned object.
	 */
	public getState(): ScrollState {
		return this.state;
	}

	/**
	 * Programmatically scroll the element and synchronise tracking state to prevent
	 * a velocity spike on the next scroll event.
	 */
	public scrollTo(top: number, left: number): void {
		this.element.scrollTop = top;
		this.element.scrollLeft = left;

		this.lastScrollTop = top;
		this.lastScrollLeft = left;
		this.lastTimestamp = performance.now();

		this.state.scrollTop = top;
		this.state.scrollLeft = left;
		this.state.velocityY = 0;
		this.state.velocityX = 0;
	}

	/**
	 * Tear down all event listeners and timers.
	 */
	public destroy(): void {
		if (this.scrollEndTimer !== null) {
			clearTimeout(this.scrollEndTimer);
			this.scrollEndTimer = null;
		}
		this.element.removeEventListener('scroll', this.handleScroll);
		this.element.removeEventListener('scrollend', this.handleScrollEnd);
	}

	// Arrow functions so they can be passed directly as event listeners without wrapping.

	private handleScroll = (): void => {
		const scrollTop = this.element.scrollTop;
		const scrollLeft = this.element.scrollLeft;
		const now = performance.now();
		const timeDelta = now - this.lastTimestamp;

		if (timeDelta > 0) {
			this.state.velocityY = (scrollTop - this.lastScrollTop) / timeDelta;
			this.state.velocityX = (scrollLeft - this.lastScrollLeft) / timeDelta;
		} else {
			this.state.velocityY = 0;
			this.state.velocityX = 0;
		}

		this.lastScrollTop = scrollTop;
		this.lastScrollLeft = scrollLeft;
		this.lastTimestamp = now;

		this.state.scrollTop = scrollTop;
		this.state.scrollLeft = scrollLeft;
		this.state.isScrolling = true;

		// Fallback scroll-stop detection for browsers without native 'scrollend'.
		if (!this.supportsScrollEnd) {
			if (this.scrollEndTimer !== null) {
				clearTimeout(this.scrollEndTimer);
			}
			this.scrollEndTimer = setTimeout(this.handleScrollEnd, this.scrollEndDebounceMs);
		}

		this.options.onScroll(this.state);
	};

	private handleScrollEnd = (): void => {
		if (this.scrollEndTimer !== null) {
			clearTimeout(this.scrollEndTimer);
			this.scrollEndTimer = null;
		}

		this.state.velocityY = 0;
		this.state.velocityX = 0;
		this.state.isScrolling = false;

		// Sync position in case the element settled somewhere between the last scroll
		// event and the scrollend notification.
		this.state.scrollTop = this.element.scrollTop;
		this.state.scrollLeft = this.element.scrollLeft;

		this.lastScrollTop = this.state.scrollTop;
		this.lastScrollLeft = this.state.scrollLeft;
		this.lastTimestamp = performance.now();

		this.options.onScrollEnd(this.state);
	};
}

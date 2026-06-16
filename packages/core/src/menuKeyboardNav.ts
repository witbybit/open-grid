/**
 * Keyboard navigation for the grid's popup menus (Plan 046 follow-up).
 *
 * `attachRovingMenuKeyboard` implements the ARIA vertical-menu keyboard pattern over a
 * static list of item elements: Arrow Up/Down move (and wrap), Home/End jump to the
 * ends, Enter/Space activate, Escape (and Tab) close. It uses roving focus — the active
 * item is the only one with `tabIndex = 0` and receives DOM focus — so Enter/Space land
 * naturally and screen readers track the selection.
 *
 * It is intentionally framework-free and side-effect-scoped: it mutates only the passed
 * items' `tabIndex`/active class and returns a cleanup function that removes its single
 * listener. Callers own element creation, the active-class CSS, and what "activate" does.
 */
export interface RovingMenuKeyboardOptions {
	/** The menu container; receives the keydown listener and is made programmatically focusable. */
	container: HTMLElement;
	/** Enabled, activatable item elements in visual order. Dividers/disabled items must be excluded. */
	items: HTMLElement[];
	/** Class toggled on the currently-active item (presentational only). */
	activeClass: string;
	/** Invoked on Enter/Space for the active item. */
	onActivate: (item: HTMLElement, index: number) => void;
	/** Invoked on Escape / Tab — caller closes the menu. */
	onClose: () => void;
	/** Focus the first item on attach (default true). */
	autoFocusFirst?: boolean;
}

export function attachRovingMenuKeyboard(options: RovingMenuKeyboardOptions): () => void {
	const { container, items, activeClass, onActivate, onClose } = options;
	let activeIndex = -1;

	const setActive = (index: number, focus = true): void => {
		if (items.length === 0) return;
		const next = ((index % items.length) + items.length) % items.length;
		if (activeIndex >= 0 && items[activeIndex]) {
			items[activeIndex].classList.remove(activeClass);
			items[activeIndex].tabIndex = -1;
		}
		activeIndex = next;
		const el = items[activeIndex];
		el.classList.add(activeClass);
		el.tabIndex = 0;
		if (focus) el.focus({ preventScroll: false });
	};

	const onKeyDown = (e: KeyboardEvent): void => {
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				setActive(activeIndex + 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				setActive(activeIndex - 1);
				break;
			case 'Home':
				e.preventDefault();
				setActive(0);
				break;
			case 'End':
				e.preventDefault();
				setActive(items.length - 1);
				break;
			case 'Enter':
			case ' ':
				if (activeIndex >= 0) {
					e.preventDefault();
					onActivate(items[activeIndex], activeIndex);
				}
				break;
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				onClose();
				break;
			case 'Tab':
				// Menus are modal-ish; Tab dismisses rather than escaping into the page.
				e.preventDefault();
				onClose();
				break;
			default:
				break;
		}
	};

	if (!container.hasAttribute('tabindex')) container.tabIndex = -1;
	for (const item of items) item.tabIndex = -1;
	container.addEventListener('keydown', onKeyDown);

	if (options.autoFocusFirst !== false && items.length > 0) {
		setActive(0);
	}

	return () => {
		container.removeEventListener('keydown', onKeyDown);
	};
}

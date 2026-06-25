/**
 * Sticky group header: shows the current group label at the top of the scroll viewport
 * when the user scrolls past a group header row.
 *
 * Works by tracking the last group row that scrolled out of view (top) and rendering
 * a sticky overlay with the same label. Dismissed when the next group header scrolls
 * into view from the top.
 */

export interface StickyGroupHeaderConfig {
	/** Container element where the sticky bar is prepended. */
	container: HTMLElement;
	/** Height of the sticky bar in px (default 32). */
	height?: number;
}

export interface GroupHeaderInfo {
	visualIndex: number;
	label: string;
	depth: number;
	topPx: number;
}

export class StickyGroupHeader {
	private readonly el: HTMLElement;
	private currentLabel: string | null = null;

	constructor(private readonly config: StickyGroupHeaderConfig) {
		this.el = document.createElement('div');
		this.el.className = 'og-sticky-group-header';
		const h = config.height ?? 32;
		this.el.style.cssText = [
			'position:sticky',
			'top:0',
			'z-index:20',
			`height:${h}px`,
			'display:flex',
			'align-items:center',
			'padding:0 12px',
			'font-size:13px',
			'font-weight:600',
			'background:var(--og-header-bg,#f5f5f5)',
			'border-bottom:1px solid var(--og-border,#e0e0e0)',
			'display:none',
		].join(';');
		config.container.prepend(this.el);
	}

	/**
	 * Update the sticky label given the current scroll position and the list of group
	 * header rows. Shows the label of the topmost group whose top edge has scrolled above
	 * the viewport top; hides the bar when none has.
	 */
	update(scrollTop: number, groups: readonly GroupHeaderInfo[]): void {
		// Find the last group that has scrolled out of view
		let active: GroupHeaderInfo | null = null;
		for (const g of groups) {
			if (g.topPx < scrollTop) active = g;
			else break;
		}

		const label = active?.label ?? null;
		if (label === this.currentLabel) return;
		this.currentLabel = label;

		if (label) {
			this.el.textContent = label;
			this.el.style.display = 'flex';
		} else {
			this.el.style.display = 'none';
		}
	}

	/** Show a static label (e.g. when group panel is collapsed). */
	show(label: string): void {
		this.currentLabel = label;
		this.el.textContent = label;
		this.el.style.display = 'flex';
	}

	hide(): void {
		this.currentLabel = null;
		this.el.style.display = 'none';
	}

	destroy(): void {
		this.el.remove();
	}
}

/**
 * Shows a fixed-position error tooltip when the pointer hovers over a cell that has a
 * validation error. Uses event delegation on the grid container so no per-cell listeners
 * are needed. The tooltip is a single shared DOM node appended to document.body.
 */
export class ValidationTooltipController {
	private tooltipEl: HTMLDivElement | null = null;
	private currentTarget: HTMLElement | null = null;

	private readonly onMouseMove: (e: MouseEvent) => void;
	private readonly onMouseLeave: () => void;
	private readonly onScroll: () => void;

	constructor(private readonly container: HTMLElement) {
		this.onMouseMove = this.handleMouseMove.bind(this);
		this.onMouseLeave = this.handleMouseLeave.bind(this);
		this.onScroll = this.hide.bind(this);
		container.addEventListener('mousemove', this.onMouseMove);
		container.addEventListener('mouseleave', this.onMouseLeave);
		container.addEventListener('scroll', this.onScroll, { capture: true });
	}

	private getOrCreateTooltip(): HTMLDivElement {
		if (!this.tooltipEl) {
			this.tooltipEl = document.createElement('div');
			this.tooltipEl.className = 'og-validation-tooltip';
			this.tooltipEl.style.display = 'none';
			document.body.appendChild(this.tooltipEl);
		}
		return this.tooltipEl;
	}

	private handleMouseMove(e: MouseEvent): void {
		// Don't show during scroll — the container gets og-is-scrolling
		if (this.container.classList.contains('og-is-scrolling')) {
			this.hide();
			return;
		}

		const cell = (e.target as Element).closest('[data-validation-error]') as HTMLElement | null;
		if (!cell) {
			this.hide();
			return;
		}

		const error = cell.dataset.validationError;
		if (!error) {
			this.hide();
			return;
		}

		const tooltip = this.getOrCreateTooltip();

		if (this.currentTarget !== cell || tooltip.textContent !== error) {
			this.currentTarget = cell;
			tooltip.textContent = error;
		}

		// Position below cursor; flip above if too close to viewport bottom
		const x = e.clientX + 12;
		let y = e.clientY + 16;
		const viewportH = window.innerHeight;
		const tooltipH = 32; // approximate before layout
		if (y + tooltipH > viewportH - 8) {
			y = e.clientY - tooltipH - 8;
		}
		tooltip.style.left = `${x}px`;
		tooltip.style.top = `${y}px`;
		tooltip.style.display = 'block';
	}

	private handleMouseLeave(): void {
		this.hide();
	}

	public hide(): void {
		if (this.tooltipEl) this.tooltipEl.style.display = 'none';
		this.currentTarget = null;
	}

	public destroy(): void {
		this.container.removeEventListener('mousemove', this.onMouseMove);
		this.container.removeEventListener('mouseleave', this.onMouseLeave);
		this.container.removeEventListener('scroll', this.onScroll, { capture: true });
		this.tooltipEl?.remove();
		this.tooltipEl = null;
		this.currentTarget = null;
	}
}

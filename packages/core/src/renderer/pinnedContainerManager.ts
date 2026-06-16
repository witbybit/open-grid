import type { RowSlot } from './rowSlot.js';

/** Manages the creation and sizing of left/right pinned lane containers within a row slot. */
export class PinnedContainerManager<TRowData = unknown> {
	public ensure(slot: RowSlot<TRowData>, side: 'left' | 'right', width: number): HTMLDivElement | null {
		if (width <= 0) {
			const existing = side === 'left' ? slot.pinLeftContainer : slot.pinRightContainer;
			if (existing) {
				existing.remove();
				if (side === 'left') {
					slot.pinLeftContainer = null;
					slot.pinLeftContainerWidth = -1;
					slot.pinLeftContainerTransform = '';
				} else {
					slot.pinRightContainer = null;
					slot.pinRightContainerWidth = -1;
					slot.pinRightContainerLeft = -1;
					slot.pinRightContainerTransform = '';
				}
			}
			return null;
		}

		let container = side === 'left' ? slot.pinLeftContainer : slot.pinRightContainer;
		if (!container || !slot.element.contains(container)) {
			container = document.createElement('div');
			container.className = side === 'left' ? 'og-row-pin-left' : 'og-row-pin-right';
			slot.element.appendChild(container);
			if (side === 'left') {
				slot.pinLeftContainer = container;
				slot.pinLeftContainerWidth = -1;
				slot.pinLeftContainerTransform = '';
			} else {
				slot.pinRightContainer = container;
				slot.pinRightContainerWidth = -1;
				slot.pinRightContainerLeft = -1;
				slot.pinRightContainerTransform = '';
			}
		}
		const previousWidth = side === 'left' ? slot.pinLeftContainerWidth : slot.pinRightContainerWidth;
		if (previousWidth !== width) {
			if (side === 'left') {
				slot.pinLeftContainerWidth = width;
			} else {
				slot.pinRightContainerWidth = width;
			}
			container.style.width = `${width}px`;
		}
		return container;
	}
}

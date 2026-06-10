/**
 * Builds a CSS attribute selector for a single cell. Escapes `"` and `\` in the
 * values so rowIds or colFields with those characters don't break querySelector.
 */
export function buildCellSelector(rowId: string, colField: string): string {
	const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	return `.og-cell[data-row-id="${esc(rowId)}"][data-col-field="${esc(colField)}"]`;
}

/**
 * Adds `flashClass` to every cell in `container` matching the supplied row/col pairs,
 * then removes it after `durationMs`. Returns a cancel function that removes the class
 * immediately and clears the pending timer — call it on effect cleanup to avoid leaks.
 *
 * A single layout read (offsetWidth on the first element) is forced so the CSS animation
 * restarts if the function is called a second time before the previous one has expired.
 */
export function flashCopiedCells(
	container: HTMLElement,
	cells: ReadonlyArray<{ rowId: string; colField: string }>,
	flashClass = 'og-cell-flash',
	durationMs = 450
): () => void {
	if (cells.length === 0) return noop;

	const elements: HTMLElement[] = [];
	for (const { rowId, colField } of cells) {
		const el = container.querySelector<HTMLElement>(buildCellSelector(rowId, colField));
		if (el) elements.push(el);
	}
	if (elements.length === 0) return noop;

	// Remove first so the browser sees a class-removal → reflow → class-add transition,
	// which restarts the CSS animation even when triggered twice in quick succession.
	elements.forEach((el) => el.classList.remove(flashClass));
	void elements[0].offsetWidth; // single forced reflow — intentional
	elements.forEach((el) => el.classList.add(flashClass));

	const timer = setTimeout(() => elements.forEach((el) => el.classList.remove(flashClass)), durationMs);

	return () => {
		clearTimeout(timer);
		elements.forEach((el) => el.classList.remove(flashClass));
	};
}

function noop() {}

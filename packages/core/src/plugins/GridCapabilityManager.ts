/**
 * A capability is a named feature flag that can be toggled at runtime.
 * Renderers, plugins, and UI components check capabilities before activating behaviour.
 */
export type GridCapability =
	| 'keyboard.navigation'
	| 'keyboard.editing'
	| 'keyboard.selection'
	| 'clipboard.copy'
	| 'clipboard.paste'
	| 'clipboard.cut'
	| 'contextMenu'
	| 'columnReorder'
	| 'columnResize'
	| 'rowDrag'
	| 'cellEdit'
	| 'export.csv'
	| 'undo'
	| 'redo';

const DEFAULT_ENABLED: ReadonlySet<GridCapability> = new Set<GridCapability>([
	'keyboard.navigation',
	'keyboard.editing',
	'keyboard.selection',
	'clipboard.copy',
	'clipboard.paste',
	'clipboard.cut',
	'columnResize',
	'cellEdit',
	'export.csv',
	'undo',
	'redo',
]);

/**
 * Tracks which capabilities are active for a grid instance.
 * Defaults: navigation, editing, selection, clipboard, resize, export, undo/redo on;
 *           contextMenu, columnReorder, rowDrag off (opt-in via plugin).
 */
export class GridCapabilityManager {
	private readonly enabled: Set<GridCapability>;
	private readonly listeners = new Set<(cap: GridCapability) => void>();

	constructor(initial?: Iterable<GridCapability>) {
		this.enabled = initial ? new Set(initial) : new Set(DEFAULT_ENABLED);
	}

	has(cap: GridCapability): boolean {
		return this.enabled.has(cap);
	}

	enable(cap: GridCapability): void {
		if (!this.enabled.has(cap)) {
			this.enabled.add(cap);
			this.listeners.forEach((fn) => fn(cap));
		}
	}

	disable(cap: GridCapability): void {
		if (this.enabled.has(cap)) {
			this.enabled.delete(cap);
			this.listeners.forEach((fn) => fn(cap));
		}
	}

	toggle(cap: GridCapability): void {
		this.has(cap) ? this.disable(cap) : this.enable(cap);
	}

	getAll(): GridCapability[] {
		return [...this.enabled];
	}

	subscribe(fn: (cap: GridCapability) => void): () => void {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	}

	destroy(): void {
		this.listeners.clear();
	}
}

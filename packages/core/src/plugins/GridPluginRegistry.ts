import type { GridApi } from '../api/GridApiFacade.js';

/**
 * A plugin receives the grid API on install and returns a teardown function.
 * It must not retain a reference to `api` after `teardown()` is called.
 */
export interface GridPlugin<TRow = unknown> {
	readonly id: string;
	install(api: GridApi<TRow>): () => void;
}

/**
 * Lightweight plugin registry: install plugins on a grid, call teardown on destroy.
 * Plugins are singletons per registry — installing the same id twice is a no-op.
 */
export class GridPluginRegistry<TRow = unknown> {
	private readonly installed = new Map<string, () => void>();

	install(api: GridApi<TRow>, ...plugins: Array<GridPlugin<TRow>>): void {
		for (const plugin of plugins) {
			if (this.installed.has(plugin.id)) continue;
			const teardown = plugin.install(api);
			this.installed.set(plugin.id, teardown);
		}
	}

	uninstall(id: string): void {
		const teardown = this.installed.get(id);
		if (teardown) {
			teardown();
			this.installed.delete(id);
		}
	}

	destroy(): void {
		for (const teardown of this.installed.values()) teardown();
		this.installed.clear();
	}
}

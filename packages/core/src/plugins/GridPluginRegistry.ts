import type { GridPlugin, GridPluginController, GridPluginRuntime } from '../api/GridApi.js';
import type { ViewportRange } from '../viewportController.js';

export class GridPluginRegistry<TRowData = unknown> implements GridPluginController<TRowData> {
	private readonly plugins = new Map<string, GridPlugin<TRowData>>();

	constructor(private readonly runtime: GridPluginRuntime<TRowData>) {}

	public registerPlugin(plugin: GridPlugin<TRowData>): void {
		if (this.plugins.has(plugin.name)) {
			this.unregisterPlugin(plugin.name);
		}
		this.plugins.set(plugin.name, plugin);
		plugin.onInit?.(this.runtime);
	}

	public getPlugin<T = unknown>(name: string): T | null {
		return (this.plugins.get(name) as T | undefined) ?? null;
	}

	public unregisterPlugin(name: string): void {
		const plugin = this.plugins.get(name);
		if (!plugin) return;

		try {
			plugin.onDestroy?.();
		} catch (error) {
			console.error(error);
		}

		this.plugins.delete(name);
	}

	public notifyViewportChange(range: ViewportRange): void {
		for (const plugin of this.plugins.values()) {
			plugin.onViewportChange?.(range);
		}
	}

	public destroy(): void {
		for (const plugin of Array.from(this.plugins.values())) {
			this.unregisterPlugin(plugin.name);
		}
	}
}

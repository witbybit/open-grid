import type { GridPlugin, GridPluginController, GridPluginRuntime } from '../api/GridApi.js';
import type { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';
import type { ViewportRange } from '../viewportController.js';

export class GridPluginRegistry<TRowData = unknown> implements GridPluginController<TRowData> {
	private readonly plugins = new Map<string, GridPlugin<TRowData>>();

	constructor(
		private readonly runtime: GridPluginRuntime<TRowData>,
		private readonly faultReporter?: RuntimeFaultReporter<TRowData>
	) {}

	public registerPlugin(plugin: GridPlugin<TRowData>): void {
		if (this.plugins.has(plugin.name)) {
			this.unregisterPlugin(plugin.name);
		}
		this.plugins.set(plugin.name, plugin);
		try {
			plugin.onInit?.(this.runtime);
		} catch (error) {
			this.faultReporter?.report({ source: 'plugin-registry', operation: 'onInit', error, context: { pluginName: plugin.name } });
		}
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
			this.faultReporter?.report({ source: 'plugin-registry', operation: 'onDestroy', error, context: { pluginName: plugin.name } });
		}

		this.plugins.delete(name);
	}

	public notifyViewportChange(range: ViewportRange): void {
		for (const plugin of this.plugins.values()) {
			try {
				plugin.onViewportChange?.(range);
			} catch (error) {
				this.faultReporter?.report({ source: 'plugin-registry', operation: 'onViewportChange', error, context: { pluginName: plugin.name } });
			}
		}
	}

	public destroy(): void {
		for (const plugin of Array.from(this.plugins.values())) {
			this.unregisterPlugin(plugin.name);
		}
	}
}

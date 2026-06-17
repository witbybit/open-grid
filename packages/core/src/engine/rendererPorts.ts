import type { RenderStats } from '../renderer/renderOrchestrator.js';
import { createEmptyRenderStats } from '../renderer/renderOrchestrator.js';
import type { ThemeTokens, BuiltInThemeName } from '../renderer/themes.js';
import { DARK_THEME } from '../renderer/themes.js';

/**
 * Contract for rendering capabilities that are available only when a renderer is mounted.
 * DOM-specific methods (getContainer) return null in headless contexts.
 */
export interface RendererPort {
	requestRender(reason: string): void;
	getStats(): RenderStats;
	resetStats(): void;
	getContainer(): HTMLElement | null;
}

/**
 * Contract for theme capabilities. Headless context returns a stable default theme.
 */
export interface ThemePort {
	getTheme(): ThemeTokens;
	getThemeName(): BuiltInThemeName | null;
	getAvailableThemes(): BuiltInThemeName[];
	switchTheme(themeName: string): void;
	mergeTheme(partial: Partial<ThemeTokens>): void;
	onThemeChange(listener: (theme: ThemeTokens) => void): () => void;
}

/**
 * Aggregate of all runtime ports available to the API facade.
 * Ports are mutable host capability bindings with a headless fallback;
 * use bindRuntimePorts() / unbindRuntimePorts() to manage the lifecycle.
 */
export interface GridRuntimePorts {
	renderer: RendererPort;
	theme: ThemePort;
}

/** No-op renderer port for headless / server-side / test contexts. */
export const headlessRendererPort: RendererPort = {
	requestRender: () => {},
	getStats: () => createEmptyRenderStats(),
	resetStats: () => {},
	getContainer: () => null,
};

/** Default theme port for headless contexts — returns dark theme tokens, accepts but ignores mutations. */
export const headlessThemePort: ThemePort = {
	getTheme: () => DARK_THEME,
	getThemeName: () => null,
	getAvailableThemes: () => [],
	switchTheme: () => {},
	mergeTheme: () => {},
	onThemeChange: () => () => {},
};

/** Stable singleton headless ports object. Use this instead of createHeadlessPorts() to avoid allocation on every unmount. */
export const HEADLESS_PORTS: GridRuntimePorts = { renderer: headlessRendererPort, theme: headlessThemePort };

/** Convenience factory for a fully headless ports object. @deprecated Use HEADLESS_PORTS instead. */
export function createHeadlessPorts(): GridRuntimePorts {
	return HEADLESS_PORTS;
}

/** Opaque token returned by bindRuntimePorts(). Captures the binding generation to detect stale host callbacks. */
export interface RuntimePortBinding {
	readonly generation: number;
}

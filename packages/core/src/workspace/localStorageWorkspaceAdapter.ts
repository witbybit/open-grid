import type { GridViewDefinition, GridWorkspaceAdapter } from './workspaceTypes.js';

export function createLocalStorageWorkspaceAdapter(options: { storageKey: string }): GridWorkspaceAdapter {
	const { storageKey } = options;
	const defaultKey = `${storageKey}__default`;

	function readAll(): GridViewDefinition[] {
		try {
			if (typeof localStorage === 'undefined') return [];
			const raw = localStorage.getItem(storageKey);
			if (!raw) return [];
			return JSON.parse(raw) as GridViewDefinition[];
		} catch {
			return [];
		}
	}

	function writeAll(views: GridViewDefinition[]): void {
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(storageKey, JSON.stringify(views));
			}
		} catch {
			// localStorage may be unavailable (SSR, quota exceeded, private browsing)
		}
	}

	return {
		async listViews() {
			return readAll();
		},
		async getView(id) {
			return readAll().find((v) => v.id === id) ?? null;
		},
		async saveView(view) {
			const views = readAll();
			const idx = views.findIndex((v) => v.id === view.id);
			if (idx >= 0) {
				views[idx] = view;
			} else {
				views.push(view);
			}
			writeAll(views);
		},
		async deleteView(id) {
			writeAll(readAll().filter((v) => v.id !== id));
		},
		async getDefaultView() {
			try {
				return typeof localStorage !== 'undefined' ? localStorage.getItem(defaultKey) : null;
			} catch {
				return null;
			}
		},
		async setDefaultView(id) {
			try {
				if (typeof localStorage === 'undefined') return;
				if (id === null) {
					localStorage.removeItem(defaultKey);
				} else {
					localStorage.setItem(defaultKey, id);
				}
			} catch {
				// ignore
			}
		},
	};
}

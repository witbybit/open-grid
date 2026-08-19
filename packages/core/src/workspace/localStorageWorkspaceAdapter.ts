import { validatePersistedGridState } from '../persistence/statePersistence.js';
import type { GridViewDefinition, GridWorkspaceAdapter } from './workspaceTypes.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseViewDefinition(raw: unknown): GridViewDefinition | null {
	try {
		if (!isRecord(raw)) return null;

		const allowedKeys = new Set(['id', 'name', 'description', 'scope', 'createdAt', 'updatedAt', 'version', 'state', 'metadata']);
		if (Object.keys(raw).some((key) => !allowedKeys.has(key))) return null;
		if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
		if (raw.description !== undefined && typeof raw.description !== 'string') return null;
		if (raw.scope !== 'personal' && raw.scope !== 'team' && raw.scope !== 'system') return null;
		if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null;
		if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null;
		if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) return null;
		if (raw.metadata !== undefined && !isRecord(raw.metadata)) return null;
		if (validatePersistedGridState(raw.state) !== null) return null;

		return raw as unknown as GridViewDefinition;
	} catch {
		return null;
	}
}

export function createLocalStorageWorkspaceAdapter(options: { storageKey: string }): GridWorkspaceAdapter {
	const { storageKey } = options;
	const defaultKey = `${storageKey}__default`;

	function getStorage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	function readAll(): GridViewDefinition[] {
		try {
			const storage = getStorage();
			if (!storage) return [];
			const raw = storage.getItem(storageKey);
			if (typeof raw !== 'string') return [];
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.map(parseViewDefinition).filter((view): view is GridViewDefinition => view !== null);
		} catch {
			return [];
		}
	}

	function writeAll(views: GridViewDefinition[]): void {
		try {
			const storage = getStorage();
			if (!storage) return;
			storage.setItem(storageKey, JSON.stringify(views));
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
			try {
				const parsedView = parseViewDefinition(view);
				if (!parsedView) return;
				const views = readAll();
				const idx = views.findIndex((v) => v.id === parsedView.id);
				if (idx >= 0) {
					views[idx] = parsedView;
				} else {
					views.push(parsedView);
				}
				writeAll(views);
			} catch {
				// Treat an invalid caller-supplied value like an unavailable storage write.
			}
		},
		async deleteView(id) {
			try {
				writeAll(readAll().filter((v) => v.id !== id));
			} catch {
				// Storage reads and writes are best-effort.
			}
		},
		async getDefaultView() {
			try {
				const storage = getStorage();
				const value = storage?.getItem(defaultKey);
				return typeof value === 'string' ? value : null;
			} catch {
				return null;
			}
		},
		async setDefaultView(id) {
			try {
				const storage = getStorage();
				if (!storage) return;
				if (id === null) {
					storage.removeItem(defaultKey);
				} else {
					storage.setItem(defaultKey, id);
				}
			} catch {
				// ignore
			}
		},
	};
}

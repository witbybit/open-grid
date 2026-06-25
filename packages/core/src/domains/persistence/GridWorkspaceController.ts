import type { SerializedGridState } from './GridStateSchema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GridViewDefinition {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly state: SerializedGridState;
	readonly isDefault?: boolean;
}

export interface GridWorkspaceAdapter {
	listViews(): GridViewDefinition[];
	saveView(view: GridViewDefinition): void;
	deleteView(id: string): void;
}

export function createLocalStorageWorkspaceAdapter(key: string): GridWorkspaceAdapter {
	function load(): GridViewDefinition[] {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return [];
			return JSON.parse(raw) as GridViewDefinition[];
		} catch {
			return [];
		}
	}
	function persist(views: GridViewDefinition[]): void {
		try {
			localStorage.setItem(key, JSON.stringify(views));
		} catch {}
	}
	return {
		listViews: () => load(),
		saveView: (view) => {
			const views = load().filter((v) => v.id !== view.id);
			views.push(view);
			persist(views);
		},
		deleteView: (id) => {
			persist(load().filter((v) => v.id !== id));
		},
	};
}

// ---------------------------------------------------------------------------
// GridWorkspaceController
// ---------------------------------------------------------------------------

export class GridWorkspaceController {
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly adapter: GridWorkspaceAdapter,
		private readonly readState: () => SerializedGridState,
		private readonly writeState: (state: SerializedGridState) => void,
	) {}

	listViews(): GridViewDefinition[] {
		return this.adapter.listViews();
	}

	saveView(name: string, description?: string): GridViewDefinition {
		const now = Date.now();
		const view: GridViewDefinition = {
			id: `view-${now}-${Math.random().toString(36).slice(2, 6)}`,
			name,
			description,
			createdAt: now,
			updatedAt: now,
			state: this.readState(),
		};
		this.adapter.saveView(view);
		this.notify();
		return view;
	}

	updateView(id: string, patch: Partial<Pick<GridViewDefinition, 'name' | 'description' | 'state'>>): void {
		const views = this.adapter.listViews();
		const view = views.find((v) => v.id === id);
		if (!view) return;
		const updated: GridViewDefinition = {
			...view,
			...patch,
			updatedAt: Date.now(),
		};
		this.adapter.saveView(updated);
		this.notify();
	}

	renameView(id: string, name: string): void {
		this.updateView(id, { name });
	}

	deleteView(id: string): void {
		this.adapter.deleteView(id);
		this.notify();
	}

	duplicateView(id: string): GridViewDefinition | null {
		const views = this.adapter.listViews();
		const view = views.find((v) => v.id === id);
		if (!view) return null;
		return this.saveView(`${view.name} (copy)`, view.description);
	}

	applyView(id: string): boolean {
		const views = this.adapter.listViews();
		const view = views.find((v) => v.id === id);
		if (!view) return false;
		this.writeState(view.state);
		this.notify();
		return true;
	}

	setDefaultView(id: string): void {
		const views = this.adapter.listViews();
		for (const v of views) {
			this.adapter.saveView({ ...v, isDefault: v.id === id, updatedAt: Date.now() });
		}
		this.notify();
	}

	subscribe = (fn: () => void): (() => void) => {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	};

	destroy(): void {
		this.listeners.clear();
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}
}

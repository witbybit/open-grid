import type { GridEngine } from '../engine/GridEngine.js';
import type { VisualRow } from '../store.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import type { PortalMountManager } from './portalMountManager.js';

const STICKY_ROW_KEY_PREFIX = 'sticky-group:';

interface StickyGroupHost {
	element: HTMLDivElement;
	rowKey: string;
}

export class StickyGroupRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly portalMountManager: PortalMountManager<TRowData>;
	private layer: HTMLDivElement | null = null;
	private readonly hosts = new Map<string, StickyGroupHost>();

	constructor(engine: GridEngine<TRowData>, portalMountManager: PortalMountManager<TRowData>) {
		this.engine = engine;
		this.portalMountManager = portalMountManager;
	}

	public mount(layer: HTMLDivElement): void {
		this.layer = layer;
	}

	public sync(plan: GridLayoutPlan): void {
		const layer = this.layer;
		if (!layer) return;

		layer.style.width = `${plan.dimensions.contentWidth}px`;
		layer.style.transform = `translate3d(0, ${plan.origins.stickyGroupLayerTop}px, 0)`;

		const rowModel = this.engine.getRowModel();
		const nextKeys = new Set<string>();
		if (!rowModel || plan.stickyGroups.length === 0) {
			this.releaseMissing(nextKeys);
			return;
		}

		for (const item of plan.stickyGroups) {
			const visualRow = rowModel.getVisualRow(item.visualIndex);
			if (visualRow?.kind !== 'group') continue;
			const rowKey = `${STICKY_ROW_KEY_PREFIX}${visualRow.id}`;
			nextKeys.add(rowKey);
			const host = this.ensureHost(rowKey);
			const top = item.top - plan.viewport.scrollTop;

			host.element.dataset.rowIndex = String(item.visualIndex);
			host.element.dataset.rowId = visualRow.id;
			host.element.className = this.getHostClassName(item.depth, item.pushed);
			host.element.style.width = `${plan.dimensions.contentWidth}px`;
			host.element.style.height = `${item.height}px`;
			host.element.style.transform = `translate3d(0, ${top}px, 0)`;
			host.element.style.zIndex = String(34 + Math.min(item.depth, 8));
			this.portalMountManager.mountRow({ rowKey, container: host.element, visualRow: visualRow as VisualRow<TRowData> });
			this.portalMountManager.flushDeferredRowMount(rowKey);
		}

		this.releaseMissing(nextKeys);
	}

	public unmount(): void {
		this.releaseMissing(new Set());
		this.layer = null;
	}

	private ensureHost(rowKey: string): StickyGroupHost {
		const existing = this.hosts.get(rowKey);
		if (existing) return existing;
		const element = document.createElement('div');
		element.dataset.rowKey = rowKey;
		const host = { element, rowKey };
		this.hosts.set(rowKey, host);
		this.layer?.appendChild(element);
		return host;
	}

	private releaseMissing(nextKeys: Set<string>): void {
		for (const [rowKey, host] of this.hosts) {
			if (nextKeys.has(rowKey)) continue;
			this.portalMountManager.releaseRow({ rowKey, container: host.element });
			host.element.remove();
			this.hosts.delete(rowKey);
		}
	}

	private getHostClassName(depth: number, pushed: boolean): string {
		let className = `og-sticky-group-row-host og-row og-row-group og-row-group-sticky og-row-group-sticky-depth-${Math.min(depth, 4)}`;
		if (pushed) className += ' og-row-group-sticky-pushed';
		return className;
	}
}

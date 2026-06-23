import type { GridDomainId } from './GridDomain.js';
import { GRID_DOMAIN_IDS } from './GridDomain.js';

export type GridVersionSnapshot = Readonly<Record<GridDomainId, number>>;

/**
 * Per-domain monotonic version counters. Only the kernel mutates these (ARCHITECTURE.md §3 R1).
 * Selectors compare versions to decide what to recompute; a bump is the signal that a domain's
 * state changed.
 */
export class GridVersionRegistry {
	private readonly versions = new Map<GridDomainId, number>();

	get(domain: GridDomainId): number {
		return this.versions.get(domain) ?? 0;
	}

	/** Bump a domain's version and return the new value. Kernel-internal. */
	bump(domain: GridDomainId): number {
		const next = this.get(domain) + 1;
		this.versions.set(domain, next);
		return next;
	}

	snapshot(): GridVersionSnapshot {
		const out = {} as Record<GridDomainId, number>;
		for (const domain of GRID_DOMAIN_IDS) {
			out[domain] = this.get(domain);
		}
		return out;
	}
}

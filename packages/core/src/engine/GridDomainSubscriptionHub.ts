import type { GridDomainVersions } from '../state/GridDomainVersions.js';

export interface GridDomainSubscriptionHubDeps {
	getDomainVersions(): GridDomainVersions;
}

export class GridDomainSubscriptionHub {
	private readonly domainVersionListeners = new Set<(v: GridDomainVersions) => void>();
	private readonly domainListeners = new Map<keyof GridDomainVersions, Set<(version: number) => void>>();

	constructor(private readonly deps: GridDomainSubscriptionHubDeps) {}

	public subscribeToDomainVersions(listener: (v: GridDomainVersions) => void): () => void {
		this.domainVersionListeners.add(listener);
		return () => this.domainVersionListeners.delete(listener);
	}

	public subscribeDomain(domain: keyof GridDomainVersions, listener: (version: number) => void): () => void {
		let set = this.domainListeners.get(domain);
		if (!set) {
			set = new Set();
			this.domainListeners.set(domain, set);
		}
		set.add(listener);
		return () => {
			const current = this.domainListeners.get(domain);
			if (current) current.delete(listener);
		};
	}

	public publish(domains: readonly (keyof GridDomainVersions)[]): void {
		const versions = this.deps.getDomainVersions();
		this.domainVersionListeners.forEach((listener) => listener(versions));
		for (const domain of domains) {
			const set = this.domainListeners.get(domain);
			if (!set) continue;
			const version = versions[domain];
			set.forEach((listener) => listener(version));
		}
	}

	public clear(): void {
		this.domainVersionListeners.clear();
		this.domainListeners.clear();
	}
}

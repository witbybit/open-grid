export interface GridDiagnostics {
	readonly enabled: boolean;
	/** Record a named counter increment. */
	increment(counter: string, amount?: number): void;
	/** Record a timing sample in milliseconds. */
	timing(label: string, ms: number): void;
	/** Return a snapshot of all recorded counters. */
	snapshot(): Record<string, number>;
	/** Reset all counters and timings. */
	reset(): void;
}

export class NoopDiagnostics implements GridDiagnostics {
	readonly enabled = false;
	increment(_counter: string, _amount?: number): void {}
	timing(_label: string, _ms: number): void {}
	snapshot(): Record<string, number> {
		return {};
	}
	reset(): void {}
}

export class ActiveDiagnostics implements GridDiagnostics {
	readonly enabled = true;
	private counters: Record<string, number> = {};

	increment(counter: string, amount = 1): void {
		this.counters[counter] = (this.counters[counter] ?? 0) + amount;
	}

	timing(label: string, ms: number): void {
		const key = `${label}_ms`;
		this.counters[key] = (this.counters[key] ?? 0) + ms;
	}

	snapshot(): Record<string, number> {
		return { ...this.counters };
	}

	reset(): void {
		this.counters = {};
	}
}

export function createDiagnostics(enabled = false): GridDiagnostics {
	return enabled ? new ActiveDiagnostics() : new NoopDiagnostics();
}

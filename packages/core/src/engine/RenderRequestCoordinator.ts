import { GridEventName } from '../api/GridEvents.js';
import type { EventBus } from '../events/EventBus.js';

export class RenderRequestCoordinator<TRowData> {
	private depth = 0;
	private reason: string | null = null;
	private readonly changeIds = new Set<number>();
	constructor(private readonly eventBus: EventBus<TRowData>) {}
	request(reason: string, changeId?: number): void {
		if (changeId !== undefined) this.changeIds.add(changeId);
		if (this.depth > 0) {
			this.reason = this.reason ? `${this.reason}+${reason}` : reason;
			return;
		}
		this.dispatch(reason);
	}
	begin(): void {
		this.depth++;
	}
	end(): void {
		if (this.depth === 0 || --this.depth > 0) return;
		const reason = this.reason;
		this.reason = null;
		if (reason) this.dispatch(reason);
	}
	takeChangeIds(): readonly number[] {
		const result = [...this.changeIds];
		this.changeIds.clear();
		return result;
	}
	private dispatch(reason: string): void {
		this.eventBus.dispatchEvent(GridEventName.renderInvalidated, { reason });
		this.changeIds.clear();
	}
}

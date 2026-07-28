import type {
	GridCausalEvent,
	GridCausalTraceEnvelope,
	GridCausalTraceSnapshot,
	GridCellExplanation,
	GridFlightRecorderOptions,
	GridTraceCapturedValue,
	GridTraceCellCoordinate,
} from './GridCausalTrace.js';
import type { FallbackMetric, FrameMetrics, GridInstrumentation, GridInstrumentationSnapshot, GridMetric } from './GridInstrumentation.js';

const EMPTY_EVENTS = Object.freeze([]) as readonly GridCausalTraceEnvelope[];
const EMPTY_SNAPSHOT: GridCausalTraceSnapshot = Object.freeze({ v: 1, sessionId: null, active: false, dropped: 0, events: EMPTY_EVENTS });
let nextSession = 1;

export class GridFlightRecorder {
	private active = false;
	private destroyed = false;
	private sessionId: string | null = null;
	private sequence = 0;
	private nextAttemptId = 1;
	private dropped = 0;
	private capacity = 0;
	private buffer: Array<GridCausalTraceEnvelope | undefined> = [];
	private startIndex = 0;
	private size = 0;
	private captureValues: 'none' | 'metadata' | 'full' = 'none';
	private redactValue?: GridFlightRecorderOptions['redactValue'];
	private executingFrameChangeIds: readonly number[] = EMPTY_CHANGE_IDS;

	public enterExecutingFrame(changeIds: readonly number[]): void {
		this.executingFrameChangeIds = changeIds;
	}
	public leaveExecutingFrame(): void {
		this.executingFrameChangeIds = EMPTY_CHANGE_IDS;
	}
	public getExecutingFrameChangeIds(): readonly number[] {
		return this.executingFrameChangeIds;
	}
	public recordCompletedFrame(kind: string, changeIds: readonly number[]): void {
		this.record(() => ({ type: 'frame', changeIds, correlation: changeIds.length ? 'render-request' : 'uncorrelated', kind }));
	}
	public recordObservedFallback(component: string, reason: string): void {
		const changeIds = this.executingFrameChangeIds;
		this.record(() => ({ type: 'fallback', component, reason, changeIds, correlation: changeIds.length ? 'render-request' : 'uncorrelated' }));
	}

	public isActive(): boolean {
		return this.active && !this.destroyed;
	}

	public beginCommitAttempt(reason: string, cell?: GridTraceCellCoordinate): number | undefined {
		if (!this.isActive()) return undefined;
		const attemptId = this.nextAttemptId++;
		this.record(() => (cell ? { type: 'commit-request', attemptId, reason, cell } : { type: 'commit-request', attemptId, reason }));
		return attemptId;
	}

	public finishCommitAttempt(attemptId: number | undefined, outcome: string, changeId?: number, domains: readonly string[] = []): void {
		if (attemptId === undefined) return;
		this.record(() => ({ type: 'commit-outcome', attemptId, changeId, outcome, domains }));
	}

	public recordRejectedWrite(reason: string, cell?: GridTraceCellCoordinate): void {
		this.finishCommitAttempt(this.beginCommitAttempt(reason, cell), 'validation-rejected');
	}

	public start(options: GridFlightRecorderOptions = {}): void {
		if (this.destroyed) return;
		this.capacity = Math.max(0, Math.floor(options.capacity ?? 256));
		this.captureValues = options.captureValues ?? 'none';
		this.redactValue = options.redactValue;
		this.buffer = new Array(this.capacity);
		this.startIndex = 0;
		this.size = 0;
		this.dropped = 0;
		this.sequence = 0;
		this.sessionId = `grid-flight-${nextSession++}`;
		this.active = true;
	}

	public stop(): void {
		this.active = false;
	}

	public clear(): void {
		this.buffer.fill(undefined);
		this.startIndex = 0;
		this.size = 0;
		this.dropped = 0;
	}

	public destroy(): void {
		this.stop();
		this.clear();
		this.buffer = [];
		this.sessionId = null;
		this.destroyed = true;
	}

	/** Factory is invoked only while active, keeping disabled paths allocation-free. */
	public record(factory: () => GridCausalEvent): void {
		if (!this.isActive()) return;
		if (this.capacity === 0) {
			this.dropped++;
			return;
		}
		let event: GridCausalEvent;
		try {
			event = factory();
		} catch {
			return;
		}
		const envelope: GridCausalTraceEnvelope = Object.freeze({
			v: 1,
			sessionId: this.sessionId!,
			sequence: ++this.sequence,
			timestamp: Date.now(),
			event: Object.freeze(event),
		});
		const index = (this.startIndex + this.size) % this.capacity;
		if (this.size < this.capacity) {
			this.buffer[index] = envelope;
			this.size++;
		} else {
			this.buffer[this.startIndex] = envelope;
			this.startIndex = (this.startIndex + 1) % this.capacity;
			this.dropped++;
		}
	}

	public captureValue(value: unknown, cell: GridTraceCellCoordinate): GridTraceCapturedValue | undefined {
		if (!this.isActive()) return undefined;
		if (this.captureValues === 'none') return undefined;
		let redacted = value;
		if (this.redactValue) {
			try {
				redacted = this.redactValue(value, cell);
			} catch {
				return { mode: 'metadata', type: 'redaction-error', isNull: false };
			}
		}
		if (this.captureValues === 'metadata')
			return { mode: 'metadata', type: redacted === null ? 'null' : typeof redacted, isNull: redacted === null };
		return { mode: 'full', value: detachJsonSafe(redacted) };
	}

	public snapshot(): GridCausalTraceSnapshot {
		if (!this.sessionId && this.size === 0) return EMPTY_SNAPSHOT;
		const events: GridCausalTraceEnvelope[] = [];
		for (let offset = 0; offset < this.size; offset++) {
			const event = this.buffer[(this.startIndex + offset) % this.capacity];
			if (event) events.push(detachJsonSafe(event) as GridCausalTraceEnvelope);
		}
		return deepFreeze({ v: 1, sessionId: this.sessionId, active: this.isActive(), dropped: this.dropped, events });
	}

	public explainCell(rowId: string, colField: string): GridCellExplanation {
		let lastChange: GridCausalTraceEnvelope | undefined;
		let commit: GridCausalTraceEnvelope | undefined;
		let invalidation: GridCausalTraceEnvelope | undefined;
		let frame: GridCausalTraceEnvelope | undefined;
		for (let offset = this.size - 1; offset >= 0; offset--) {
			const envelope = this.buffer[(this.startIndex + offset) % this.capacity];
			if (!envelope) continue;
			const event = envelope.event;
			if (event.type === 'cell-change' && event.cell.rowId === rowId && event.cell.colField === colField) {
				lastChange = envelope;
				break;
			}
		}
		const changeId = lastChange?.event.type === 'cell-change' ? lastChange.event.changeId : undefined;
		if (changeId !== undefined) {
			for (let offset = this.size - 1; offset >= 0; offset--) {
				const envelope = this.buffer[(this.startIndex + offset) % this.capacity];
				if (!envelope) continue;
				const event = envelope.event;
				if (!commit && event.type === 'commit-outcome' && event.changeId === changeId) commit = envelope;
				if (!invalidation && event.type === 'invalidation' && event.changeId === changeId) invalidation = envelope;
				if (!frame && event.type === 'frame' && event.changeIds.includes(changeId)) frame = envelope;
			}
		}
		const unknown = (reason: string) => ({ status: 'unknown' as const, reason });
		return {
			cell: { rowId, colField },
			lastChange: lastChange ? { status: 'known', value: lastChange } : unknown('No retained cell change.'),
			commit: commit ? { status: 'known', value: commit } : unknown('No correlated retained commit outcome.'),
			invalidation: invalidation ? { status: 'known', value: invalidation } : unknown('No correlated retained invalidation.'),
			frame: frame ? { status: 'known', value: frame } : { status: 'not-applicable', reason: 'No completed frame was retained.' },
		};
	}
}

/** Delegates existing instrumentation ownership and observes only bounded frame/fallback calls. */
export class GridFlightRecorderInstrumentation implements GridInstrumentation {
	constructor(
		private readonly delegate: GridInstrumentation,
		private readonly recorder: GridFlightRecorder
	) {}
	increment(metric: GridMetric, amount?: number): void {
		this.delegate.increment(metric, amount);
	}
	get(metric: GridMetric): number {
		return this.delegate.get(metric);
	}
	recordFrame(frame: FrameMetrics): void {
		this.delegate.recordFrame(frame);
	}
	recordFallback(event: FallbackMetric): void {
		this.delegate.recordFallback(event);
		this.recorder.recordObservedFallback(event.component, event.reason);
	}
	snapshot(): GridInstrumentationSnapshot {
		return this.delegate.snapshot();
	}
	reset(): void {
		this.delegate.reset();
	}
}

const EMPTY_CHANGE_IDS = Object.freeze([]) as readonly number[];

function detachJsonSafe<T>(value: T): T {
	if (value === undefined) return value;
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		return '[unserializable]' as T;
	}
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

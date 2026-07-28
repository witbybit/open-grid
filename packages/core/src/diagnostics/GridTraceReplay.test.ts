import { describe, expect, it } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import { createGridTraceReplay, validateGridReplayTrace, type GridReplayScheduler, type GridReplayTrace } from './GridTraceReplay.js';

class QueuedScheduler implements GridReplayScheduler {
	public readonly delays: number[] = [];
	private turns: Array<{ active: boolean; turn: () => void }> = [];
	public schedule(turn: () => void, delayMs: number): () => void {
		const entry = { active: true, turn };
		this.turns.push(entry);
		this.delays.push(delayMs);
		return () => { entry.active = false; };
	}
	public runOne(): void {
		const entry = this.turns.shift();
		if (entry?.active) entry.turn();
	}
	public runAll(): void { while (this.turns.length) this.runOne(); }
}

const trace: GridReplayTrace = {
	v: 1,
	initial: { rowIdField: 'id', columns: [{ field: 'id' }, { field: 'name' }, { field: 'count' }, { field: 'formula' }], rows: [{ id: 'r:雪\0', name: 'Before', count: 1, formula: '=count*2' }] },
	commands: [
		{ kind: 'set-cell', rowId: 'r:雪\0', colField: 'name', value: 'After' },
		{ kind: 'batch-cells', updates: [{ rowId: 'r:雪\0', colField: 'count', value: 2 }] },
		{ kind: 'select-cell', rowId: 'r:雪\0', colField: 'name' },
		{ kind: 'clear-selection' },
	],
	observations: [
		{ at: 0, kind: 'formula-dependency', evidence: { source: 'count', target: 'formula' } },
		{ at: 0, kind: 'conflict-resolution', evidence: { resolution: 'local-wins' } },
		{ at: 1, kind: 'rejected-validation', evidence: { reason: 'captured-only' } },
		{ at: 1, kind: 'fault', evidence: { source: 'captured' } },
		{ at: 2, kind: 'fallback', evidence: { kind: 'captured' } },
		{ at: 2, kind: 'deleted-row', evidence: { rowId: 'deleted' } },
		{ at: 3, kind: 'partial-server-evidence', evidence: { loaded: false } },
	],
};
const encoded = (value: unknown = trace) => JSON.stringify(value);

describe('GridTraceReplay', () => {
	it('runs one deterministic command per scheduled turn; speed, pause, and cancel are cooperative', () => {
		const scheduler = new QueuedScheduler();
		const replay = createGridTraceReplay(encoded(), { scheduler }).replay!;
		expect(replay.play(2)).toBe('running');
		expect(scheduler.delays).toEqual([50]);
		scheduler.runOne();
		expect(replay.index).toBe(1);
		replay.setSpeed(0.5);
		expect(scheduler.delays.at(-1)).toBe(200);
		replay.pause();
		scheduler.runAll();
		expect(replay).toMatchObject({ status: 'paused', index: 1 });
		replay.play();
		replay.cancel();
		scheduler.runAll();
		expect(replay).toMatchObject({ status: 'cancelled', index: 1 });
		replay.destroy();
	});

	it('produces identical checkpoints twice, and seek-by-restart equals straight replay', () => {
		const firstScheduler = new QueuedScheduler();
		const secondScheduler = new QueuedScheduler();
		const first = createGridTraceReplay(encoded(), { scheduler: firstScheduler }).replay!;
		const second = createGridTraceReplay(encoded(), { scheduler: secondScheduler }).replay!;
		first.play(); firstScheduler.runAll();
		second.play(); secondScheduler.runAll();
		expect(first.checkpoints.map((entry) => entry.facts)).toEqual(second.checkpoints.map((entry) => entry.facts));
		const straight = first.checkpoints.map((entry) => entry.facts);
		expect(first.seek(2)).toBe('paused');
		first.play(); firstScheduler.runAll();
		expect(first.checkpoints.map((entry) => entry.facts)).toEqual(straight);
		first.destroy(); second.destroy();
	});

	it('stops at first divergence and keeps declared observations non-executable', () => {
		const scheduler = new QueuedScheduler();
		const replay = createGridTraceReplay(encoded({ ...trace, checkpoints: [{ at: 0, facts: { cells: [{ rowId: 'r:雪\0', colField: 'name', value: 'Wrong' }] }, causalEvidence: ['commit #42'] }] }), { scheduler }).replay!;
		replay.play(); scheduler.runAll();
		expect(replay.divergence).toMatchObject({ index: 0, causalEvidence: ['commit #42'] });
		expect(replay.status).toBe('diverged');
		const validated = validateGridReplayTrace(encoded());
		expect(validated.ok).toBe(true);
		if (validated.ok) {
			expect(validated.trace.observations?.map((entry) => entry.kind)).toEqual([
				'formula-dependency', 'conflict-resolution', 'rejected-validation', 'fault', 'fallback', 'deleted-row', 'partial-server-evidence',
			]);
		}
		const withUnknownObservation = validateGridReplayTrace(encoded({ ...trace, observations: [...trace.observations!, { at: 3, kind: 'server-network-request', evidence: { url: 'redacted' } }] }));
		expect(withUnknownObservation.ok).toBe(true);
		if (withUnknownObservation.ok) expect(withUnknownObservation.trace.unsupportedObservations?.[0]?.kind).toBe('server-network-request');
		replay.destroy();
	});

	it('compares declared invalidations, formula results, faults, and fallbacks as semantic facts', () => {
		const baseline = createGridTraceReplay(encoded()).replay!;
		baseline.step();
		const facts = baseline.checkpoints[0]!.facts;
		baseline.destroy();
		const matching = createGridTraceReplay(encoded({ ...trace, checkpoints: [{ at: 0, facts: { invalidationKinds: facts.invalidationKinds, formulaResults: facts.formulaResults, faults: facts.faults, fallbacks: facts.fallbacks } }] })).replay!;
		expect(matching.step()).toBe('paused');
		expect(matching.divergence).toBeNull();
		matching.destroy();
		const divergent = createGridTraceReplay(encoded({ ...trace, checkpoints: [{ at: 0, facts: { invalidationKinds: ['not-a-real-invalidation'], formulaResults: facts.formulaResults, faults: facts.faults, fallbacks: facts.fallbacks }, causalEvidence: ['render evidence'] }] })).replay!;
		expect(divergent.step()).toBe('diverged');
		expect(divergent.divergence).toMatchObject({ index: 0, expected: { invalidationKinds: ['not-a-real-invalidation'] }, actual: { invalidationKinds: facts.invalidationKinds }, causalEvidence: ['render evidence'] });
		divergent.destroy();
	});

	it('never writes to, subscribes to, or emits events from a live grid', () => {
		const live = new GridStore<{ id: string; name: string }>({ columns: [{ field: 'id' }, { field: 'name' }], getRowId: (row) => row.id });
		const rows = new ClientRowModelController(live.getClientRowModelRuntime(), { columns: [{ field: 'id' }, { field: 'name' }], rows: [{ id: 'r:雪\0', name: 'Live' }] });
		let notifications = 0;
		const unsubscribe = live.subscribe(() => notifications++);
		const scheduler = new QueuedScheduler();
		const replay = createGridTraceReplay(encoded(), { scheduler }).replay!;
		replay.play(); scheduler.runAll();
		expect(live.getCellState('r:雪\0', 'name').value).toBe('Live');
		expect(notifications).toBe(0);
		replay.destroy(); unsubscribe(); rows.dispose(); live.destroy();
	});

	it('rejects direct objects without touching Proxy/getter code and reports unknown commands as unsupported', () => {
		const proxy = new Proxy({}, { get() { throw new Error('must not execute'); }, getPrototypeOf() { throw new Error('must not execute'); } });
		expect(() => validateGridReplayTrace(proxy)).not.toThrow();
		expect(validateGridReplayTrace(proxy)).toMatchObject({ ok: false, status: 'invalid' });
		expect(createGridTraceReplay(encoded({ ...trace, commands: [{ kind: 'network-write' }] })).status).toBe('unsupported');
		expect(validateGridReplayTrace('{"__proto__":{},"v":1,"initial":{},"commands":[]}')).toMatchObject({ ok: false, status: 'invalid' });
	});

	it('fuzzes string and byte parsing without accepting executable object inputs', () => {
		let seed = 0x163;
		const next = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0);
		for (let index = 0; index < 100; index++) {
			const candidate = index % 2 === 0 ? JSON.stringify({ ...trace, commands: Array.from({ length: next() % 5 }, () => ({ kind: 'set-cell', rowId: 'r:雪\0', colField: 'count', value: next() % 9 })) }) : '{"v":1,"initial":[';
			const input = index % 3 === 0 ? new TextEncoder().encode(candidate) : candidate;
			expect(() => validateGridReplayTrace(input)).not.toThrow();
		}
	});
});

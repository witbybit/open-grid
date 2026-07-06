import { describe, expect, it } from 'vitest';
import { compileColumnTopology, computeColumnWindowDelta, diffColumnTopologies, type CompiledColumnTopology } from './columnTopology.js';
import type { CompiledGridPlan, InternalColumnDef } from '../columnDef.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

// instanceId defaults to the field string itself — these tests exercise lane/topology logic, not
// the field-vs-instance-id distinction, so using the field as a stand-in instanceId keeps every
// existing `.columnId`/`.get(field)` assertion valid unchanged.
function makeCol(field: string, width = 100, opts: Partial<InternalColumnDef<unknown>> = {}): InternalColumnDef<unknown> {
	return { field, width, instanceId: field, ...opts } as unknown as InternalColumnDef<unknown>;
}

function makePlan(cols: InternalColumnDef<unknown>[], pinLeftCount: number, pinRightCount: number, version = 1): CompiledGridPlan<unknown> {
	const colWidth = 100;
	const colCount = cols.length;
	const pinRightStart = colCount - pinRightCount;
	const pinLeftWidth = pinLeftCount * colWidth;
	const pinRightWidth = pinRightCount * colWidth;
	const totalWidth = colCount * colWidth;
	const pinRightBaseLeft = totalWidth - pinRightWidth;
	const colLefts = cols.map((_, i) => i * colWidth);
	const colWidths = cols.map(() => colWidth);
	return {
		displayedColumns: cols,
		colLefts,
		colWidths,
		pinLeftCount,
		pinRightStart,
		pinRightCount,
		pinLeftWidth,
		pinRightWidth,
		pinRightBaseLeft,
		totalWidth,
		version,
	} as unknown as CompiledGridPlan<unknown>;
}

// ── compileColumnTopology ──────────────────────────────────────────────────────

describe('compileColumnTopology — basic lane assignment', () => {
	it('all center columns — no pins', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 0);
		const t = compileColumnTopology(plan);

		expect(t.left).toHaveLength(0);
		expect(t.center).toHaveLength(3);
		expect(t.right).toHaveLength(0);
		expect(t.byColumnId.size).toBe(3);
		expect(t.placements).toHaveLength(3);
	});

	it('assigns correct lane to each column', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c'), makeCol('d')], 1, 1);
		const t = compileColumnTopology(plan);

		expect(t.left[0].columnId).toBe('a');
		expect(t.left[0].lane).toBe('left');
		expect(t.center[0].columnId).toBe('b');
		expect(t.center[0].lane).toBe('center');
		expect(t.center[1].columnId).toBe('c');
		expect(t.right[0].columnId).toBe('d');
		expect(t.right[0].lane).toBe('right');
	});

	it('laneIndex counts within each lane independently', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c'), makeCol('d')], 2, 1);
		const t = compileColumnTopology(plan);

		expect(t.placements[0].laneIndex).toBe(0); // a — left[0]
		expect(t.placements[1].laneIndex).toBe(1); // b — left[1]
		expect(t.placements[2].laneIndex).toBe(0); // c — center[0]
		expect(t.placements[3].laneIndex).toBe(0); // d — right[0]
	});

	it('absoluteIndex matches display order', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 1, 0);
		const t = compileColumnTopology(plan);

		expect(t.placements[0].absoluteIndex).toBe(0);
		expect(t.placements[1].absoluteIndex).toBe(1);
		expect(t.placements[2].absoluteIndex).toBe(2);
	});
});

describe('compileColumnTopology — laneOffset computation', () => {
	it('left lane: laneOffset === absoluteLeft (baseLeft = 0)', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 2, 0);
		const t = compileColumnTopology(plan);

		expect(t.left[0].laneOffset).toBe(0); // absoluteLeft 0 - 0 = 0
		expect(t.left[0].absoluteLeft).toBe(0);
		expect(t.left[1].laneOffset).toBe(100); // absoluteLeft 100 - 0 = 100
		expect(t.left[1].absoluteLeft).toBe(100);
	});

	it('center lane: laneOffset = absoluteLeft - pinLeftWidth', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 1, 0);
		const t = compileColumnTopology(plan);
		// pinLeftWidth = 100 (1 left column of width 100)
		expect(t.center[0].absoluteLeft).toBe(100);
		expect(t.center[0].laneOffset).toBe(0); // 100 - 100 = 0
		expect(t.center[1].absoluteLeft).toBe(200);
		expect(t.center[1].laneOffset).toBe(100); // 200 - 100 = 100
	});

	it('right lane: laneOffset = absoluteLeft - pinRightBaseLeft', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 2);
		const t = compileColumnTopology(plan);
		// pinRightBaseLeft = 300 - 200 = 100 (totalWidth=300, pinRightWidth=200)
		expect(t.right[0].absoluteLeft).toBe(100);
		expect(t.right[0].laneOffset).toBe(0); // 100 - 100 = 0
		expect(t.right[1].absoluteLeft).toBe(200);
		expect(t.right[1].laneOffset).toBe(100); // 200 - 100 = 100
	});

	it('byColumnId lookup returns correct placement', () => {
		const plan = makePlan([makeCol('x'), makeCol('y')], 1, 0);
		const t = compileColumnTopology(plan);

		const x = t.byColumnId.get('x')!;
		expect(x.lane).toBe('left');
		expect(x.laneOffset).toBe(0);

		const y = t.byColumnId.get('y')!;
		expect(y.lane).toBe('center');
		expect(y.laneOffset).toBe(0); // 100 - 100 = 0
	});

	it('version and pin width fields are propagated', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 1, 1, 7);
		const t = compileColumnTopology(plan);

		expect(t.version).toBe(7);
		expect(t.pinLeftWidth).toBe(100);
		expect(t.pinRightWidth).toBe(100);
		expect(t.pinRightBaseLeft).toBe(200);
		expect(t.totalContentWidth).toBe(300);
	});
});

describe('compileColumnTopology — empty plan', () => {
	it('produces empty topology for zero columns', () => {
		const plan = makePlan([], 0, 0);
		const t = compileColumnTopology(plan);

		expect(t.placements).toHaveLength(0);
		expect(t.byColumnId.size).toBe(0);
		expect(t.groupSegments).toHaveLength(0);
	});
});

// ── Group segmentation (WS10) ──────────────────────────────────────────────────

describe('compileColumnTopology — group segmentation', () => {
	it('no headerGroup → groupSegments is empty', () => {
		const plan = makePlan([makeCol('a'), makeCol('b')], 0, 0);
		const t = compileColumnTopology(plan);
		expect(t.groupSegments).toHaveLength(0);
	});

	it('single group level: all same group → one segment', () => {
		const plan = makePlan([makeCol('a', 100, { headerGroup: 'Revenue' }), makeCol('b', 100, { headerGroup: 'Revenue' })], 0, 0);
		const t = compileColumnTopology(plan);

		expect(t.groupSegments).toHaveLength(1);
		const segs = t.groupSegments[0];
		expect(segs).toHaveLength(1);
		expect(segs[0].label).toBe('Revenue');
		expect(segs[0].firstColumnId).toBe('a');
		expect(segs[0].lastColumnId).toBe('b');
		expect(segs[0].lane).toBe('center');
		expect(segs[0].laneOffset).toBe(0);
		expect(segs[0].width).toBe(200);
		expect(segs[0].colStart).toBe(0);
		expect(segs[0].colEnd).toBe(1);
	});

	it('two different groups in same depth → two segments', () => {
		const plan = makePlan(
			[makeCol('a', 100, { headerGroup: 'G1' }), makeCol('b', 100, { headerGroup: 'G1' }), makeCol('c', 100, { headerGroup: 'G2' })],
			0,
			0
		);
		const t = compileColumnTopology(plan);

		expect(t.groupSegments[0]).toHaveLength(2);
		expect(t.groupSegments[0][0].label).toBe('G1');
		expect(t.groupSegments[0][0].width).toBe(200);
		expect(t.groupSegments[0][1].label).toBe('G2');
		expect(t.groupSegments[0][1].laneOffset).toBe(200);
		expect(t.groupSegments[0][1].width).toBe(100);
	});

	it('group spanning a pin boundary splits into two segments', () => {
		// a is pinned left, b is center, both have the same headerGroup.
		const plan = makePlan([makeCol('a', 100, { headerGroup: 'G' }), makeCol('b', 100, { headerGroup: 'G' })], 1, 0);
		const t = compileColumnTopology(plan);

		const segs = t.groupSegments[0];
		expect(segs).toHaveLength(2);
		expect(segs[0].lane).toBe('left');
		expect(segs[0].label).toBe('G');
		expect(segs[0].firstColumnId).toBe('a');
		expect(segs[0].lastColumnId).toBe('a');
		expect(segs[1].lane).toBe('center');
		expect(segs[1].label).toBe('G');
		expect(segs[1].firstColumnId).toBe('b');
		expect(segs[1].lastColumnId).toBe('b');
	});

	it('two group depths: groupSegments has two entries', () => {
		const plan = makePlan([makeCol('a', 100, { headerGroup: ['Outer', 'Inner'] }), makeCol('b', 100, { headerGroup: ['Outer', 'Inner'] })], 0, 0);
		const t = compileColumnTopology(plan);

		expect(t.groupSegments).toHaveLength(2);
		expect(t.groupSegments[0][0].label).toBe('Outer');
		expect(t.groupSegments[1][0].label).toBe('Inner');
	});

	it('segment id is lane-aware: grp:{depth}:{lane}:{firstColId}:{lastColId}', () => {
		const plan = makePlan([makeCol('a', 100, { headerGroup: 'G' }), makeCol('b', 100, { headerGroup: 'G' })], 0, 0);
		const t = compileColumnTopology(plan);

		expect(t.groupSegments[0][0].id).toBe('grp:0:center:a:b');
	});

	it('group laneOffset is relative to the lane (center case)', () => {
		const plan = makePlan([makeCol('pin', 100), makeCol('a', 100, { headerGroup: 'G' }), makeCol('b', 100, { headerGroup: 'G' })], 1, 0);
		const t = compileColumnTopology(plan);
		// pinLeftWidth = 100; a.absoluteLeft = 100; b.absoluteLeft = 200
		// center laneOffset: a.laneOffset = 100-100=0, b.laneOffset = 200-100=100
		// group segment starts at a.laneOffset = 0
		expect(t.groupSegments[0][0].lane).toBe('center');
		expect(t.groupSegments[0][0].laneOffset).toBe(0);
		expect(t.groupSegments[0][0].width).toBe(200);
	});
});

// ── Shared topology version (Plan 119) ────────────────────────────────────────

describe('compileColumnTopology — shared topology version', () => {
	it('topology.version equals plan.version exactly', () => {
		const t = compileColumnTopology(makePlan([makeCol('a'), makeCol('b')], 0, 0, 42));
		expect(t.version).toBe(42);
	});

	it('same plan compiled twice produces same version — shared across call sites', () => {
		const plan = makePlan([makeCol('a'), makeCol('b')], 1, 0, 5);
		const headerTopology = compileColumnTopology(plan);
		const bodyTopology = compileColumnTopology(plan);
		const filterTopology = compileColumnTopology(plan);
		expect(headerTopology.version).toBe(5);
		expect(bodyTopology.version).toBe(5);
		expect(filterTopology.version).toBe(5);
	});

	it('increments by exactly 1 when plan version increments by 1', () => {
		const cols = [makeCol('a'), makeCol('b')];
		const t1 = compileColumnTopology(makePlan(cols, 0, 0, 1));
		const t2 = compileColumnTopology(makePlan(cols, 0, 0, 2));
		expect(t2.version - t1.version).toBe(1);
	});

	it('a single pin change increments version exactly once — not once per consumer', () => {
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		const prevPlan = makePlan(cols, 0, 0, 10);
		const nextPlan = makePlan(cols, 1, 0, 11); // one topology change
		const prev = compileColumnTopology(prevPlan);
		const headerNext = compileColumnTopology(nextPlan);
		const bodyNext = compileColumnTopology(nextPlan);
		const filterNext = compileColumnTopology(nextPlan);
		expect(headerNext.version).toBe(11);
		expect(bodyNext.version).toBe(11);
		expect(filterNext.version).toBe(11);
		expect(headerNext.version - prev.version).toBe(1);
	});

	it('adding a column produces a higher topology version', () => {
		const t1 = compileColumnTopology(makePlan([makeCol('a'), makeCol('b')], 0, 0, 1));
		const t2 = compileColumnTopology(makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 0, 2));
		expect(t2.version).toBeGreaterThan(t1.version);
	});

	it('removing a column produces a higher topology version', () => {
		const t1 = compileColumnTopology(makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 0, 1));
		const t2 = compileColumnTopology(makePlan([makeCol('a'), makeCol('b')], 0, 0, 2));
		expect(t2.version).toBeGreaterThan(t1.version);
	});

	it('plan unchanged → topology version unchanged across multiple compilations', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 1, 1, 7);
		const versions = [1, 2, 3].map(() => compileColumnTopology(plan).version);
		expect(versions).toEqual([7, 7, 7]);
	});

	it('lane assignments are stable across compilations when version is unchanged', () => {
		const plan = makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 1, 1, 7);
		const t1 = compileColumnTopology(plan);
		const t2 = compileColumnTopology(plan);
		for (const id of ['a', 'b', 'c']) {
			expect(t2.byColumnId.get(id)!.lane).toBe(t1.byColumnId.get(id)!.lane);
			expect(t2.byColumnId.get(id)!.laneOffset).toBe(t1.byColumnId.get(id)!.laneOffset);
		}
	});
});

// ── diffColumnTopologies (WS8) ─────────────────────────────────────────────────

describe('diffColumnTopologies', () => {
	function compilePlan(cols: InternalColumnDef<unknown>[], pinLeft: number, pinRight: number, version: number): CompiledColumnTopology {
		return compileColumnTopology(makePlan(cols, pinLeft, pinRight, version));
	}

	it('identical topologies: all retained, none entered or exited', () => {
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		const prev = compilePlan(cols, 0, 0, 1);
		const next = compilePlan(cols, 0, 0, 2);

		const diff = diffColumnTopologies(prev, next);
		expect(diff.prevVersion).toBe(1);
		expect(diff.nextVersion).toBe(2);
		expect(diff.retained).toHaveLength(3);
		expect(diff.entered).toHaveLength(0);
		expect(diff.exited).toHaveLength(0);
		expect(diff.relocated).toHaveLength(0);
	});

	it('column added: appears in entered', () => {
		const prev = compilePlan([makeCol('a'), makeCol('b')], 0, 0, 1);
		const next = compilePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 0, 2);

		const diff = diffColumnTopologies(prev, next);
		expect(diff.entered).toHaveLength(1);
		expect(diff.entered[0].columnId).toBe('c');
		expect(diff.exited).toHaveLength(0);
	});

	it('column removed: appears in exited', () => {
		const prev = compilePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 0, 1);
		const next = compilePlan([makeCol('a'), makeCol('b')], 0, 0, 2);

		const diff = diffColumnTopologies(prev, next);
		expect(diff.exited).toHaveLength(1);
		expect(diff.exited[0].columnId).toBe('c');
		expect(diff.entered).toHaveLength(0);
	});

	it('column changes lane (pin): appears in relocated (also in retained)', () => {
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		const prev = compilePlan(cols, 0, 0, 1); // all center
		const next = compilePlan(cols, 1, 0, 2); // a pinned left

		const diff = diffColumnTopologies(prev, next);
		expect(diff.retained).toHaveLength(3);
		expect(diff.relocated).toHaveLength(1);
		expect(diff.relocated[0].next.columnId).toBe('a');
		expect(diff.relocated[0].prev.lane).toBe('center');
		expect(diff.relocated[0].next.lane).toBe('left');
	});

	it('no relocation when lane is unchanged', () => {
		const prev = compilePlan([makeCol('a'), makeCol('b')], 1, 0, 1);
		const next = compilePlan([makeCol('a'), makeCol('b')], 1, 0, 2);

		const diff = diffColumnTopologies(prev, next);
		expect(diff.relocated).toHaveLength(0);
	});
});

describe('computeColumnWindowDelta', () => {
	function compilePlan(cols: InternalColumnDef<unknown>[], pinLeft: number, pinRight: number, version: number): CompiledColumnTopology {
		return compileColumnTopology(makePlan(cols, pinLeft, pinRight, version));
	}

	it('horizontal-only scroll: entered/exited/stayed center columns, no lane moves', () => {
		// A pure horizontal window shift: 'a' scrolls out, 'd' scrolls in, 'b'/'c' stay.
		const prev = compilePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 0, 1);
		const next = compilePlan([makeCol('b'), makeCol('c'), makeCol('d')], 0, 0, 2);

		const delta = computeColumnWindowDelta(prev, next);
		expect(delta.enteredCenterColumns).toEqual(['d']);
		expect(delta.exitedCenterColumns).toEqual(['a']);
		expect(delta.stayedCenterColumns.sort()).toEqual(['b', 'c']);
		expect(delta.laneMoves).toHaveLength(0);
		expect(delta.enteredPinnedLeftColumns).toHaveLength(0);
		expect(delta.exitedPinnedRightColumns).toHaveLength(0);
	});

	it('identical topology: everything stayed, nothing entered/exited/moved', () => {
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		const prev = compilePlan(cols, 0, 0, 1);
		const next = compilePlan(cols, 0, 0, 2);

		const delta = computeColumnWindowDelta(prev, next);
		expect(delta.stayedCenterColumns.sort()).toEqual(['a', 'b', 'c']);
		expect(delta.enteredCenterColumns).toHaveLength(0);
		expect(delta.exitedCenterColumns).toHaveLength(0);
		expect(delta.laneMoves).toHaveLength(0);
	});

	it('column pinned left: reported as a laneMove, not entered+exited', () => {
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		const prev = compilePlan(cols, 0, 0, 1); // all center
		const next = compilePlan(cols, 1, 0, 2); // 'a' pinned left

		const delta = computeColumnWindowDelta(prev, next);
		expect(delta.laneMoves).toEqual([{ columnInstanceId: 'a', from: 'center', to: 'left' }]);
		// A lane move is a relocation, not an enter/exit, and must not appear in stayed either.
		expect(delta.enteredCenterColumns).toHaveLength(0);
		expect(delta.exitedCenterColumns).toHaveLength(0);
		expect(delta.enteredPinnedLeftColumns).toHaveLength(0);
		expect(delta.stayedCenterColumns).not.toContain('a');
		expect(delta.stayedCenterColumns.sort()).toEqual(['b', 'c']);
	});

	it('mixed diagonal scroll: a horizontal window shift combined with a pin change in the same step', () => {
		const prev = compilePlan([makeCol('a'), makeCol('b'), makeCol('c'), makeCol('d')], 0, 0, 1);
		// 'a' and 'd' exit entirely, 'b' gets pinned left, 'c' stays center, 'e' enters center.
		const next = compilePlan([makeCol('b'), makeCol('c'), makeCol('e')], 1, 0, 2);

		const delta = computeColumnWindowDelta(prev, next);
		expect(delta.laneMoves).toEqual([{ columnInstanceId: 'b', from: 'center', to: 'left' }]);
		expect(delta.exitedCenterColumns.sort()).toEqual(['a', 'd']);
		expect(delta.enteredCenterColumns).toEqual(['e']);
		expect(delta.stayedCenterColumns).toEqual(['c']);
		expect(delta.enteredPinnedLeftColumns).toHaveLength(0); // 'b' was retained+relocated, not newly entered
	});

	it('pinned-right column exiting is reported under exitedPinnedRightColumns, not exitedCenterColumns', () => {
		const prev = compilePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 1, 1); // 'c' pinned right
		const next = compilePlan([makeCol('a'), makeCol('b')], 0, 0, 2);

		const delta = computeColumnWindowDelta(prev, next);
		expect(delta.exitedPinnedRightColumns).toEqual(['c']);
		expect(delta.exitedCenterColumns).toHaveLength(0);
	});
});

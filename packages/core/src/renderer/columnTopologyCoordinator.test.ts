import { describe, expect, it } from 'vitest';
import { ColumnTopologyCoordinator, type ColumnTopologyDeltaTelemetrySink } from './columnTopologyCoordinator.js';
import type { CompiledGridPlan, InternalColumnDef } from '../columnDef.js';

function makeCol(field: string, width = 100): InternalColumnDef<unknown> {
	return { field, width, instanceId: field } as unknown as InternalColumnDef<unknown>;
}

function makePlan(cols: InternalColumnDef<unknown>[], pinLeftCount: number, pinRightCount: number, version: number): CompiledGridPlan<unknown> {
	const colWidth = 100;
	const colCount = cols.length;
	const pinRightStart = colCount - pinRightCount;
	const pinLeftWidth = pinLeftCount * colWidth;
	const pinRightWidth = pinRightCount * colWidth;
	const totalWidth = colCount * colWidth;
	const pinRightBaseLeft = totalWidth - pinRightWidth;
	return {
		displayedColumns: cols,
		colLefts: cols.map((_, i) => i * colWidth),
		colWidths: cols.map(() => colWidth),
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

function makeStats(): ColumnTopologyDeltaTelemetrySink {
	return {};
}

describe('ColumnTopologyCoordinator', () => {
	it('compiles a fresh topology on first call', () => {
		const coordinator = new ColumnTopologyCoordinator();
		const plan = makePlan([makeCol('a'), makeCol('b')], 0, 0, 1);
		const topology = coordinator.getCompiledTopology(plan, false);
		expect(topology.version).toBe(1);
		expect(topology.center.map((p) => p.columnId)).toEqual(['a', 'b']);
	});

	it('returns the exact same cached object when plan.version is unchanged', () => {
		const coordinator = new ColumnTopologyCoordinator();
		const plan = makePlan([makeCol('a'), makeCol('b')], 0, 0, 1);
		const first = coordinator.getCompiledTopology(plan, false);
		const second = coordinator.getCompiledTopology(plan, false);
		expect(second).toBe(first);
	});

	it('recompiles when plan.version changes', () => {
		const coordinator = new ColumnTopologyCoordinator();
		const planV1 = makePlan([makeCol('a'), makeCol('b')], 0, 0, 1);
		const planV2 = makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 0, 2);
		const first = coordinator.getCompiledTopology(planV1, false);
		const second = coordinator.getCompiledTopology(planV2, false);
		expect(second).not.toBe(first);
		expect(second.center.map((p) => p.columnId)).toEqual(['a', 'b', 'c']);
	});

	it('does not record any delta telemetry on the very first compile (nothing to diff against)', () => {
		const coordinator = new ColumnTopologyCoordinator();
		const stats = makeStats();
		coordinator.getCompiledTopology(makePlan([makeCol('a'), makeCol('b')], 0, 0, 1), false, stats);
		expect(stats.columnTopologyDeltaComputations ?? 0).toBe(0);
	});

	it('records a laneMove for a column that gets pinned between two versions', () => {
		const coordinator = new ColumnTopologyCoordinator();
		const stats = makeStats();
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		coordinator.getCompiledTopology(makePlan(cols, 0, 0, 1), false, stats);
		coordinator.getCompiledTopology(makePlan(cols, 1, 0, 2), false, stats);

		expect(stats.columnTopologyDeltaComputations).toBe(1);
		expect(stats.columnTopologyLaneMoves).toBe(1);
		expect(stats.columnTopologyEnteredColumns).toBe(0);
		expect(stats.columnTopologyExitedColumns).toBe(0);
		expect(stats.columnTopologyStayedColumns).toBe(2); // b and c stay in center, unmoved
	});

	it('only increments columnTopologyDeltaComputationsDuringScroll when isScrollFrameActive is true', () => {
		const coordinator = new ColumnTopologyCoordinator();
		const stats = makeStats();
		const cols = [makeCol('a'), makeCol('b')];
		coordinator.getCompiledTopology(makePlan(cols, 0, 0, 1), false, stats);
		coordinator.getCompiledTopology(makePlan(cols, 1, 0, 2), true, stats);

		expect(stats.columnTopologyDeltaComputations).toBe(1);
		expect(stats.columnTopologyDeltaComputationsDuringScroll).toBe(1);
	});

	it('accumulates delta counters across multiple recompiles rather than overwriting them', () => {
		const coordinator = new ColumnTopologyCoordinator();
		const stats = makeStats();
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		coordinator.getCompiledTopology(makePlan(cols, 0, 0, 1), false, stats);
		coordinator.getCompiledTopology(makePlan(cols, 1, 0, 2), false, stats); // 1 laneMove
		coordinator.getCompiledTopology(makePlan(cols, 0, 1, 3), false, stats); // more lane churn

		expect(stats.columnTopologyDeltaComputations).toBe(2);
		expect(stats.columnTopologyLaneMoves).toBeGreaterThanOrEqual(2);
	});

	it('skips delta telemetry entirely when no renderStats sink is provided', () => {
		const coordinator = new ColumnTopologyCoordinator();
		const cols = [makeCol('a'), makeCol('b')];
		expect(() => {
			coordinator.getCompiledTopology(makePlan(cols, 0, 0, 1), false);
			coordinator.getCompiledTopology(makePlan(cols, 1, 0, 2), false);
		}).not.toThrow();
	});

	it('two independent coordinator instances do not share cache state', () => {
		const a = new ColumnTopologyCoordinator();
		const b = new ColumnTopologyCoordinator();
		const plan = makePlan([makeCol('a')], 0, 0, 1);
		const fromA = a.getCompiledTopology(plan, false);
		const fromB = b.getCompiledTopology(plan, false);
		expect(fromA).not.toBe(fromB);
		expect(fromA).toEqual(fromB);
	});
});

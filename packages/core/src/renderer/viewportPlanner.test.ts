import { describe, expect, it } from 'vitest';
import { ViewportPlanner } from './viewportPlanner.js';
import { createEmptyRenderWindow, type RenderWindow } from './renderWindow.js';
import { compileColumnTopology } from './columnTopology.js';
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
	return {
		displayedColumns: cols,
		colLefts: cols.map((_, i) => i * colWidth),
		colWidths: cols.map(() => colWidth),
		pinLeftCount,
		pinRightStart,
		pinRightCount,
		pinLeftWidth,
		pinRightWidth,
		pinRightBaseLeft: totalWidth - pinRightWidth,
		totalWidth,
		version,
	} as unknown as CompiledGridPlan<unknown>;
}

function windowWithRows(rowStart: number, rowEnd: number): RenderWindow {
	return { ...createEmptyRenderWindow(), rowStart, rowEnd, rowCount: 100, colCount: 3, colStart: 0, colEnd: 2 };
}

describe('ViewportPlanner', () => {
	it('first frame — no prior window/topology, no columnWindowDelta, frame counter starts at 1', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a'), makeCol('b')], 0, 0, 1));
		const plan = planner.computePlan(windowWithRows(0, 9), topology);

		expect(plan.frame).toBe(1);
		expect(plan.columnWindowDelta).toBeUndefined();
		expect(plan.renderWindow.rowStart).toBe(0);
		expect(plan.liveRows.size).toBe(0);
		expect(plan.liveCenterColumns.size).toBe(0);
	});

	it('frame counter increments monotonically across calls', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a')], 0, 0, 1));
		const first = planner.computePlan(windowWithRows(0, 9), topology);
		const second = planner.computePlan(windowWithRows(1, 10), topology);
		expect(second.frame).toBe(first.frame + 1);
	});

	it('routine scroll (same topology version) — viewportDelta reflects entered/exited rows, columnWindowDelta stays undefined', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a'), makeCol('b')], 0, 0, 1));
		planner.computePlan(windowWithRows(0, 9), topology);
		const plan = planner.computePlan(windowWithRows(1, 10), topology);

		expect(plan.columnWindowDelta).toBeUndefined();
		expect(plan.viewportDelta.rowsEntered).toContain(10);
		expect(plan.viewportDelta.rowsExited).toContain(0);
	});

	it('topology version change (pin/reorder) — columnWindowDelta is computed against the prior topology', () => {
		const planner = new ViewportPlanner();
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		const topologyV1 = compileColumnTopology(makePlan(cols, 0, 0, 1));
		planner.computePlan(windowWithRows(0, 9), topologyV1);

		const topologyV2 = compileColumnTopology(makePlan(cols, 1, 0, 2)); // pin 'a' left
		const plan = planner.computePlan(windowWithRows(0, 9), topologyV2);

		expect(plan.columnWindowDelta).toBeDefined();
		expect(plan.columnWindowDelta!.laneMoves.length).toBeGreaterThan(0);
	});

	it('retainedFocusEditRowIndices passes through unchanged — planner does not compute retention itself', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a')], 0, 0, 1));
		const retained = new Set([42]);
		const plan = planner.computePlan(windowWithRows(0, 9), topology, retained);
		expect(plan.retainedFocusEditRowIndices).toBe(retained);
	});

	it('liveRows/liveCenterColumns are caller-owned mutable sets the planner never populates itself', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a')], 0, 0, 1));
		const plan = planner.computePlan(windowWithRows(0, 9), topology);
		plan.liveRows.add('r1');
		plan.liveCenterColumns.add('a' as any);
		expect(plan.liveRows.has('r1')).toBe(true);
		expect(plan.liveCenterColumns.has('a' as any)).toBe(true);
	});

	it('reset() clears diffing state so the next frame is treated as freshly-entered', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a')], 0, 0, 1));
		planner.computePlan(windowWithRows(5, 14), topology);
		planner.reset();
		const plan = planner.computePlan(windowWithRows(5, 14), topology);
		expect(plan.frame).toBe(1);
		expect(plan.viewportDelta.rowsEntered.length).toBeGreaterThan(0);
	});
});

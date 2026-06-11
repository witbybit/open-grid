import { describe, it, expect, vi } from 'vitest';
import { RowNode } from '../../rowNode.js';
import { aggregateStage } from './aggregateStage.js';
import { groupStage } from './groupStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { AggregationDef } from './aggregateStage.js';

interface Row {
	id: string;
	category: string;
	amount: number;
	label: string;
}

function makeNode(id: string, data: Partial<Row> = {}) {
	return new RowNode<Row>(id, { id, category: 'A', amount: 0, label: '', ...data });
}

function makeContext(fields: string[] = ['category', 'amount', 'label']) {
	return createRowPipelineContext<Row>(
		fields.map((f) => ({ field: f, header: f })),
		{ groups: new Set(), treeRows: new Set(), details: new Set() }
	);
}

function buildGroups(nodes: RowNode<Row>[], groupField = 'category') {
	const ctx = makeContext();
	return { roots: groupStage(nodes, [{ colId: groupField }], ctx), ctx };
}

describe('aggregateStage', () => {
	it('empty aggDefs is a no-op — aggregateValues stays empty', () => {
		const nodes = [makeNode('1', { amount: 100 }), makeNode('2', { amount: 200 })];
		const { roots } = buildGroups(nodes);
		aggregateStage(roots, [], makeContext());
		roots.forEach((r) => {
			if (r.kind === 'group') {
				expect(r.aggregateValues).toEqual({});
			}
		});
	});

	it('sum aggregation totals leaf values correctly per group', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 10 }),
			makeNode('2', { category: 'A', amount: 20 }),
			makeNode('3', { category: 'B', amount: 5 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		const aggDefs: AggregationDef<Row>[] = [{ field: 'amount', aggFunc: 'sum' }];
		aggregateStage(roots, aggDefs, ctx);

		const groupA = roots.find((r) => r.kind === 'group' && r.keyString === 'A');
		const groupB = roots.find((r) => r.kind === 'group' && r.keyString === 'B');
		expect(groupA?.kind === 'group' && groupA.aggregateValues['amount']).toBe(30);
		expect(groupB?.kind === 'group' && groupB.aggregateValues['amount']).toBe(5);
	});

	it('count aggregation counts leaf nodes per group', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 1 }),
			makeNode('2', { category: 'A', amount: 2 }),
			makeNode('3', { category: 'A', amount: 3 }),
			makeNode('4', { category: 'B', amount: 4 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		const aggDefs: AggregationDef<Row>[] = [{ field: 'amount', aggFunc: 'count' }];
		aggregateStage(roots, aggDefs, ctx);

		const groupA = roots.find((r) => r.kind === 'group' && r.keyString === 'A');
		const groupB = roots.find((r) => r.kind === 'group' && r.keyString === 'B');
		expect(groupA?.kind === 'group' && groupA.aggregateValues['amount']).toBe(3);
		expect(groupB?.kind === 'group' && groupB.aggregateValues['amount']).toBe(1);
	});

	it('avg aggregation computes the mean', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 10 }),
			makeNode('2', { category: 'A', amount: 20 }),
			makeNode('3', { category: 'A', amount: 30 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'avg' }], ctx);
		const groupA = roots[0];
		expect(groupA.kind === 'group' && groupA.aggregateValues['amount']).toBe(20);
	});

	it('min picks the smallest value', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 50 }),
			makeNode('2', { category: 'A', amount: 3 }),
			makeNode('3', { category: 'A', amount: 20 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'min' }], ctx);
		expect((roots[0] as any).aggregateValues['amount']).toBe(3);
	});

	it('max picks the largest value', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 50 }),
			makeNode('2', { category: 'A', amount: 3 }),
			makeNode('3', { category: 'A', amount: 20 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'max' }], ctx);
		expect((roots[0] as any).aggregateValues['amount']).toBe(50);
	});

	it('non-numeric values are excluded from sum/avg/min/max, leaving undefined when all are non-numeric', () => {
		const nodes = [
			new RowNode<any>('1', { id: '1', category: 'A', amount: 'not-a-number' }),
			new RowNode<any>('2', { id: '2', category: 'A', amount: 'also-not' }),
		];
		const ctx = createRowPipelineContext<any>(
			[
				{ field: 'category', header: 'cat' },
				{ field: 'amount', header: 'amt' },
			],
			{ groups: new Set(), treeRows: new Set(), details: new Set() }
		);
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'sum' }], ctx);
		expect((roots[0] as any).aggregateValues['amount']).toBeUndefined();
	});

	it('custom function aggregation receives leaf RowNodes and returns its value', () => {
		const nodes = [makeNode('1', { category: 'A', amount: 10 }), makeNode('2', { category: 'A', amount: 20 })];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(roots, [{ field: 'amount', aggFunc: (leafNodes) => leafNodes.length * 100 }], ctx);
		expect((roots[0] as any).aggregateValues['amount']).toBe(200);
	});

	it('custom function that throws is caught and sets value to undefined', () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const nodes = [makeNode('1', { category: 'A', amount: 10 })];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(
			roots,
			[
				{
					field: 'amount',
					aggFunc: () => {
						throw new Error('boom');
					},
				},
			],
			ctx
		);
		expect((roots[0] as any).aggregateValues['amount']).toBeUndefined();
		consoleSpy.mockRestore();
	});

	it('nested groups propagate aggregates up — outer group sums inner sums', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 10 }),
			makeNode('2', { category: 'A', amount: 20 }),
			makeNode('3', { category: 'B', amount: 5 }),
			makeNode('4', { category: 'B', amount: 15 }),
		];
		const ctx = makeContext();
		// Two-level grouping: first by category, then by label (all same → one inner group each)
		const roots = groupStage(nodes, [{ colId: 'category' }, { colId: 'label' }], ctx);
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'sum' }], ctx);

		const groupA = roots.find((r) => r.kind === 'group' && r.keyString === 'A');
		const groupB = roots.find((r) => r.kind === 'group' && r.keyString === 'B');
		// Outer groups should aggregate all descendants
		expect(groupA?.kind === 'group' && groupA.aggregateValues['amount']).toBe(30);
		expect(groupB?.kind === 'group' && groupB.aggregateValues['amount']).toBe(20);
	});
});

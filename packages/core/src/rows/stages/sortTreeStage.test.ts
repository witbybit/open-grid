import { describe, it, expect } from 'vitest';
import { RowNode } from '../../rowNode.js';
import { sortTreeStage } from './sortTreeStage.js';
import { groupStage } from './groupStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { SortModel } from '../../rowModel.js';

interface Row {
	id: string;
	name: string;
	amount: number;
	category: string;
}

function makeNode(id: string, data: Partial<Row> = {}) {
	return new RowNode<Row>(id, { id, name: id, amount: 0, category: 'A', ...data });
}

function makeContext(fields: string[] = ['name', 'amount', 'category']) {
	return createRowPipelineContext<Row>(
		fields.map((f) => ({ field: f, header: f })),
		{ groups: new Set(), treeRows: new Set(), details: new Set() }
	);
}

describe('sortTreeStage', () => {
	it('null sortModel is a no-op', () => {
		const nodes = [makeNode('1', { name: 'Banana' }), makeNode('2', { name: 'Apple' })];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		sortTreeStage(roots, null, [{ field: 'name', header: 'Name' }]);
		expect(roots[0].rowId).toBe('1');
		expect(roots[1].rowId).toBe('2');
	});

	it('empty sortModel is a no-op', () => {
		const nodes = [makeNode('1', { name: 'Banana' }), makeNode('2', { name: 'Apple' })];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		sortTreeStage(roots, [], [{ field: 'name', header: 'Name' }]);
		expect(roots[0].rowId).toBe('1');
	});

	it('ascending sort on string field orders roots correctly', () => {
		const nodes = [makeNode('1', { name: 'Banana' }), makeNode('2', { name: 'Apple' }), makeNode('3', { name: 'Cherry' })];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		const sortModel: SortModel = [{ colId: 'name', sort: 'asc' }];
		sortTreeStage(roots, sortModel, [{ field: 'name', header: 'Name' }]);
		expect(roots.map((r) => r.node.data.name)).toEqual(['Apple', 'Banana', 'Cherry']);
	});

	it('descending sort reverses alphabetical order', () => {
		const nodes = [makeNode('1', { name: 'Apple' }), makeNode('2', { name: 'Cherry' }), makeNode('3', { name: 'Banana' })];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		const sortModel: SortModel = [{ colId: 'name', sort: 'desc' }];
		sortTreeStage(roots, sortModel, [{ field: 'name', header: 'Name' }]);
		expect(roots.map((r) => r.node.data.name)).toEqual(['Cherry', 'Banana', 'Apple']);
	});

	it('numeric field sorts numerically, not lexicographically', () => {
		const nodes = [makeNode('1', { amount: 10 }), makeNode('2', { amount: 2 }), makeNode('3', { amount: 100 })];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		const sortModel: SortModel = [{ colId: 'amount', sort: 'asc' }];
		sortTreeStage(roots, sortModel, [{ field: 'amount', header: 'Amount' }]);
		expect(roots.map((r) => r.node.data.amount)).toEqual([2, 10, 100]);
	});

	it('sort is applied recursively to children of grouped nodes', () => {
		const nodes = [
			makeNode('1', { name: 'Zorro', category: 'A' }),
			makeNode('2', { name: 'Alpha', category: 'A' }),
			makeNode('3', { name: 'Mango', category: 'A' }),
		];
		const ctx = makeContext();
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		const sortModel: SortModel = [{ colId: 'name', sort: 'asc' }];
		sortTreeStage(roots, sortModel, [
			{ field: 'name', header: 'Name' },
			{ field: 'category', header: 'Category' },
		]);
		const group = roots[0];
		if (group.kind === 'group') {
			const names = group.children.map((c) => (c.kind === 'data' ? c.node.data.name : ''));
			expect(names).toEqual(['Alpha', 'Mango', 'Zorro']);
		}
	});

	it('multi-column sort: primary asc, secondary desc', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 20 }),
			makeNode('2', { category: 'A', amount: 10 }),
			makeNode('3', { category: 'B', amount: 5 }),
		];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		const sortModel: SortModel = [
			{ colId: 'category', sort: 'asc' },
			{ colId: 'amount', sort: 'desc' },
		];
		sortTreeStage(roots, sortModel, [
			{ field: 'category', header: 'Category' },
			{ field: 'amount', header: 'Amount' },
		]);
		expect(roots[0].node.data.category).toBe('A');
		expect(roots[0].node.data.amount).toBe(20);
		expect(roots[1].node.data.amount).toBe(10);
		expect(roots[2].node.data.category).toBe('B');
	});
});

import { describe, it, expect } from 'vitest';
import { RowNode } from '../../rowNode.js';
import { groupStage } from './groupStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { GroupDef } from '../RowPipeline.js';

interface Row {
	id: string;
	category: string;
	sub: string;
	amount: number;
}

function makeNode(id: string, data: Row) {
	return new RowNode(id, data);
}

function makeContext(fields: string[] = ['category', 'sub', 'amount']) {
	return createRowPipelineContext<Row>(
		fields.map((f) => ({ field: f, header: f })),
		{ groups: new Set(), treeRows: new Set(), details: new Set() }
	);
}

describe('groupStage', () => {
	it('returns flat data nodes when groupDefs is empty', () => {
		const nodes = [
			makeNode('1', { id: '1', category: 'A', sub: 'x', amount: 10 }),
			makeNode('2', { id: '2', category: 'B', sub: 'y', amount: 20 }),
		];
		const result = groupStage(nodes, [], makeContext());
		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('data');
		expect(result[1].kind).toBe('data');
		expect(result[0].depth).toBe(0);
		expect(result[1].depth).toBe(0);
	});

	it('returns empty array for empty input', () => {
		expect(groupStage([], [], makeContext())).toHaveLength(0);
		expect(groupStage([], [{ colId: 'category' }], makeContext())).toHaveLength(0);
	});

	it('produces correct number of groups for distinct values', () => {
		const nodes = [
			makeNode('1', { id: '1', category: 'A', sub: 'x', amount: 10 }),
			makeNode('2', { id: '2', category: 'B', sub: 'y', amount: 20 }),
			makeNode('3', { id: '3', category: 'A', sub: 'z', amount: 30 }),
		];
		const result = groupStage(nodes, [{ colId: 'category' }], makeContext());
		expect(result).toHaveLength(2);
		const kinds = result.map((r) => r.kind);
		expect(kinds).toEqual(['group', 'group']);
	});

	it('all rows same key produces a single group', () => {
		const nodes = [
			makeNode('1', { id: '1', category: 'A', sub: 'x', amount: 10 }),
			makeNode('2', { id: '2', category: 'A', sub: 'y', amount: 20 }),
		];
		const result = groupStage(nodes, [{ colId: 'category' }], makeContext());
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('group');
	});

	it('group childCount equals the number of leaf rows', () => {
		const nodes = [
			makeNode('1', { id: '1', category: 'A', sub: 'x', amount: 10 }),
			makeNode('2', { id: '2', category: 'A', sub: 'y', amount: 20 }),
			makeNode('3', { id: '3', category: 'B', sub: 'z', amount: 30 }),
		];
		const result = groupStage(nodes, [{ colId: 'category' }], makeContext());
		const groupA = result.find((r) => r.kind === 'group' && r.keyString === 'A');
		const groupB = result.find((r) => r.kind === 'group' && r.keyString === 'B');
		expect(groupA?.kind === 'group' && groupA.childCount).toBe(2);
		expect(groupB?.kind === 'group' && groupB.childCount).toBe(1);
	});

	it('leaf nodes inside a group have depth 1 for a single grouping level', () => {
		const nodes = [
			makeNode('1', { id: '1', category: 'A', sub: 'x', amount: 10 }),
			makeNode('2', { id: '2', category: 'A', sub: 'y', amount: 20 }),
		];
		const result = groupStage(nodes, [{ colId: 'category' }], makeContext());
		expect(result[0].kind).toBe('group');
		if (result[0].kind === 'group') {
			expect(result[0].children[0].depth).toBe(1);
			expect(result[0].children[1].depth).toBe(1);
		}
	});

	it('two-level grouping nests correctly with correct depths', () => {
		const nodes = [
			makeNode('1', { id: '1', category: 'A', sub: 'x', amount: 10 }),
			makeNode('2', { id: '2', category: 'A', sub: 'y', amount: 20 }),
			makeNode('3', { id: '3', category: 'B', sub: 'x', amount: 30 }),
		];
		const result = groupStage(nodes, [{ colId: 'category' }, { colId: 'sub' }], makeContext());

		// Outer groups at depth 0
		expect(result[0].kind).toBe('group');
		expect(result[0].depth).toBe(0);

		// Inner groups at depth 1
		const groupA = result.find((r) => r.kind === 'group' && r.keyString === 'A');
		expect(groupA?.kind === 'group' && groupA.depth).toBe(0);
		if (groupA?.kind === 'group') {
			groupA.children.forEach((child) => {
				expect(child.kind).toBe('group');
				expect(child.depth).toBe(1);
			});
			// Leaves at depth 2
			groupA.children.forEach((child) => {
				if (child.kind === 'group') {
					child.children.forEach((leaf) => {
						expect(leaf.depth).toBe(2);
					});
				}
			});
		}
	});

	it('group id is deterministic for the same data in the same order', () => {
		const nodes = [
			makeNode('1', { id: '1', category: 'A', sub: 'x', amount: 10 }),
			makeNode('2', { id: '2', category: 'B', sub: 'y', amount: 20 }),
		];
		const r1 = groupStage(nodes, [{ colId: 'category' }], makeContext());
		const r2 = groupStage(nodes, [{ colId: 'category' }], makeContext());
		expect(r1[0].kind === 'group' && r1[0].id).toBe(r2[0].kind === 'group' && r2[0].id);
		expect(r1[1].kind === 'group' && r1[1].id).toBe(r2[1].kind === 'group' && r2[1].id);
	});

	it('custom keyCreator on GroupDef is used to derive key strings', () => {
		const nodes = [
			makeNode('1', { id: '1', category: 'alpha', sub: 'x', amount: 10 }),
			makeNode('2', { id: '2', category: 'ALPHA', sub: 'y', amount: 20 }),
		];
		const groupDef: GroupDef<Row> = {
			colId: 'category',
			keyCreator: ({ value }) => String(value).toUpperCase(),
		};
		const result = groupStage(nodes, [groupDef], makeContext());
		// Both rows map to same uppercase key → single group
		expect(result).toHaveLength(1);
		expect(result[0].kind === 'group' && result[0].keyString).toBe('ALPHA');
	});

	it('two-level group leafCount equals total leaf rows under parent', () => {
		const nodes = [
			makeNode('1', { id: '1', category: 'A', sub: 'x', amount: 10 }),
			makeNode('2', { id: '2', category: 'A', sub: 'x', amount: 20 }),
			makeNode('3', { id: '3', category: 'A', sub: 'y', amount: 30 }),
		];
		const result = groupStage(nodes, [{ colId: 'category' }, { colId: 'sub' }], makeContext());
		const groupA = result[0];
		expect(groupA.kind === 'group' && groupA.leafCount).toBe(3);
	});

	it('group stores correct key value (not just string)', () => {
		const nodes = [makeNode('1', { id: '1', category: 'Fruits', sub: 'x', amount: 10 })];
		const result = groupStage(nodes, [{ colId: 'category' }], makeContext());
		expect(result[0].kind === 'group' && result[0].key).toBe('Fruits');
	});
});

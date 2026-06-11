import { describe, it, expect } from 'vitest';
import { RowNode } from '../../rowNode.js';
import { treeStage } from './treeStage.js';

interface Row {
	id: string;
	name: string;
	parentId?: string | null;
}

function makeNode(id: string, parentId?: string | null) {
	return new RowNode(id, { id, name: id, parentId });
}

const getParentId = (row: Row) => row.parentId ?? null;

describe('treeStage', () => {
	it('returns empty array for empty input', () => {
		expect(treeStage([], getParentId)).toHaveLength(0);
	});

	it('flat list with no parent IDs produces all roots at depth 0', () => {
		const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
		const result = treeStage(nodes, getParentId);
		expect(result).toHaveLength(3);
		result.forEach((r) => {
			expect(r.kind).toBe('data');
			expect(r.depth).toBe(0);
		});
	});

	it('single node with no parent is a single root', () => {
		const result = treeStage([makeNode('root')], getParentId);
		expect(result).toHaveLength(1);
		expect(result[0].depth).toBe(0);
	});

	it('parent-child pair: parent is root at depth 0, child is nested at depth 1', () => {
		const nodes = [makeNode('parent'), makeNode('child', 'parent')];
		const result = treeStage(nodes, getParentId);
		expect(result).toHaveLength(1);
		const root = result[0];
		expect(root.depth).toBe(0);
		expect(root.rowId).toBe('parent');
		expect(root.children).toHaveLength(1);
		expect(root.children![0].depth).toBe(1);
		expect(root.children![0].rowId).toBe('child');
	});

	it('three-level hierarchy has correct depths 0, 1, 2', () => {
		const nodes = [makeNode('a'), makeNode('b', 'a'), makeNode('c', 'b')];
		const result = treeStage(nodes, getParentId);
		expect(result).toHaveLength(1);
		const root = result[0];
		expect(root.depth).toBe(0);
		const mid = root.children![0];
		expect(mid.depth).toBe(1);
		const leaf = mid.children![0];
		expect(leaf.depth).toBe(2);
	});

	it('orphan node (parentId not in input) is treated as a root', () => {
		const nodes = [makeNode('child', 'ghost-parent')];
		const result = treeStage(nodes, getParentId);
		expect(result).toHaveLength(1);
		expect(result[0].rowId).toBe('child');
		expect(result[0].depth).toBe(0);
	});

	it('multiple siblings at same level appear as children of the same parent', () => {
		const nodes = [makeNode('parent'), makeNode('child1', 'parent'), makeNode('child2', 'parent')];
		const result = treeStage(nodes, getParentId);
		expect(result).toHaveLength(1);
		expect(result[0].children).toHaveLength(2);
	});

	it('two independent trees produce two roots', () => {
		const nodes = [makeNode('r1'), makeNode('c1', 'r1'), makeNode('r2'), makeNode('c2', 'r2')];
		const result = treeStage(nodes, getParentId);
		expect(result).toHaveLength(2);
	});

	it('node with null parentId is treated as a root', () => {
		const nodes = [new RowNode('x', { id: 'x', name: 'x', parentId: null })];
		const result = treeStage(nodes, getParentId);
		expect(result).toHaveLength(1);
		expect(result[0].depth).toBe(0);
	});

	it('leaf nodes (no children) have undefined children', () => {
		const nodes = [makeNode('a'), makeNode('b')];
		const result = treeStage(nodes, getParentId);
		result.forEach((r) => {
			expect(r.children).toBeUndefined();
		});
	});
});

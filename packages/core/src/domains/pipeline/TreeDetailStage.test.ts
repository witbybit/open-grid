import { describe, expect, it } from 'vitest';
import { ClientRowModel } from '../rows/client/ClientRowModel.js';
import { RowPipeline } from './RowPipeline.js';
import type { VisualRow } from './VisualRow.js';

interface Node {
	id: string;
	parentId: string | null;
	name: string;
}

// a → a1 (→ a1a), a2 ; b
const treeSeed: Node[] = [
	{ id: 'a', parentId: null, name: 'A' },
	{ id: 'a1', parentId: 'a', name: 'A1' },
	{ id: 'a1a', parentId: 'a1', name: 'A1A' },
	{ id: 'a2', parentId: 'a', name: 'A2' },
	{ id: 'b', parentId: null, name: 'B' },
];

function treePipeline() {
	const model = new ClientRowModel<Node>((r) => r.id);
	model.commands.replaceRows(treeSeed);
	const pipeline = new RowPipeline<Node>(() => model.getRows());
	pipeline.recompute();
	return pipeline;
}

function shape(rows: readonly VisualRow<Node>[]): string[] {
	return rows.map((r) => {
		if (r.kind === 'tree') return `T${r.depth}:${String(r.rowId)}`;
		if (r.kind === 'data') return `D:${String(r.rowId)}`;
		if (r.kind === 'detail') return `X:${String(r.parentRowId)}`;
		return r.kind;
	});
}

describe('TreeStage / RowPipeline tree data (ARCHITECTURE.md §3 R5–R6)', () => {
	it('flattens a hierarchy into ordered tree rows with depth', () => {
		const p = treePipeline();
		p.setTreeData({ getParentId: (r) => r.parentId });
		expect(shape(p.getVisualModel().toArray())).toEqual(['T0:a', 'T1:a1', 'T2:a1a', 'T1:a2', 'T0:b']);
	});

	it('collapsing a node hides its descendants but keeps the node', () => {
		const p = treePipeline();
		p.setTreeData({ getParentId: (r) => r.parentId });
		p.toggleTreeNode('a1'); // collapse a1 → hides a1a
		expect(shape(p.getVisualModel().toArray())).toEqual(['T0:a', 'T1:a1', 'T1:a2', 'T0:b']);
		p.toggleTreeNode('a'); // collapse a → hides a1, a2 (and their subtree)
		expect(shape(p.getVisualModel().toArray())).toEqual(['T0:a', 'T0:b']);
	});

	it('tree rows are real data rows (carry rowId + node)', () => {
		const p = treePipeline();
		p.setTreeData({ getParentId: (r) => r.parentId });
		const first = p.getVisualModel().toArray()[0]!;
		expect(first.kind).toBe('tree');
		expect(first.kind === 'tree' && first.node.data.name).toBe('A');
		expect(String(first.visualRowId)).toBe('v:tree:a');
	});
});

interface Row {
	id: string;
	name: string;
}
const flatSeed: Row[] = [
	{ id: 'r1', name: 'One' },
	{ id: 'r2', name: 'Two' },
	{ id: 'r3', name: 'Three' },
];

function flatPipeline() {
	const model = new ClientRowModel<Row>((r) => r.id);
	model.commands.replaceRows(flatSeed);
	const pipeline = new RowPipeline<Row>(() => model.getRows());
	pipeline.recompute();
	return pipeline;
}

describe('DetailStage / RowPipeline master-detail (ARCHITECTURE.md §3 R5–R6)', () => {
	it('inserts a detail row directly after an opened master row', () => {
		const p = flatPipeline();
		p.toggleDetail('r2');
		const rows = p.getVisualModel().toArray();
		expect(rows.map((r) => (r.kind === 'data' ? `D:${String(r.rowId)}` : `X:${String((r as { parentRowId: string }).parentRowId)}`))).toEqual([
			'D:r1',
			'D:r2',
			'X:r2',
			'D:r3',
		]);
	});

	it('a detail visual row carries the master id and a distinct visual id (R5)', () => {
		const p = flatPipeline();
		p.toggleDetail('r1');
		const detail = p
			.getVisualModel()
			.toArray()
			.find((r) => r.kind === 'detail')!;
		expect(detail.kind === 'detail' && String(detail.parentRowId)).toBe('r1');
		expect(String(detail.visualRowId)).toBe('v:detail:r1');
	});

	it('closing the detail removes the detail row', () => {
		const p = flatPipeline();
		p.toggleDetail('r1');
		p.toggleDetail('r1');
		expect(
			p
				.getVisualModel()
				.toArray()
				.every((r) => r.kind !== 'detail')
		).toBe(true);
	});
});

import { describe, expect, it } from 'vitest';
import { asRowId } from '../rows/RowId.js';
import { createRowNode } from '../rows/RowNode.js';
import type { RowNode } from '../rows/RowNode.js';
import { RowPipeline } from './RowPipeline.js';
import { WindowedVisualModel } from './WindowedVisualModel.js';

interface Row {
	id: string;
	name: string;
}

// loaded block: source indices 10,11,12
const loaded: RowNode<Row>[] = [
	createRowNode(asRowId('r10'), 10, { id: 'r10', name: 'Ten' }),
	createRowNode(asRowId('r11'), 11, { id: 'r11', name: 'Eleven' }),
	createRowNode(asRowId('r12'), 12, { id: 'r12', name: 'Twelve' }),
];
const byIndex = new Map(loaded.map((n) => [n.sourceIndex, n]));
const nodeAt = (i: number) => byIndex.get(i) ?? null;

describe('WindowedVisualModel — lazy infinite/server projection (ARCHITECTURE.md §3 R5–R6, R12)', () => {
	it('spans the full logical count without materializing', () => {
		const vm = new WindowedVisualModel<Row>(1_000_000, nodeAt, loaded);
		expect(vm.count).toBe(1_000_000);
	});

	it('resolves loaded indices to data rows and gaps to loading rows', () => {
		const vm = new WindowedVisualModel<Row>(100, nodeAt, loaded);
		const gap = vm.getByVisualIndex(0)!;
		expect(gap.kind).toBe('loading');
		expect(gap.kind === 'loading' && gap.index).toBe(0);

		const data = vm.getByVisualIndex(11)!;
		expect(data.kind).toBe('data');
		expect(data.kind === 'data' && String(data.rowId)).toBe('r11');
	});

	it('loading rows carry no RowId (never editable, R5) and have stable visual ids', () => {
		const vm = new WindowedVisualModel<Row>(100, nodeAt, loaded);
		const gap = vm.getByVisualIndex(5)!;
		expect(String(gap.visualRowId)).toBe('v:loading:5');
		expect('rowId' in gap).toBe(false);
	});

	it('locates loaded rows by id and reports visibility', () => {
		const vm = new WindowedVisualModel<Row>(100, nodeAt, loaded);
		expect(vm.indexOfRowId(asRowId('r11'))).toBe(11);
		expect(vm.isVisible(asRowId('r11'))).toBe(true);
		expect(vm.isVisible(asRowId('r99'))).toBe(false);
	});

	it('out-of-range indices return null', () => {
		const vm = new WindowedVisualModel<Row>(100, nodeAt, loaded);
		expect(vm.getByVisualIndex(-1)).toBeNull();
		expect(vm.getByVisualIndex(100)).toBeNull();
	});
});

describe('RowPipeline windowed mode (infinite/server)', () => {
	it('produces a windowed model with data + loading rows, ignoring client sort/filter', () => {
		const pipeline = new RowPipeline<Row>(() => loaded, {
			getTotalRowCount: () => 50,
			getNodeByIndex: nodeAt,
		});
		pipeline.recompute();
		const vm = pipeline.getVisualModel();
		expect(vm.count).toBe(50);
		expect(vm.getByVisualIndex(0)!.kind).toBe('loading');
		expect(vm.getByVisualIndex(10)!.kind).toBe('data');
	});
});

import { describe, expect, it } from 'vitest';
import { asColumnId } from '../columns/ColumnId.js';
import { ClientRowModel } from '../rows/client/ClientRowModel.js';
import { rowChangeSet } from '../rows/RowChangeSet.js';
import { asRowId } from '../rows/RowId.js';
import type { ColumnId } from '../columns/ColumnId.js';
import type { RowId } from '../rows/RowId.js';
import type { FilterModel, SortModel } from './PipelineModels.js';
import { RowPipeline } from './RowPipeline.js';

interface Person {
	id: string;
	name: string;
	age: number;
	status: string;
}

const seed: Person[] = [
	{ id: 'a', name: 'Ann', age: 30, status: 'active' },
	{ id: 'b', name: 'Bob', age: 25, status: 'inactive' },
	{ id: 'c', name: 'Cyd', age: 40, status: 'active' },
];

function makePipeline() {
	const model = new ClientRowModel<Person>((r) => r.id);
	model.commands.replaceRows(seed);
	const pipeline = new RowPipeline<Person>(() => model.getRows());
	pipeline.recompute();
	return { model, pipeline };
}

const ageAsc: SortModel = [{ columnId: asColumnId('age'), field: 'age', direction: 'asc' }];
const onlyActive: FilterModel = [{ columnId: asColumnId('status'), field: 'status', operator: 'equals', value: 'active' }];

describe('RowPipeline — rows → visual model (ARCHITECTURE.md §3 R6)', () => {
	it('with no sort/filter, the visual model mirrors source order', () => {
		const { pipeline } = makePipeline();
		expect(
			pipeline
				.getVisualModel()
				.toArray()
				.map((r) => (r.kind === 'data' ? r.rowId : null))
		).toEqual(['a', 'b', 'c']);
	});

	it('data visual rows carry distinct VisualRowId and RowId (R5)', () => {
		const { pipeline } = makePipeline();
		const first = pipeline.getVisualModel().toArray()[0]!;
		expect(first.kind).toBe('data');
		if (first.kind !== 'data') return;
		expect(String(first.rowId)).toBe('a');
		expect(String(first.visualRowId)).toBe('v:data:a');
		expect(String(first.visualRowId)).not.toBe(String(first.rowId));
	});

	it('sort reorders the visual model', () => {
		const { pipeline } = makePipeline();
		pipeline.setSortModel(ageAsc);
		expect(
			pipeline
				.getVisualModel()
				.toArray()
				.map((r) => (r.kind === 'data' ? r.rowId : null))
		).toEqual(['b', 'a', 'c']);
	});

	it('filter changes membership and indexOfRowId reflects visibility', () => {
		const { pipeline } = makePipeline();
		pipeline.setFilterModel(onlyActive);
		const vm = pipeline.getVisualModel();
		expect(vm.count).toBe(2);
		expect(vm.isVisible(asRowId('b'))).toBe(false);
		expect(vm.indexOfRowId(asRowId('c'))).toBe(1);
	});

	it('classify uses the active models (R7): age edit → sort-key, status edit → filter-key', () => {
		const { pipeline } = makePipeline();
		pipeline.setSortModel(ageAsc);
		pipeline.setFilterModel(onlyActive);

		const ageChange = rowChangeSet<Person>({
			changedFieldsByRow: new Map<RowId, ReadonlySet<ColumnId>>([[asRowId('a'), new Set([asColumnId('age')])]]),
		});
		const statusChange = rowChangeSet<Person>({
			changedFieldsByRow: new Map<RowId, ReadonlySet<ColumnId>>([[asRowId('a'), new Set([asColumnId('status')])]]),
		});
		const structural = rowChangeSet<Person>({ added: [{ id: asRowId('z'), sourceIndex: 3, data: seed[0]! }] });

		expect(pipeline.classify(ageChange)).toBe('sort-key');
		expect(pipeline.classify(statusChange)).toBe('filter-key');
		expect(pipeline.classify(structural)).toBe('structural');
	});
});

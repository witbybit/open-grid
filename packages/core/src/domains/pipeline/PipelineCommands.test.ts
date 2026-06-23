import { describe, expect, it } from 'vitest';
import { GridKernel } from '../../kernel/GridKernel.js';
import type { GridEvent } from '../../kernel/GridEvent.js';
import { asColumnId } from '../columns/ColumnId.js';
import { ClientRowModel } from '../rows/client/ClientRowModel.js';
import type { SortModel } from './PipelineModels.js';
import { registerPipelineCommands } from './PipelineCommands.js';
import { RowPipeline } from './RowPipeline.js';

interface Person {
	id: string;
	age: number;
}

const seed: Person[] = [
	{ id: 'a', age: 30 },
	{ id: 'b', age: 25 },
];

function setup() {
	const kernel = new GridKernel();
	const model = new ClientRowModel<Person>((r) => r.id);
	model.commands.replaceRows(seed);
	const pipeline = new RowPipeline<Person>(() => model.getRows());
	pipeline.recompute();
	registerPipelineCommands(kernel, pipeline);
	return { kernel, pipeline };
}

const ageAsc: SortModel = [{ columnId: asColumnId('age'), field: 'age', direction: 'asc' }];

describe('registerPipelineCommands — kernel integration (ARCHITECTURE.md §3 R1, R6)', () => {
	it('pipeline.setSortModel reorders the visual model, bumps pipeline, emits pipeline.changed', () => {
		const { kernel, pipeline } = setup();
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));

		const result = kernel.dispatch({ type: 'pipeline.setSortModel', payload: { model: ageAsc } });

		expect(result.status).toBe('applied');
		expect(kernel.getVersion('pipeline')).toBe(1);
		expect(events.some((e) => e.type === 'pipeline.changed')).toBe(true);
		expect(pipeline.getVisualModel().rows.map((r) => (r.kind === 'data' ? String(r.rowId) : null))).toEqual(['b', 'a']);
	});

	it('pipeline.setFilterModel changes membership', () => {
		const { kernel, pipeline } = setup();
		const result = kernel.dispatch({
			type: 'pipeline.setFilterModel',
			payload: { model: [{ columnId: asColumnId('age'), field: 'age', predicate: (v) => Number(v) >= 30 }] },
		});
		expect(result.status).toBe('applied');
		expect(pipeline.getVisualModel().count).toBe(1);
	});
});

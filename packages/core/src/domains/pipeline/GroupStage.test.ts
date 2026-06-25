import { describe, expect, it } from 'vitest';
import { asColumnId } from '../columns/ColumnId.js';
import { ClientRowModel } from '../rows/client/ClientRowModel.js';
import type { GroupByModel } from './GroupModel.js';
import { RowPipeline } from './RowPipeline.js';
import type { VisualRow } from './VisualRow.js';

interface Person {
	id: string;
	team: string;
	city: string;
	name: string;
}

const seed: Person[] = [
	{ id: 'a', team: 'Eng', city: 'Oslo', name: 'Ann' },
	{ id: 'b', team: 'Eng', city: 'Oslo', name: 'Bob' },
	{ id: 'c', team: 'Eng', city: 'Rome', name: 'Cyd' },
	{ id: 'd', team: 'Sales', city: 'Rome', name: 'Dee' },
];

function makePipeline() {
	const model = new ClientRowModel<Person>((r) => r.id);
	model.commands.replaceRows(seed);
	const pipeline = new RowPipeline<Person>(() => model.getRows());
	pipeline.recompute();
	return pipeline;
}

const byTeam: GroupByModel = [{ columnId: asColumnId('team'), field: 'team' }];
const byTeamCity: GroupByModel = [
	{ columnId: asColumnId('team'), field: 'team' },
	{ columnId: asColumnId('city'), field: 'city' },
];

function shape(rows: readonly VisualRow<Person>[]): string[] {
	return rows.map((r) => {
		if (r.kind === 'group') return `G${r.depth}:${String(r.value)}(${r.count})`;
		if (r.kind === 'data') return `D:${String(r.rowId)}`;
		return r.kind;
	});
}

describe('GroupStage / RowPipeline grouping (ARCHITECTURE.md §3 R5–R6)', () => {
	it('emits group rows interleaved with their data rows (single level)', () => {
		const p = makePipeline();
		p.setGroupBy(byTeam);
		expect(shape(p.getVisualModel().toArray())).toEqual(['G0:Eng(3)', 'D:a', 'D:b', 'D:c', 'G0:Sales(1)', 'D:d']);
	});

	it('nests multi-level groups with descendant leaf counts', () => {
		const p = makePipeline();
		p.setGroupBy(byTeamCity);
		expect(shape(p.getVisualModel().toArray())).toEqual([
			'G0:Eng(3)',
			'G1:Oslo(2)',
			'D:a',
			'D:b',
			'G1:Rome(1)',
			'D:c',
			'G0:Sales(1)',
			'G1:Rome(1)',
			'D:d',
		]);
	});

	it('collapsing a group hides its subtree but keeps the header', () => {
		const p = makePipeline();
		p.setGroupBy(byTeam);
		p.toggleGroup('Eng'); // collapse
		const rows = p.getVisualModel().toArray();
		expect(shape(rows)).toEqual(['G0:Eng(3)', 'G0:Sales(1)', 'D:d']);
		expect(rows[0]!.kind === 'group' && rows[0]!.expanded).toBe(false);
	});

	it('a group visual row id is distinct from any data row id (R5)', () => {
		const p = makePipeline();
		p.setGroupBy(byTeam);
		const group = p
			.getVisualModel()
			.toArray()
			.find((r) => r.kind === 'group')!;
		expect(String(group.visualRowId)).toBe('v:group:Eng');
	});

	it('clearing group-by returns to a flat data projection', () => {
		const p = makePipeline();
		p.setGroupBy(byTeam);
		p.setGroupBy([]);
		expect(shape(p.getVisualModel().toArray())).toEqual(['D:a', 'D:b', 'D:c', 'D:d']);
	});
});

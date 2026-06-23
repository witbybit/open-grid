import { describe, expect, it } from 'vitest';
import { computeColumnLayout } from '../columns/ColumnLayout.js';
import { ColumnModel } from '../columns/ColumnModel.js';
import { LayoutSnapshot } from '../layout/LayoutSnapshot.js';
import { RowHeightModel } from '../layout/RowHeightModel.js';
import { RowPipeline } from '../pipeline/RowPipeline.js';
import { ClientRowModel } from '../rows/client/ClientRowModel.js';
import { computeVisibleWindow } from '../viewport/VisibleWindow.js';
import { buildRenderPlan } from './RenderPlan.js';

interface Person {
	id: string;
	name: string;
}

function fixture(count: number) {
	const rows = Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `N${i}` }));
	const model = new ClientRowModel<Person>((r) => r.id);
	model.commands.replaceRows(rows);
	const pipeline = new RowPipeline<Person>(() => model.getRows());
	const visual = pipeline.recompute();

	const columns = new ColumnModel<Person>([{ id: 'name', field: 'name', width: 120 }]);
	const heights = new RowHeightModel(visual.count, 40);
	const layout = new LayoutSnapshot(heights, computeColumnLayout(columns));
	return { model, visual, columns, heights, layout };
}

describe('buildRenderPlan (ARCHITECTURE.md §3 R12)', () => {
	it('emits only windowed rows with absolute top/height and resolved cells', () => {
		const { model, visual, columns, heights, layout } = fixture(100);
		const window = computeVisibleWindow(heights, 400, 200, 0); // rows 10..15

		const plan = buildRenderPlan(visual, layout, window, {
			getField: (id) => columns.getField(id) ?? String(id),
			getCellValue: (rowId, field) => model.query.getRowById(rowId)?.data[field as 'name'],
		});

		expect(plan.rows[0]!.top).toBe(400);
		expect(plan.rows[0]!.height).toBe(40);
		expect(plan.rows.map((r) => String(r.rowId))).toEqual(['r10', 'r11', 'r12', 'r13', 'r14', 'r15']);
		expect(plan.totalHeight).toBe(4000);

		const firstCell = plan.rows[0]!.cells[0]!;
		expect(firstCell.left).toBe(0);
		expect(firstCell.width).toBe(120);
		expect(firstCell.value).toBe('N10');
	});

	it('total width comes from the column layout; cells map to visible columns only', () => {
		const { visual, layout, heights } = fixture(3);
		const plan = buildRenderPlan(visual, layout, computeVisibleWindow(heights, 0, 1000));
		expect(plan.totalWidth).toBe(120);
		expect(plan.rows).toHaveLength(3);
		expect(plan.rows[0]!.cells).toHaveLength(1);
	});
});

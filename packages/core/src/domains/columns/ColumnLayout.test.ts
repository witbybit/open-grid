import { describe, expect, it } from 'vitest';
import { computeColumnLayout } from './ColumnLayout.js';
import { asColumnId } from './ColumnId.js';
import { ColumnModel } from './ColumnModel.js';

const A = asColumnId('a');
const B = asColumnId('b');
const C = asColumnId('c');

describe('computeColumnLayout — derived layout snapshot (ARCHITECTURE.md §3 R6, R12)', () => {
	it('splits columns into pinned-left / center / pinned-right lanes with running offsets', () => {
		const model = new ColumnModel([
			{ id: 'a', width: 100, pinned: 'left' },
			{ id: 'b', width: 120 },
			{ id: 'c', width: 80, pinned: 'right' },
		]);
		const layout = computeColumnLayout(model);

		expect(layout.leftWidth).toBe(100);
		expect(layout.centerWidth).toBe(120);
		expect(layout.rightWidth).toBe(80);
		expect(layout.totalWidth).toBe(300);

		const byId = new Map(layout.entries.map((e) => [e.columnId, e]));
		expect(byId.get(A)).toMatchObject({ lane: 'left', left: 0, width: 100 });
		expect(byId.get(B)).toMatchObject({ lane: 'center', left: 0, width: 120 });
		expect(byId.get(C)).toMatchObject({ lane: 'right', left: 0, width: 80 });
	});

	it('excludes hidden columns and accumulates left offsets within the center lane', () => {
		const model = new ColumnModel([
			{ id: 'a', width: 100 },
			{ id: 'b', width: 120, hidden: true },
			{ id: 'c', width: 80 },
		]);
		const layout = computeColumnLayout(model);
		expect(layout.entries.map((e) => e.columnId)).toEqual([A, C]);
		expect(layout.entries.map((e) => e.left)).toEqual([0, 100]);
		expect(layout.totalWidth).toBe(180);
	});
});

import { describe, expect, it } from 'vitest';
import { asColumnId } from './ColumnId.js';
import type { ColumnDef } from './ColumnDef.js';
import { ColumnModel } from './ColumnModel.js';

const defs: ColumnDef[] = [
	{ id: 'a', field: 'a', width: 100, minWidth: 60, maxWidth: 300 },
	{ id: 'b', field: 'b', width: 120 },
	{ id: 'c', field: 'c', width: 80 },
];

const A = asColumnId('a');
const B = asColumnId('b');
const C = asColumnId('c');

describe('ColumnModel — view state & commands (ARCHITECTURE.md §3 R11)', () => {
	it('resize clamps to min/max and no-ops on an unchanged width', () => {
		const model = new ColumnModel(defs);
		expect(model.resize(A, 500).resized).toEqual([A]); // clamps to 300
		expect(model.getWidth(A)).toBe(300);
		expect(model.resize(A, 10).resized).toEqual([A]); // clamps to 60
		expect(model.getWidth(A)).toBe(60);
		const noop = model.resize(A, 60);
		expect(noop.resized).toEqual([]);
	});

	it('move reorders columns', () => {
		const model = new ColumnModel(defs);
		model.move(C, 0);
		expect(model.getColumnIds()).toEqual([C, A, B]);
	});

	it('setVisible hides and shows', () => {
		const model = new ColumnModel(defs);
		model.setVisible(B, false);
		expect(model.isHidden(B)).toBe(true);
		expect(model.getVisibleColumnIds()).toEqual([A, C]);
	});

	it('setPinned pins a column', () => {
		const model = new ColumnModel(defs);
		expect(model.setPinned(A, 'left').pinnedChanged).toEqual([A]);
		expect(model.getPinned(A)).toBe('left');
	});

	it('getState/setState round-trips order, width, hidden, pinned', () => {
		const model = new ColumnModel(defs);
		model.move(C, 0);
		model.resize(A, 200);
		model.setVisible(B, false);
		model.setPinned(C, 'left');
		const state = model.getState();

		const restored = new ColumnModel(defs);
		restored.setState(state);
		expect(restored.getColumnIds()).toEqual([C, A, B]);
		expect(restored.getWidth(A)).toBe(200);
		expect(restored.isHidden(B)).toBe(true);
		expect(restored.getPinned(C)).toBe('left');
	});

	it('resolves a value setter from the column def', () => {
		const setter = () => true;
		const model = new ColumnModel([{ id: 'a', valueSetter: setter }]);
		expect(model.getValueSetter(A)).toBe(setter);
	});
});

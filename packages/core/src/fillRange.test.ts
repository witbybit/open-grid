import { describe, it, expect } from 'vitest';
import { GridStore } from './store.js';
import { ClientRowModelController } from './rowModel.js';

type FillRangeRow = {
	id: string;
	value?: number;
	text?: string;
	val?: number;
	formula?: string;
};

describe('Spreadsheet fill range sequence extrapolation and reference shifting', () => {
	it('should extrapolate arithmetic numeric sequences vertically', () => {
		const store = new GridStore<FillRangeRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'value', header: 'Value', width: 100 },
			],
		});
		const controller = new ClientRowModelController<FillRangeRow>(store, {
			rows: [
				{ id: 'r1', value: 10 },
				{ id: 'r2', value: 20 },
				{ id: 'r3', value: 0 },
				{ id: 'r4', value: 0 },
			],
			columns: store.getState().columns,
		});

		// Source range is r1:value to r2:value (values 10, 20)
		// Target range is r3:value to r4:value
		store.engine.fillRange(
			{
				start: { rowId: 'r1', colField: 'value' },
				end: { rowId: 'r2', colField: 'value' },
			},
			{
				start: { rowId: 'r3', colField: 'value' },
				end: { rowId: 'r4', colField: 'value' },
			}
		);

		expect(store.getCellValue('r3', 'value')).toBe(30);
		expect(store.getCellValue('r4', 'value')).toBe(40);

		controller.dispose();
	});

	it('should repeat cyclical text sequences vertically', () => {
		const store = new GridStore<FillRangeRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'text', header: 'Text', width: 100 },
			],
		});
		const controller = new ClientRowModelController<FillRangeRow>(store, {
			rows: [
				{ id: 'r1', text: 'A' },
				{ id: 'r2', text: 'B' },
				{ id: 'r3', text: '' },
				{ id: 'r4', text: '' },
				{ id: 'r5', text: '' },
			],
			columns: store.getState().columns,
		});

		store.engine.fillRange(
			{
				start: { rowId: 'r1', colField: 'text' },
				end: { rowId: 'r2', colField: 'text' },
			},
			{
				start: { rowId: 'r3', colField: 'text' },
				end: { rowId: 'r5', colField: 'text' },
			}
		);

		expect(store.getCellValue('r3', 'text')).toBe('A');
		expect(store.getCellValue('r4', 'text')).toBe('B');
		expect(store.getCellValue('r5', 'text')).toBe('A');

		controller.dispose();
	});

	it('should shift formula references relatively during vertical fill', () => {
		const store = new GridStore<FillRangeRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'val', header: 'Val', width: 100 },
				{ field: 'formula', header: 'Formula', width: 100 },
			],
		});
		const controller = new ClientRowModelController<FillRangeRow>(store, {
			rows: [
				{ id: 'r1', val: 5, formula: '' },
				{ id: 'r2', val: 10, formula: '' },
				{ id: 'r3', val: 15, formula: '' },
				{ id: 'r4', val: 20, formula: '' },
			],
			columns: store.getState().columns,
		});

		// Register formula in r1:formula depending on r1:val
		store.setCellValue('r1', 'formula', '=[r1:val]*2');

		// Fill from r1:formula to r2:formula .. r4:formula
		store.engine.fillRange(
			{
				start: { rowId: 'r1', colField: 'formula' },
				end: { rowId: 'r1', colField: 'formula' },
			},
			{
				start: { rowId: 'r2', colField: 'formula' },
				end: { rowId: 'r4', colField: 'formula' },
			}
		);

		// The formulas should be shifted relatively
		expect(store.getCellState('r2', 'formula').value).toBe('=[r2:val]*2');
		expect(store.getCellState('r3', 'formula').value).toBe('=[r3:val]*2');
		expect(store.getCellState('r4', 'formula').value).toBe('=[r4:val]*2');

		// The cell values should be recalculated correctly by the DAG engine
		expect(store.getCellValue('r2', 'formula')).toBe(20);
		expect(store.getCellValue('r3', 'formula')).toBe(30);
		expect(store.getCellValue('r4', 'formula')).toBe(40);

		controller.dispose();
	});

	it('should support undo and redo operations on programmatic range filling', () => {
		const store = new GridStore<FillRangeRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'val', header: 'Val', width: 100 },
			],
		});
		const controller = new ClientRowModelController<FillRangeRow>(store, {
			rows: [
				{ id: 'r1', val: 10 },
				{ id: 'r2', val: 20 },
				{ id: 'r3', val: 0 },
			],
			columns: store.getState().columns,
		});

		store.engine.fillRange(
			{
				start: { rowId: 'r1', colField: 'val' },
				end: { rowId: 'r2', colField: 'val' },
			},
			{
				start: { rowId: 'r3', colField: 'val' },
				end: { rowId: 'r3', colField: 'val' },
			}
		);

		expect(store.getCellValue('r3', 'val')).toBe(30);

		// Undo the action
		store.undo();
		expect(store.getCellValue('r3', 'val')).toBe(0);

		// Redo the action
		store.redo();
		expect(store.getCellValue('r3', 'val')).toBe(30);

		controller.dispose();
	});
});

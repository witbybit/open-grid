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
		const controller = new ClientRowModelController<FillRangeRow>(store.getClientRowModelRuntime(), {
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
		const controller = new ClientRowModelController<FillRangeRow>(store.getClientRowModelRuntime(), {
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
		const controller = new ClientRowModelController<FillRangeRow>(store.getClientRowModelRuntime(), {
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
		const controller = new ClientRowModelController<FillRangeRow>(store.getClientRowModelRuntime(), {
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

	it('should extrapolate arithmetic numeric sequences horizontally', () => {
		const store = new GridStore<FillRangeRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'c1', header: 'C1', width: 100 },
				{ field: 'c2', header: 'C2', width: 100 },
				{ field: 'c3', header: 'C3', width: 100 },
				{ field: 'c4', header: 'C4', width: 100 },
			],
		});
		const controller = new ClientRowModelController<FillRangeRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: 'r1', c1: 10, c2: 20, c3: 0, c4: 0 } as any],
			columns: store.getState().columns,
		});

		store.engine.fillRange(
			{
				start: { rowId: 'r1', colField: 'c1' },
				end: { rowId: 'r1', colField: 'c2' },
			},
			{
				start: { rowId: 'r1', colField: 'c3' },
				end: { rowId: 'r1', colField: 'c4' },
			}
		);

		expect(store.getCellValue('r1', 'c3')).toBe(30);
		expect(store.getCellValue('r1', 'c4')).toBe(40);

		controller.dispose();
	});

	it('should shift formula references relatively during horizontal fill', () => {
		const store = new GridStore<FillRangeRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'val1', header: 'Val1', width: 100 },
				{ field: 'val2', header: 'Val2', width: 100 },
				{ field: 'val3', header: 'Val3', width: 100 },
				{ field: 'formula1', header: 'Formula1', width: 100 },
				{ field: 'formula2', header: 'Formula2', width: 100 },
				{ field: 'formula3', header: 'Formula3', width: 100 },
			],
		});
		const controller = new ClientRowModelController<FillRangeRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: 'r1', val1: 5, val2: 10, val3: 15, formula1: '', formula2: '', formula3: '' } as any],
			columns: store.getState().columns,
		});

		store.setCellValue('r1', 'formula1', '=[r1:val1]*3');

		store.engine.fillRange(
			{
				start: { rowId: 'r1', colField: 'formula1' },
				end: { rowId: 'r1', colField: 'formula1' },
			},
			{
				start: { rowId: 'r1', colField: 'formula2' },
				end: { rowId: 'r1', colField: 'formula3' },
			}
		);

		expect(store.getCellState('r1', 'formula2').value).toBe('=[r1:val2]*3');
		expect(store.getCellState('r1', 'formula3').value).toBe('=[r1:val3]*3');

		expect(store.getCellValue('r1', 'formula2')).toBe(30);
		expect(store.getCellValue('r1', 'formula3')).toBe(45);

		controller.dispose();
	});
});

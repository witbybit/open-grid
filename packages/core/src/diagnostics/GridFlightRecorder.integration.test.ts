import { describe, expect, it, vi } from 'vitest';
import { createClientGrid } from '../createGrid.js';
import { GridEventName } from '../api/GridEvents.js';
import {
	clearFlightRecorder,
	explainFlightRecorderCell,
	getFlightRecorderSnapshot,
	startFlightRecorder,
	stopFlightRecorder,
} from '../flightRecorderExperimental.js';

interface Row {
	id: string;
	value: number;
	other: number;
}

function grid() {
	return createClientGrid<Row>({
		getRowId: (row) => row.id,
		columns: [
			{ field: 'value', header: 'Value' },
			{ field: 'other', header: 'Other' },
		],
		rows: [
			{ id: 'r:雪\0', value: 1, other: 2 },
			{ id: 'source', value: 1, other: 0 },
			{ id: 'formula', value: 0, other: 0 },
		],
	});
}

describe('experimental causal flight-recorder integration', () => {
	it('captures accepted, rejected, batch, formula-derived, and fault signals without raw values by default', () => {
		const api = grid();
		startFlightRecorder(api, { capacity: 64 });
		api.addEventListener(GridEventName.cellValueChanged, () => {
			throw new Error('safe-message');
		});
		expect(api.setCellValue('r:雪\0', 'value', 3).status).toBe('applied');
		expect(api.setCellValue('missing', 'value', 7).status).not.toBe('applied');
		api.batchCellValues([
			{ rowId: 'r:雪\0', colField: 'value', value: 4 },
			{ rowId: 'r:雪\0', colField: 'other', value: 5 },
		]);
		api.setFormula('formula', 'other', '=[source:value]*2');
		const formulaSequence = getFlightRecorderSnapshot(api).events.at(-1)?.sequence ?? 0;
		api.setCellValue('source', 'value', 6);
		const snapshot = getFlightRecorderSnapshot(api);
		const types = snapshot.events.map((entry) => entry.event.type);
		expect(types).toContain('commit-request');
		expect(types).toContain('commit-outcome');
		expect(types).toContain('cell-change');
		expect(types).toContain('fault');
		expect(snapshot.events.filter((entry) => entry.event.type === 'cell-change').every((entry) => !('value' in entry.event))).toBe(true);
		const explanation = explainFlightRecorderCell(api, 'r:雪\0', 'value');
		expect(explanation.lastChange.status).toBe('known');
		expect(explanation.commit.status).toBe('known');
		expect(explanation.invalidation.status).toBe('known');
		expect(
			snapshot.events.some(
				(entry) =>
					entry.sequence > formulaSequence &&
					entry.event.type === 'cell-change' &&
					entry.event.cell.rowId === 'formula' &&
					entry.event.cell.colField === 'other'
			)
		).toBe(true);
		api.destroy();
	});

	it('is instance-local, clearable, stoppable, and destroy-terminal', () => {
		const first = grid();
		const second = grid();
		startFlightRecorder(first, { capacity: 4 });
		first.setCellValue('r:雪\0', 'value', 9);
		second.setCellValue('r:雪\0', 'value', 8);
		expect(getFlightRecorderSnapshot(first).events.length).toBeGreaterThan(0);
		expect(getFlightRecorderSnapshot(second).events).toEqual([]);
		const stopped = stopFlightRecorder(first);
		expect(Object.isFrozen(stopped)).toBe(true);
		expect(stopped.active).toBe(false);
		const stoppedCount = stopped.events.length;
		first.setCellValue('r:雪\0', 'value', 10);
		expect(getFlightRecorderSnapshot(first).events).toHaveLength(stoppedCount);
		clearFlightRecorder(first);
		expect(getFlightRecorderSnapshot(first).events).toEqual([]);
		first.destroy();
		startFlightRecorder(first);
		expect(getFlightRecorderSnapshot(first).active).toBe(false);
		second.destroy();
	});

	it('runs redaction before full-value storage and isolates redactor faults', () => {
		const api = grid();
		const redactor = vi.fn(() => 'masked');
		startFlightRecorder(api, { captureValues: 'full', redactValue: redactor });
		api.setCellValue('r:雪\0', 'value', 99);
		expect(redactor).toHaveBeenCalled();
		const values = getFlightRecorderSnapshot(api)
			.events.filter((entry) => entry.event.type === 'cell-change')
			.map((entry) => (entry.event.type === 'cell-change' ? entry.event.value : undefined));
		expect(values).toContainEqual({ mode: 'full', value: 'masked' });
		expect(values.some((value) => value?.mode === 'full' && value.value === 99)).toBe(false);
		api.destroy();
	});
});

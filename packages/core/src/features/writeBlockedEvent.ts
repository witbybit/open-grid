import { GridEventName, type GridWriteBlockedEventPayload, type GridWriteBlockedSource } from '../api/GridEvents.js';
import type { GridWriteResult } from '../api/GridApi.js';

type WriteBlockedResult = Extract<GridWriteResult, { status: 'validationFailed' | 'capabilityDenied' | 'rejected' }>;

export function isWriteBlockedResult(result: GridWriteResult): result is WriteBlockedResult {
	return result.status === 'validationFailed' || result.status === 'capabilityDenied' || result.status === 'rejected';
}

export function createWriteBlockedEventPayload(
	source: GridWriteBlockedSource,
	result: WriteBlockedResult,
	cells: ReadonlyArray<{ rowId: string; colField: string }>
): GridWriteBlockedEventPayload {
	const rowIds = new Set<string>();
	const colFields = new Set<string>();
	for (const cell of cells) {
		rowIds.add(cell.rowId);
		colFields.add(cell.colField);
	}
	return {
		source,
		status: result.status,
		reason: result.reason,
		cells,
		rowCount: rowIds.size,
		colCount: colFields.size,
		issues: result.status === 'validationFailed' ? result.issues : undefined,
	};
}

export function dispatchWriteBlockedEvent(
	dispatchEvent: (type: GridEventName.writeBlocked, payload: GridWriteBlockedEventPayload) => void,
	source: GridWriteBlockedSource,
	result: WriteBlockedResult,
	cells: ReadonlyArray<{ rowId: string; colField: string }>
): void {
	dispatchEvent(GridEventName.writeBlocked, createWriteBlockedEventPayload(source, result, cells));
}

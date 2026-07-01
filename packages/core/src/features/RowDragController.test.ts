// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RowDragController } from './RowDragController.js';
import { GridEventName } from '../api/GridEvents.js';
import type { ManagedRowDragPolicyResult } from '../engine/GridEngine.js';
import type { GridWriteResult } from '../api/GridApi.js';

interface TestRow {
	id: string;
	name: string;
}

function makePointerEvent(type: string, options: { clientX?: number; clientY?: number; button?: number; pointerId?: number } = {}): PointerEvent {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: options.clientX ?? 0,
		clientY: options.clientY ?? 0,
		button: options.button ?? 0,
	}) as PointerEvent;
	Object.defineProperty(event, 'pointerId', { value: options.pointerId ?? 1 });
	return event;
}

function makeRowDom(rowIds: string[]): {
	container: HTMLElement;
	scrollViewport: HTMLElement;
	handles: Record<string, HTMLElement>;
	rows: Record<string, HTMLElement>;
} {
	const scrollViewport = document.createElement('div');
	const container = document.createElement('div');
	scrollViewport.appendChild(container);
	document.body.appendChild(scrollViewport);

	const handles: Record<string, HTMLElement> = {};
	const rows: Record<string, HTMLElement> = {};

	Object.defineProperty(scrollViewport, 'getBoundingClientRect', {
		value: () => ({ top: 0, bottom: 120, left: 0, right: 300, width: 300, height: 120 }),
	});
	Object.defineProperty(container, 'getBoundingClientRect', {
		value: () => ({ top: 0, bottom: 120, left: 0, right: 300, width: 300, height: 120 }),
	});

	rowIds.forEach((rowId, index) => {
		const row = document.createElement('div');
		row.className = 'og-row';
		const cell = document.createElement('div');
		cell.dataset.rowId = rowId;
		const handle = document.createElement('button');
		handle.dataset.dragRowId = rowId;
		row.appendChild(cell);
		row.appendChild(handle);
		container.appendChild(row);
		rows[rowId] = row;
		handles[rowId] = handle;
		Object.defineProperty(row, 'getBoundingClientRect', {
			value: () => ({ top: index * 40, bottom: index * 40 + 40, left: 0, right: 300, width: 300, height: 40 }),
		});
	});

	return { container, scrollViewport, handles, rows };
}

function makeEngine(
	options: {
		policy?: ManagedRowDragPolicyResult;
		rowDragMode?: 'managed' | 'unmanaged';
		rowOrderCapable?: boolean;
		setRowOrderResult?: GridWriteResult;
	} = {}
) {
	const rows = new Map<string, TestRow>([
		['r1', { id: 'r1', name: 'Alpha' }],
		['r2', { id: 'r2', name: 'Beta' }],
		['r3', { id: 'r3', name: 'Gamma' }],
	]);
	let rowOrder = ['r1', 'r2', 'r3'];
	const baseRowModel = {
		getVisualIndexByRowId: (rowId: string) => rowOrder.indexOf(rowId),
		getRawRowById: (rowId: string) => rows.get(rowId) ?? null,
		getVisualRow: (index: number) => (index >= 0 && index < rowOrder.length ? ({ id: rowOrder[index] } as any) : null),
	};
	const rowModel =
		options.rowOrderCapable === false ? baseRowModel : { ...baseRowModel, getRowOrder: () => rowOrder.slice(), setRowOrder: vi.fn() };
	const dispatchEvent = vi.fn();
	const report = vi.fn();
	const setRowOrder = vi.fn((nextOrder: string[]) => {
		rowOrder = nextOrder.slice();
		return options.setRowOrderResult ?? ({ status: 'applied', changeId: 1, faults: [] } satisfies GridWriteResult);
	});
	const policy = options.policy ?? ({ allowed: true } satisfies ManagedRowDragPolicyResult);
	const engine = {
		getRowModel: () => rowModel,
		getManagedRowDragPolicy: vi.fn(() => policy),
		stateManager: {
			getState: () => ({
				defaultRowHeight: 40,
				rowDragMode: options.rowDragMode ?? 'managed',
				sortModel: null,
			}),
		},
		geometry: {
			getRowHeight: () => 40,
			getRowTop: (index: number) => index * 40,
		},
		eventBus: { dispatchEvent },
		runtimeFaults: { report },
		setRowOrder,
	} as any;

	return { engine, dispatchEvent, report, setRowOrder, getRowOrder: () => rowOrder.slice() };
}

function mockElementFromPoint(element: Element | null): void {
	Object.defineProperty(document, 'elementFromPoint', {
		configurable: true,
		value: vi.fn(() => element),
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('RowDragController', () => {
	it('waits for the activation threshold before starting drag', () => {
		const { container, scrollViewport, handles } = makeRowDom(['r1', 'r2', 'r3']);
		const { engine, dispatchEvent } = makeEngine();
		const controller = new RowDragController(engine);
		controller.mount(container, scrollViewport);

		handles.r1.dispatchEvent(makePointerEvent('pointerdown', { clientY: 10 }));
		document.dispatchEvent(makePointerEvent('pointermove', { clientY: 12 }));

		expect(dispatchEvent).not.toHaveBeenCalledWith(GridEventName.rowDragStart, expect.anything());
		expect(container.classList.contains('og-row-dragging')).toBe(false);

		controller.unmount();
	});

	it('cancels an active drag on Escape without emitting rowDragEnd', () => {
		const { container, scrollViewport, handles } = makeRowDom(['r1', 'r2', 'r3']);
		const { engine, dispatchEvent } = makeEngine();
		const controller = new RowDragController(engine);
		controller.mount(container, scrollViewport);
		mockElementFromPoint(container.querySelector('.og-row'));

		handles.r1.dispatchEvent(makePointerEvent('pointerdown', { clientY: 10 }));
		document.dispatchEvent(makePointerEvent('pointermove', { clientX: 5, clientY: 20 }));
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

		expect(dispatchEvent).toHaveBeenCalledWith(GridEventName.rowDragCancelled, expect.objectContaining({ rowId: 'r1' }));
		expect(dispatchEvent).not.toHaveBeenCalledWith(GridEventName.rowDragEnd, expect.anything());

		controller.unmount();
	});

	it('commits managed row reorder through the canonical engine path on a flat client grid', () => {
		const { container, scrollViewport, handles, rows } = makeRowDom(['r1', 'r2', 'r3']);
		const { engine, dispatchEvent, setRowOrder, getRowOrder } = makeEngine();
		const controller = new RowDragController(engine);
		controller.mount(container, scrollViewport);
		mockElementFromPoint(rows.r3);

		handles.r1.dispatchEvent(makePointerEvent('pointerdown', { clientX: 5, clientY: 10 }));
		document.dispatchEvent(makePointerEvent('pointermove', { clientX: 5, clientY: 20 }));
		document.dispatchEvent(makePointerEvent('pointerup', { clientX: 5, clientY: 90 }));

		expect(setRowOrder).toHaveBeenCalledWith(['r2', 'r1', 'r3'], true, 'rows:drag-reorder');
		expect(getRowOrder()).toEqual(['r2', 'r1', 'r3']);
		expect(dispatchEvent).toHaveBeenCalledWith(
			GridEventName.rowDragEnd,
			expect.objectContaining({ rowId: 'r1', overRowId: 'r3', overVisualIndex: 2 })
		);
		expect(dispatchEvent).not.toHaveBeenCalledWith(GridEventName.rowDragCancelled, expect.anything());

		controller.unmount();
	});

	it('blocks managed drag explicitly when sort-derived policy disallows reorder', () => {
		const { container, scrollViewport, handles } = makeRowDom(['r1', 'r2', 'r3']);
		const { engine, dispatchEvent, report, setRowOrder } = makeEngine({
			policy: { allowed: false, reason: 'sort-active', message: 'Managed row drag is blocked while sort is active.' },
		});
		const controller = new RowDragController(engine);
		controller.mount(container, scrollViewport);

		handles.r1.dispatchEvent(makePointerEvent('pointerdown', { clientY: 10 }));
		document.dispatchEvent(makePointerEvent('pointermove', { clientY: 20 }));

		expect(report).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'renderer',
				operation: 'activate-managed-drag',
				context: expect.objectContaining({ rowId: 'r1', reason: 'sort-active' }),
			})
		);
		expect(dispatchEvent).not.toHaveBeenCalledWith(GridEventName.rowDragStart, expect.anything());
		expect(setRowOrder).not.toHaveBeenCalled();

		controller.unmount();
	});

	it('blocks managed drag on row models without row-order capability', () => {
		const { container, scrollViewport, handles } = makeRowDom(['r1', 'r2', 'r3']);
		const { engine, report, setRowOrder } = makeEngine({
			rowOrderCapable: false,
			policy: {
				allowed: false,
				reason: 'unsupported-row-model',
				message: 'Managed row drag requires a client row model with row-order support.',
			},
		});
		const controller = new RowDragController(engine);
		controller.mount(container, scrollViewport);

		handles.r1.dispatchEvent(makePointerEvent('pointerdown', { clientY: 10 }));
		document.dispatchEvent(makePointerEvent('pointermove', { clientY: 20 }));

		expect(report).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'renderer',
				context: expect.objectContaining({ reason: 'unsupported-row-model' }),
			})
		);
		expect(setRowOrder).not.toHaveBeenCalled();

		controller.unmount();
	});

	it('cancels the drag auto-scroll loop on pointer cancel', () => {
		const { container, scrollViewport, handles, rows } = makeRowDom(['r1', 'r2', 'r3']);
		const { engine } = makeEngine();
		const controller = new RowDragController(engine);
		controller.mount(container, scrollViewport);
		mockElementFromPoint(rows.r2);
		const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 7);
		const cancelRaf = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);

		handles.r1.dispatchEvent(makePointerEvent('pointerdown', { clientX: 5, clientY: 10 }));
		document.dispatchEvent(makePointerEvent('pointermove', { clientX: 5, clientY: 20 }));
		document.dispatchEvent(makePointerEvent('pointermove', { clientX: 5, clientY: 2 }));
		document.dispatchEvent(makePointerEvent('pointercancel', { clientX: 5, clientY: 2 }));

		expect(raf).toHaveBeenCalled();
		expect(cancelRaf).toHaveBeenCalledWith(7);

		controller.unmount();
	});

	it('cancels the drag auto-scroll loop on unmount', () => {
		const { container, scrollViewport, handles, rows } = makeRowDom(['r1', 'r2', 'r3']);
		const { engine } = makeEngine();
		const controller = new RowDragController(engine);
		controller.mount(container, scrollViewport);
		mockElementFromPoint(rows.r2);
		vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 9);
		const cancelRaf = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);

		handles.r1.dispatchEvent(makePointerEvent('pointerdown', { clientX: 5, clientY: 10 }));
		document.dispatchEvent(makePointerEvent('pointermove', { clientX: 5, clientY: 20 }));
		document.dispatchEvent(makePointerEvent('pointermove', { clientX: 5, clientY: 2 }));
		controller.unmount();

		expect(cancelRaf).toHaveBeenCalledWith(9);
	});
});

import { describe, it, expect, vi } from 'vitest';
import { GridChangeApplier, type GridChangeApplierDeps } from './GridChangeApplier.js';
import { StateManager } from '../state/StateManager.js';
import { InvalidationManager } from '../renderer/invalidationManager.js';
import { EventBus } from '../events/EventBus.js';
import { CommandHistory } from '../commands/CommandHistory.js';
import { GridEventName, type GridState } from '../store.js';
import { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';

type TestRow = { id: string; name: string };

function makeApplier(): {
	applier: GridChangeApplier<TestRow>;
	stateManager: StateManager<TestRow>;
	invalidation: InvalidationManager;
	eventBus: EventBus<TestRow>;
	commandHistory: CommandHistory;
	requestRender: ReturnType<typeof vi.fn>;
	incrementDomain: ReturnType<typeof vi.fn>;
	faultReporter: RuntimeFaultReporter<TestRow>;
} {
	const stateManager = new StateManager<TestRow>({
		columns: [],
		selection: { focus: null, anchor: null, range: null, bounds: null, source: 'api' },
		selectedRowIds: [],
		rowHeights: {},
		columnWidths: {},
		defaultRowHeight: 40,
		defaultColWidth: 100,
		enableColumnReorder: true,
		activeEdit: null,
		sortModel: null,
		filterModel: null,
		globalVersion: 0,
		visibleRowRange: { startIdx: 0, endIdx: 0 },
		visibleColRange: { startIdx: 0, endIdx: 0 },
		expansion: { groups: {}, treeRows: {}, details: {} },
		rowOverscanPx: 400,
		colBuffer: 1,
	} as unknown as GridState<TestRow>);

	const invalidation = new InvalidationManager();
	const eventBus = new EventBus<TestRow>();
	const faultReporter = new RuntimeFaultReporter<TestRow>({ log: () => undefined });
	eventBus.setRuntimeFaultReporter(faultReporter);
	const commandHistory = new CommandHistory(faultReporter);
	const requestRender = vi.fn();
	const incrementDomain = vi.fn();

	const deps: GridChangeApplierDeps<TestRow> = {
		stateManager,
		invalidation,
		eventBus,
		commandHistory,
		requestRender,
		incrementDomain,
		faultReporter,
	};

	return {
		applier: new GridChangeApplier(deps),
		stateManager,
		invalidation,
		eventBus,
		commandHistory,
		requestRender,
		incrementDomain,
		faultReporter,
	};
}

describe('GridChangeApplier', () => {
	it('returns a committed result for a state change', () => {
		const { applier, stateManager } = makeApplier();

		const result = applier.apply({
			reason: 'test',
			state: { columnWidths: { name: 200 } },
		});

		expect(result).toEqual({ status: 'committed', changeId: 1 });
		expect(stateManager.getState().columnWidths).toEqual({ name: 200 });
	});

	it('returns noop when there is no work and rendering is suppressed', () => {
		const { applier, requestRender } = makeApplier();

		const result = applier.apply({
			reason: 'noop',
			requestRender: false,
		});

		expect(result).toEqual({ status: 'noop' });
		expect(requestRender).not.toHaveBeenCalled();
	});

	it('rejects precondition failures atomically', () => {
		const { applier, stateManager, requestRender } = makeApplier();

		const result = applier.apply({
			reason: 'precondition',
			precondition: () => 'blocked',
			state: { columnWidths: { name: 250 } },
		});

		expect(result).toEqual({ status: 'rejected', reason: 'blocked' });
		expect(stateManager.getState().columnWidths).toEqual({});
		expect(requestRender).not.toHaveBeenCalled();
	});

	it('applies commit phases in deterministic order: state -> domains -> invalidations -> history -> render -> events', () => {
		const { applier, stateManager, invalidation, eventBus, requestRender, incrementDomain, commandHistory } = makeApplier();
		const callOrder: string[] = [];

		const origSetState = stateManager.setState;
		stateManager.setState = vi.fn((...args) => {
			callOrder.push('state');
			return origSetState(...args);
		});
		incrementDomain.mockImplementation(() => {
			callOrder.push('domains');
		});
		vi.spyOn(invalidation, 'invalidate').mockImplementation(() => {
			callOrder.push('invalidation');
		});
		vi.spyOn(commandHistory, 'add').mockImplementation(() => {
			callOrder.push('history');
		});
		vi.spyOn(eventBus, 'dispatchEvent').mockImplementation(() => {
			callOrder.push('event');
		});
		requestRender.mockImplementation(() => {
			callOrder.push('render');
		});

		applier.apply({
			reason: 'combined',
			state: { columnWidths: { name: 300 } },
			domains: ['columns'],
			invalidations: [{ kind: 'geometry' }],
			history: {
				undo: { reason: 'combined:undo', state: { columnWidths: { name: 100 } }, requestRender: false },
				redo: { reason: 'combined:redo', state: { columnWidths: { name: 300 } }, requestRender: false },
			},
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 300 } }],
		});

		expect(callOrder).toEqual(['state', 'domains', 'invalidation', 'history', 'render', 'event']);
	});

	it('registers bounded history entries and replays them through the same commit protocol', () => {
		const { applier, commandHistory, stateManager } = makeApplier();

		applier.apply({
			reason: 'history',
			state: { columnWidths: { name: 200 } },
			history: {
				undo: {
					reason: 'history:undo',
					state: { columnWidths: { name: 100 } },
					requestRender: false,
				},
				redo: {
					reason: 'history:redo',
					state: { columnWidths: { name: 200 } },
					requestRender: false,
				},
			},
		});

		commandHistory.undo();
		expect(stateManager.getState().columnWidths).toEqual({ name: 100 });

		commandHistory.redo();
		expect(stateManager.getState().columnWidths).toEqual({ name: 200 });
	});

	it('requestRender: false skips render request', () => {
		const { applier, requestRender } = makeApplier();

		applier.apply({
			reason: 'no-render',
			state: { columnWidths: { name: 200 } },
			requestRender: false,
		});

		expect(requestRender).not.toHaveBeenCalled();
	});

	it('event listener faults do not prevent render scheduling or committed results', () => {
		const { applier, eventBus, requestRender, faultReporter } = makeApplier();

		eventBus.addEventListener(GridEventName.columnResized, () => {
			throw new Error('listener exploded');
		});

		const result = applier.apply({
			reason: 'listener-fault',
			state: { columnWidths: { name: 200 } },
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 200 } }],
		});

		expect(result).toEqual({ status: 'committed', changeId: 1 });
		expect(requestRender).toHaveBeenCalledWith('listener-fault');
		expect(faultReporter.snapshot()).toHaveLength(1);
		expect(faultReporter.snapshot()[0]?.source).toBe('event-bus');
	});

	it('post-commit phase faults return faulted but preserve later completion steps', () => {
		const { applier, eventBus, requestRender, stateManager, faultReporter } = makeApplier();
		const dispatchSpy = vi.spyOn(eventBus, 'dispatchEvent');

		requestRender.mockImplementation(() => {
			throw new Error('render failed');
		});

		const result = applier.apply({
			reason: 'render-fault',
			state: { columnWidths: { name: 220 } },
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 220 } }],
		});

		expect(result.status).toBe('faulted');
		expect(result.changeId).toBe(1);
		expect(stateManager.getState().columnWidths).toEqual({ name: 220 });
		expect(dispatchSpy).toHaveBeenCalledWith(GridEventName.columnResized, { colField: 'name', width: 220 });
		expect(faultReporter.snapshot()[0]?.source).toBe('grid-change');
		expect(faultReporter.snapshot()[0]?.operation).toBe('request-render');
	});

	it('multiple invalidations of different kinds are all applied', () => {
		const { applier, invalidation } = makeApplier();
		const spyInvalidate = vi.spyOn(invalidation, 'invalidate');

		applier.apply({
			reason: 'multi-invalidate',
			invalidations: [{ kind: 'geometry' }, { kind: 'headers' }, { kind: 'viewport' }, { kind: 'column', colId: 'name' }],
		});

		expect(spyInvalidate).toHaveBeenCalledTimes(4);
		expect(spyInvalidate).toHaveBeenCalledWith({ kind: 'geometry' });
		expect(spyInvalidate).toHaveBeenCalledWith({ kind: 'headers' });
		expect(spyInvalidate).toHaveBeenCalledWith({ kind: 'viewport' });
		expect(spyInvalidate).toHaveBeenCalledWith({ kind: 'column', colId: 'name' });
	});
});

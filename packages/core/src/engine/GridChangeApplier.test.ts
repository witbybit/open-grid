import { describe, it, expect, vi } from 'vitest';
import { GridChangeApplier, GridCommitKernel, type GridChangeApplierDeps, type GridCommitKernelDeps } from './GridChangeApplier.js';
import { StateManager } from '../state/StateManager.js';
import { InvalidationManager } from '../renderer/invalidationManager.js';
import { EventBus } from '../events/EventBus.js';
import { CommandHistory } from '../commands/CommandHistory.js';
import { GridEventName, type GridState } from '../store.js';
import { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';
import { createDefaultGridDomainMutationExecutorRegistry } from './GridDomainMutation.js';

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

		expect(result).toEqual({ status: 'committed', changeId: 1, faults: [] });
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

	it('fails-before-commit when a precondition throws without committing state', () => {
		const { applier, stateManager, faultReporter } = makeApplier();

		const result = applier.apply({
			reason: 'precondition-throws',
			precondition: () => {
				throw new Error('bad precondition');
			},
			state: { columnWidths: { name: 250 } },
		});

		expect(result.status).toBe('failed-before-commit');
		expect(stateManager.getState().columnWidths).toEqual({});
		expect(faultReporter.snapshot()[0]?.operation).toBe('validate-precondition');
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

	it('replays executable history mutations through kernel-owned history registration', () => {
		const { applier, commandHistory } = makeApplier();
		const callOrder: string[] = [];

		applier.registerHistory({
			undo: {
				reason: 'data:set-cell-value:undo',
				run: () => {
					callOrder.push('undo');
				},
				requestRender: false,
			},
			redo: {
				reason: 'data:set-cell-value:redo',
				run: () => {
					callOrder.push('redo');
				},
				requestRender: false,
			},
		});

		commandHistory.undo();
		commandHistory.redo();

		expect(callOrder).toEqual(['undo', 'redo']);
	});

	it('commits row-order domain mutations through registered executors with inverse history', () => {
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
		const commandHistory = new CommandHistory(faultReporter);
		const requestRender = vi.fn();
		const incrementDomain = vi.fn();
		let rowOrder = ['1', '2', '3'];
		const rowModel = {
			getRowOrder: () => rowOrder.slice(),
			setRowOrder: (rowIds: string[]) => {
				rowOrder = rowIds.slice();
			},
		};

		const deps: GridCommitKernelDeps<TestRow> = {
			stateManager,
			invalidation,
			eventBus,
			commandHistory,
			requestRender,
			commitContext: {
				getState: () => stateManager.getState(),
				getRowModel: () => rowModel as any,
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
			incrementDomain,
			faultReporter,
		};

		const kernel = new GridCommitKernel(deps);
		const eventSpy = vi.fn();
		eventBus.addEventListener(GridEventName.rowOrderChanged, eventSpy);

		const result = kernel.commit({
			reason: 'rows:set-order',
			domainMutations: [{ kind: 'row-order', rowIds: ['3', '1', '2'] }],
		});

		expect(result.status).toBe('committed');
		expect(rowOrder).toEqual(['3', '1', '2']);
		expect(incrementDomain).toHaveBeenCalledWith('rows');
		expect(requestRender).toHaveBeenCalledWith('rows:set-order');
		expect(eventSpy).toHaveBeenCalledOnce();
		expect(commandHistory.canUndo()).toBe(true);

		commandHistory.undo();
		expect(rowOrder).toEqual(['1', '2', '3']);

		commandHistory.redo();
		expect(rowOrder).toEqual(['3', '1', '2']);
	});

	it('rejects mixed state and domain mutation commits for now', () => {
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
		const deps: GridCommitKernelDeps<TestRow> = {
			stateManager,
			invalidation: new InvalidationManager(),
			eventBus: new EventBus<TestRow>(),
			commandHistory: new CommandHistory(),
			requestRender: vi.fn(),
			commitContext: {
				getState: () => stateManager.getState(),
				getRowModel: () => ({ getRowOrder: () => ['1'], setRowOrder: () => undefined }) as any,
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
		};
		const kernel = new GridCommitKernel(deps);

		expect(
			kernel.commit({
				reason: 'rows:set-order',
				state: { colBuffer: 2 },
				domainMutations: [{ kind: 'row-order', rowIds: ['1'] }],
			})
		).toEqual({ status: 'rejected', reason: 'mixed state and domain mutations are not yet supported' });
	});

	it('commitDetailed exposes row-transaction mutation results from typed executors', () => {
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
		const resultPayload = {
			add: [{ id: '2' }],
			remove: [],
			update: [],
		};
		const rowModel = {
			applyTransaction: vi.fn(() => resultPayload),
		};
		const kernel = new GridCommitKernel<TestRow>({
			stateManager,
			invalidation: new InvalidationManager(),
			eventBus: new EventBus<TestRow>(),
			commandHistory: new CommandHistory(),
			requestRender: vi.fn(),
			commitContext: {
				getState: () => stateManager.getState(),
				getRowModel: () => rowModel as any,
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
		});

		const execution = kernel.commitDetailed({
			reason: 'rows:apply-transaction',
			domainMutations: [{ kind: 'row-transaction', transaction: { add: [{ id: '2', name: 'B' } as TestRow] } }],
		});

		expect(execution.result.status).toBe('committed');
		expect(rowModel.applyTransaction).toHaveBeenCalledOnce();
		expect(execution.appliedMutations[0]?.result).toBe(resultPayload);
	});

	it('commits cell-value domain mutations through typed executors with inverse history', () => {
		const rowValues = new Map([['1:name', 'Alpha']]);
		const kernel = new GridCommitKernel<TestRow>({
			stateManager: new StateManager<TestRow>({
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
			} as unknown as GridState<TestRow>),
			invalidation: new InvalidationManager(),
			eventBus: new EventBus<TestRow>(),
			commandHistory: new CommandHistory(),
			requestRender: vi.fn(),
			commitContext: {
				getState: () => ({}) as GridState<TestRow>,
				getRowModel: () => null,
				applyCellValueChange: (rowId, colField, value) => {
					const key = `${rowId}:${colField}`;
					const oldRawValue = rowValues.get(key);
					if (oldRawValue === value) {
						return {
							applied: false,
							rowId,
							colField,
							oldRawValue,
							oldComputedValue: oldRawValue,
							newRawValue: value,
							invalidatedCells: [],
						};
					}
					rowValues.set(key, value as string);
					return {
						applied: true,
						rowId,
						colField,
						oldRawValue,
						oldComputedValue: oldRawValue,
						newRawValue: value,
						newComputedValue: value,
						invalidatedCells: [{ rowId, colField }],
					};
				},
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
		});

		const result = kernel.commit({
			reason: 'data:set-cell-value',
			domainMutations: [{ kind: 'cell-value', rowId: '1', colField: 'name', value: 'Beta' }],
		});

		expect(result.status).toBe('committed');
		expect(rowValues.get('1:name')).toBe('Beta');
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

		expect(result).toEqual({ status: 'committed', changeId: 1, faults: [] });
		expect(requestRender).toHaveBeenCalledWith('listener-fault');
		expect(faultReporter.snapshot()).toHaveLength(1);
		expect(faultReporter.snapshot()[0]?.source).toBe('event-bus');
	});

	it('post-commit phase faults return committed-with-faults but preserve later completion steps', () => {
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

		expect(result.status).toBe('committed');
		expect(result.changeId).toBe(1);
		expect(result.faults).toHaveLength(1);
		expect(stateManager.getState().columnWidths).toEqual({ name: 220 });
		expect(dispatchSpy).toHaveBeenCalledWith(GridEventName.columnResized, { colField: 'name', width: 220 });
		expect(faultReporter.snapshot()[0]?.source).toBe('grid-change');
		expect(faultReporter.snapshot()[0]?.operation).toBe('request-render');
	});

	it('domain publication faults do not block invalidations, history, render, or events', () => {
		const { applier, invalidation, eventBus, requestRender, incrementDomain, commandHistory, faultReporter } = makeApplier();
		const callOrder: string[] = [];

		incrementDomain.mockImplementation(() => {
			callOrder.push('domains');
			throw new Error('domain failed');
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

		const result = applier.apply({
			reason: 'domain-fault',
			state: { columnWidths: { name: 200 } },
			domains: ['columns'],
			invalidations: [{ kind: 'geometry' }],
			history: {
				undo: { reason: 'domain-fault:undo', state: { columnWidths: {} }, requestRender: false },
				redo: { reason: 'domain-fault:redo', state: { columnWidths: { name: 200 } }, requestRender: false },
			},
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 200 } }],
		});

		expect(result.status).toBe('committed');
		expect(result.faults).toHaveLength(1);
		expect(callOrder).toEqual(['domains', 'invalidation', 'history', 'render', 'event']);
		expect(faultReporter.snapshot()[0]?.operation).toBe('publish-domains');
	});

	it('invalidation faults do not block history, render, or events', () => {
		const { applier, invalidation, eventBus, requestRender, commandHistory, faultReporter } = makeApplier();
		const callOrder: string[] = [];

		vi.spyOn(invalidation, 'invalidate').mockImplementation(() => {
			callOrder.push('invalidation');
			throw new Error('invalidate failed');
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

		const result = applier.apply({
			reason: 'invalidation-fault',
			state: { columnWidths: { name: 210 } },
			invalidations: [{ kind: 'geometry' }],
			history: {
				undo: { reason: 'invalidation-fault:undo', state: { columnWidths: {} }, requestRender: false },
				redo: { reason: 'invalidation-fault:redo', state: { columnWidths: { name: 210 } }, requestRender: false },
			},
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 210 } }],
		});

		expect(result.status).toBe('committed');
		expect(result.faults).toHaveLength(1);
		expect(callOrder).toEqual(['invalidation', 'history', 'render', 'event']);
		expect(faultReporter.snapshot()[0]?.operation).toBe('apply-invalidations');
	});

	it('history registration faults do not block render or events', () => {
		const { applier, eventBus, requestRender, commandHistory, faultReporter } = makeApplier();
		const callOrder: string[] = [];

		vi.spyOn(commandHistory, 'add').mockImplementation(() => {
			callOrder.push('history');
			throw new Error('history failed');
		});
		vi.spyOn(eventBus, 'dispatchEvent').mockImplementation(() => {
			callOrder.push('event');
		});
		requestRender.mockImplementation(() => {
			callOrder.push('render');
		});

		const result = applier.apply({
			reason: 'history-fault',
			state: { columnWidths: { name: 230 } },
			history: {
				undo: { reason: 'history-fault:undo', state: { columnWidths: {} }, requestRender: false },
				redo: { reason: 'history-fault:redo', state: { columnWidths: { name: 230 } }, requestRender: false },
			},
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 230 } }],
		});

		expect(result.status).toBe('committed');
		expect(result.faults).toHaveLength(1);
		expect(callOrder).toEqual(['history', 'render', 'event']);
		expect(faultReporter.snapshot()[0]?.operation).toBe('register-history');
	});

	it('state commit faults return failed-before-commit and do not publish follow-up phases', () => {
		const { applier, stateManager, requestRender, incrementDomain } = makeApplier();
		const originalSetState = stateManager.setState;
		stateManager.setState = vi.fn(() => {
			throw new Error('write failed');
		}) as typeof originalSetState;

		const result = applier.apply({
			reason: 'state-fault',
			state: { columnWidths: { name: 260 } },
			domains: ['columns'],
		});

		expect(result.status).toBe('failed-before-commit');
		expect(requestRender).not.toHaveBeenCalled();
		expect(incrementDomain).not.toHaveBeenCalled();
		expect(stateManager.getState().columnWidths).toEqual({});
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GridChangeApplier, type GridChangeApplierDeps } from './GridChangeApplier.js';
import { StateManager } from '../state/StateManager.js';
import { InvalidationManager } from '../renderer/invalidationManager.js';
import { EventBus } from '../events/EventBus.js';
import { CommandHistory } from '../commands/CommandHistory.js';
import { GridEventName, type GridState } from '../store.js';

type TestRow = { id: string; name: string };

function makeApplier(): {
	applier: GridChangeApplier<TestRow>;
	stateManager: StateManager<TestRow>;
	invalidation: InvalidationManager;
	eventBus: EventBus<TestRow>;
	commandHistory: CommandHistory;
	requestRender: ReturnType<typeof vi.fn>;
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
	const commandHistory = new CommandHistory();
	const requestRender = vi.fn();

	const deps: GridChangeApplierDeps<TestRow> = {
		stateManager,
		invalidation,
		eventBus,
		commandHistory,
		requestRender,
	};

	return {
		applier: new GridChangeApplier(deps),
		stateManager,
		invalidation,
		eventBus,
		commandHistory,
		requestRender,
	};
}

describe('GridChangeApplier', () => {
	it('state-only change applies state patch', () => {
		const { applier, stateManager } = makeApplier();

		applier.apply({
			reason: 'test',
			state: { columnWidths: { name: 200 } },
		});

		expect(stateManager.getState().columnWidths).toEqual({ name: 200 });
	});

	it('invalidation-only change applies invalidations without state patch', () => {
		const { applier, invalidation, stateManager } = makeApplier();
		const spyInvalidate = vi.spyOn(invalidation, 'invalidate');
		const spySetState = vi.spyOn(stateManager, 'setState');

		applier.apply({
			reason: 'test',
			invalidations: [{ kind: 'headers' }],
		});

		expect(spyInvalidate).toHaveBeenCalledWith({ kind: 'headers' });
		expect(spySetState).not.toHaveBeenCalled();
	});

	it('event-only change dispatches events', () => {
		const { applier, eventBus } = makeApplier();
		const spyDispatch = vi.spyOn(eventBus, 'dispatchEvent');

		applier.apply({
			reason: 'test',
			events: [
				{
					type: GridEventName.columnResized,
					payload: { colField: 'name', width: 200 },
				},
			],
		});

		expect(spyDispatch).toHaveBeenCalledWith(GridEventName.columnResized, { colField: 'name', width: 200 });
	});

	it('combined change applies in order: state → invalidations → events → render', () => {
		const { applier, stateManager, invalidation, eventBus, requestRender } = makeApplier();
		const callOrder: string[] = [];

		const origSetState = stateManager.setState;
		stateManager.setState = vi.fn((...args) => {
			callOrder.push('state');
			return origSetState(...args);
		});
		vi.spyOn(invalidation, 'invalidate').mockImplementation(() => {
			callOrder.push('invalidation');
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
			invalidations: [{ kind: 'geometry' }],
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 300 } }],
		});

		expect(callOrder).toEqual(['state', 'invalidation', 'event', 'render']);
	});

	it('undo/redo registers commands in CommandHistory', () => {
		const { applier, commandHistory, stateManager } = makeApplier();
		const spyAdd = vi.spyOn(commandHistory, 'add');

		applier.apply({
			reason: 'undoable',
			state: { columnWidths: { name: 200 } },
			undo: {
				reason: 'undo-resize',
				state: { columnWidths: { name: 100 } },
			},
			redo: {
				reason: 'redo-resize',
				state: { columnWidths: { name: 200 } },
			},
		});

		expect(spyAdd).toHaveBeenCalledOnce();

		// Verify undo works
		commandHistory.undo();
		expect(stateManager.getState().columnWidths).toEqual({ name: 100 });

		// Verify redo works
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

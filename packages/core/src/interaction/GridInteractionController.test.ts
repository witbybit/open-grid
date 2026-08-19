import { describe, expect, it, vi } from 'vitest';
import type { GridCellPointer, GridStateSnapshot } from '../api/GridApi.js';
import type { GridPluginRuntime } from '../api/GridApiSurfaces.js';
import { GridInteractionController } from './GridInteractionController.js';

type TestRow = { id: string; name: string };

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createRuntime(overrides: Partial<GridPluginRuntime<TestRow>> = {}): GridPluginRuntime<TestRow> {
	const displayedColumns = [
		{ field: 'name', colId: 'name-a', instanceId: 'name-a' },
		{ field: 'name', colId: 'name-b', instanceId: 'name-b' },
	] as any[];
	const state = {
		selection: {
			focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
			anchor: null,
			range: null,
			bounds: null,
			source: 'keyboard',
			focusOrigin: 'keyboard',
			version: 1,
		},
		columns: displayedColumns,
	} as GridStateSnapshot<TestRow>;
	const base: Partial<GridPluginRuntime<TestRow>> = {
		getDisplayedColumns: () => displayedColumns as any,
		getStateSnapshot: () => state,
		getVisualRow: (index: number) =>
			index === 0 ? ({ kind: 'data', rowId: 'r1', id: 'r1', node: { id: 'r1', data: { id: 'r1', name: 'A' } } } as any) : null,
		getVisualRowCount: () => 1,
		getVisualIndexByRowId: (rowId: string) => (rowId === 'r1' ? 0 : null),
		getVisibleRowRange: () => ({ startIdx: 0, endIdx: 0 }),
		getRowModel: () =>
			({
				getVisualRowCount: () => 1,
				getVisualRow: (index: number) => (index === 0 ? ({ kind: 'data', rowId: 'r1' } as any) : null),
				getVisualIndexByRowId: (rowId: string) => (rowId === 'r1' ? 0 : -1),
			}) as any,
		getColumnDef: (colField: string) => displayedColumns.find((column) => column.field === colField) as any,
		getColumnField: (index: number) => displayedColumns[index]?.field ?? null,
		getColumnIndex: (colField: string) => displayedColumns.findIndex((column) => column.field === colField),
		getCellState: () => ({ isEditing: false }) as any,
		getCellAccessByPointer: (pointer: GridCellPointer) => {
			const rowIndex = pointer.rowId === 'r1' ? 0 : -1;
			const colIndex = displayedColumns.findIndex(
				(column) => column.instanceId === pointer.columnInstanceId || column.field === pointer.colField
			);
			const column = colIndex >= 0 ? displayedColumns[colIndex] : null;
			if (rowIndex < 0 || !column) return null;
			return {
				rowId: pointer.rowId,
				rowIndex,
				row: { id: 'r1', name: 'A' },
				node: null,
				colField: column.field,
				colIndex,
				column,
				value: 'A',
				rawValue: 'A',
				isFocused: false,
				isRowFocused: false,
				isSelected: false,
				isRowSelected: false,
				isEditing: false,
				isLoading: false,
			} as any;
		},
		selectCell: vi.fn(),
		selectRange: vi.fn(),
		extendSelection: vi.fn(),
		copySelectedRange: vi.fn(async () => {}),
		pasteFromClipboard: vi.fn(async () => {}),
		startEditing: vi.fn(),
		stopEditing: vi.fn(),
		commitEdit: vi.fn(async () => true),
		setCellValue: vi.fn(),
		applyRowSelectionGesture: vi.fn(),
		selectRows: vi.fn(),
		deselectRows: vi.fn(),
	};
	return { ...base, ...overrides } as GridPluginRuntime<TestRow>;
}

describe('GridInteractionController', () => {
	it('navigates across duplicate-field displayed columns by columnInstanceId', () => {
		const runtime = createRuntime();
		const controller = new GridInteractionController(runtime);

		controller.handleKeyDown({
			key: 'ArrowRight',
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		expect(runtime.selectCell).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({
				rowId: 'r1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: 'name-b',
			}),
			'keyboard'
		);
	});

	it('prefers explicit duplicate-column pointer identity over a broader cell-access fallback', () => {
		const runtime = createRuntime({
			getCellAccessByPointer: (pointer: GridCellPointer) =>
				({
					rowId: pointer.rowId,
					rowIndex: 0,
					row: { id: 'r1', name: 'A' },
					node: null,
					colField: 'name',
					colIndex: 0,
					column: { field: 'name', colId: 'name-a', instanceId: 'name-a' },
					value: 'A',
					rawValue: 'A',
					isFocused: false,
					isRowFocused: false,
					isSelected: false,
					isRowSelected: false,
					isEditing: false,
					isLoading: false,
				}) as any,
		});
		const controller = new GridInteractionController(runtime);

		controller.selectCell({ rowId: 'r1', colField: 'name', colId: 'name-b' }, 'api');

		expect(runtime.selectCell).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({
				rowId: 'r1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: 'name-b',
			}),
			'api'
		);
	});

	it('routes scrollToCell through the interaction kernel and applies optional selection/edit semantics', () => {
		const runtime = createRuntime({
			scrollToCell: vi.fn(),
		});
		const controller = new GridInteractionController(runtime);

		controller.scrollToCell('r1', 'name', { select: true, edit: true });

		expect(runtime.scrollToCell).toHaveBeenCalledWith('r1', 'name');
		expect(runtime.selectCell).toHaveBeenCalledWith({ rowId: 'r1', colField: 'name' }, 'api');
		expect(runtime.startEditing).toHaveBeenCalledWith('r1', 'name', 'api');
	});

	it('routes scrollToRow through the interaction kernel and applies optional row selection semantics', () => {
		const runtime = createRuntime({
			scrollToRow: vi.fn(),
		});
		const controller = new GridInteractionController(runtime);

		controller.scrollToRow('r1', { select: true });

		expect(runtime.scrollToRow).toHaveBeenCalledWith('r1');
		expect(runtime.selectRows).toHaveBeenCalledWith(['r1'], undefined);
	});

	it('routes copy and paste commands through the interaction kernel command port', async () => {
		const runtime = createRuntime({
			copySelectedRange: vi.fn(async () => {}),
			pasteFromClipboard: vi.fn(async () => {}),
		});
		const controller = new GridInteractionController(runtime);

		await controller.copySelectedRange();
		await controller.pasteFromClipboard();

		expect(runtime.copySelectedRange).toHaveBeenCalledTimes(1);
		expect(runtime.pasteFromClipboard).toHaveBeenCalledTimes(1);
	});

	it('navigates across pinned and center displayed columns using displayed order', () => {
		const displayedColumns = [
			{ field: 'left', colId: 'left', instanceId: 'left', pinned: 'left' },
			{ field: 'center', colId: 'center', instanceId: 'center' },
			{ field: 'right', colId: 'right', instanceId: 'right', pinned: 'right' },
		] as any[];
		const runtime = createRuntime({
			getDisplayedColumns: () => displayedColumns as any,
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'left', colId: 'left', columnInstanceId: 'left' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					columns: displayedColumns,
				}) as GridStateSnapshot<TestRow>,
			getColumnIndex: (colField: string) => displayedColumns.findIndex((column) => column.field === colField),
			getCellAccessByPointer: (pointer: GridCellPointer) => {
				const colIndex = displayedColumns.findIndex((column) => column.instanceId === pointer.columnInstanceId);
				if (colIndex < 0) return null;
				return {
					rowId: pointer.rowId,
					rowIndex: 0,
					row: { id: 'r1', name: 'A' },
					node: null,
					colField: displayedColumns[colIndex].field,
					colIndex,
					column: displayedColumns[colIndex],
					value: 'A',
					rawValue: 'A',
					isFocused: false,
					isRowFocused: false,
					isSelected: false,
					isRowSelected: false,
					isEditing: false,
					isLoading: false,
				} as any;
			},
		});
		const controller = new GridInteractionController(runtime);

		controller.handleKeyDown({
			key: 'ArrowRight',
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		expect(runtime.selectCell).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({
				rowId: 'r1',
				colField: 'center',
				colId: 'center',
				columnInstanceId: 'center',
			}),
			'keyboard'
		);
	});

	it('does not navigate into hidden columns outside the displayed column set', () => {
		const displayedColumns = [{ field: 'name', colId: 'name-a', instanceId: 'name-a' }] as any[];
		const stateColumns = [...displayedColumns, { field: 'hidden', colId: 'hidden', instanceId: 'hidden', hidden: true }] as any[];
		const runtime = createRuntime({
			getDisplayedColumns: () => displayedColumns as any,
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					columns: stateColumns,
				}) as GridStateSnapshot<TestRow>,
			getColumnIndex: (colField: string) => displayedColumns.findIndex((column) => column.field === colField),
		});
		const controller = new GridInteractionController(runtime);

		controller.handleKeyDown({
			key: 'ArrowRight',
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		expect(runtime.selectCell).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({
				rowId: 'r1',
				colField: 'name',
				colId: 'name-a',
				columnInstanceId: 'name-a',
			}),
			'keyboard'
		);
	});

	it('does not treat a non-checkbox duplicate-field column as the checkbox column', () => {
		const displayedColumns = [
			{ field: 'name', colId: 'name-a', instanceId: 'name-a', checkboxSelection: true },
			{ field: 'name', colId: 'name-b', instanceId: 'name-b', checkboxSelection: false },
		] as any[];
		const runtime = createRuntime({
			getDisplayedColumns: () => displayedColumns as any,
			getStateSnapshot: () =>
				({
					selection: {
						focus: null,
						anchor: null,
						range: null,
						bounds: null,
						source: 'pointer',
						focusOrigin: null,
						version: 0,
					},
					columns: displayedColumns,
				}) as GridStateSnapshot<TestRow>,
			getColumnDef: () => displayedColumns[0] as any,
		});
		const controller = new GridInteractionController(runtime);

		controller.handleDataRowClick({ rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: 'name-b' }, {
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as MouseEvent);

		expect(runtime.applyRowSelectionGesture).toHaveBeenCalledWith({
			kind: 'replace',
			rowIds: ['r1'],
			source: 'pointer',
		});
	});

	it('skips loading, failed, and placeholder rows during vertical keyboard navigation', () => {
		const displayedColumns = [{ field: 'name', colId: 'name-a', instanceId: 'name-a' }] as any[];
		const runtime = createRuntime({
			getDisplayedColumns: () => displayedColumns as any,
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					columns: displayedColumns,
				}) as GridStateSnapshot<TestRow>,
			getVisualRow: (index: number) =>
				[
					{ kind: 'data', rowId: 'r1', id: 'r1', node: { id: 'r1', data: { id: 'r1', name: 'A' } } },
					{ kind: 'loading', id: 'loading-1', rowIndex: 1 },
					{ kind: 'failed', id: 'failed-2', rowIndex: 2, error: 'boom', retryable: true },
					{ kind: 'placeholder', id: 'placeholder-3', rowIndex: 3, reason: 'waiting' },
					{ kind: 'data', rowId: 'r2', id: 'r2', node: { id: 'r2', data: { id: 'r2', name: 'B' } } },
				][index] as any,
			getVisualRowCount: () => 5,
			getVisualIndexByRowId: (rowId: string) => (rowId === 'r1' ? 0 : rowId === 'r2' ? 4 : null),
			getRowModel: () =>
				({
					getVisualRowCount: () => 5,
					getVisualRow: (index: number) =>
						[
							{ kind: 'data', rowId: 'r1' },
							{ kind: 'loading', id: 'loading-1', rowIndex: 1 },
							{ kind: 'failed', id: 'failed-2', rowIndex: 2, error: 'boom', retryable: true },
							{ kind: 'placeholder', id: 'placeholder-3', rowIndex: 3, reason: 'waiting' },
							{ kind: 'data', rowId: 'r2' },
						][index] as any,
					getVisualIndexByRowId: (rowId: string) => (rowId === 'r1' ? 0 : rowId === 'r2' ? 4 : -1),
				}) as any,
			getCellAccessByPointer: (pointer: GridCellPointer) => {
				const rowIndex = pointer.rowId === 'r1' ? 0 : pointer.rowId === 'r2' ? 4 : -1;
				if (rowIndex < 0) return null;
				return {
					rowId: pointer.rowId,
					rowIndex,
					row: { id: pointer.rowId, name: pointer.rowId === 'r1' ? 'A' : 'B' },
					node: null,
					colField: 'name',
					colIndex: 0,
					column: displayedColumns[0],
					value: pointer.rowId === 'r1' ? 'A' : 'B',
					rawValue: pointer.rowId === 'r1' ? 'A' : 'B',
					isFocused: false,
					isRowFocused: false,
					isSelected: false,
					isRowSelected: false,
					isEditing: false,
					isLoading: false,
				} as any;
			},
		});
		const controller = new GridInteractionController(runtime);

		controller.handleKeyDown({
			key: 'ArrowDown',
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		expect(runtime.selectCell).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({
				rowId: 'r2',
				colField: 'name',
				colId: 'name-a',
				columnInstanceId: 'name-a',
			}),
			'keyboard'
		);
	});

	it('uses activeEdit pointer identity instead of getCellState for keyboard edit handling', () => {
		const getCellState = vi.fn(() => {
			throw new Error('should not be called');
		});
		const runtime = createRuntime({
			getCellState,
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					activeEdit: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
					columns: [
						{ field: 'name', colId: 'name-a', instanceId: 'name-a' },
						{ field: 'name', colId: 'name-b', instanceId: 'name-b' },
					],
				}) as GridStateSnapshot<TestRow>,
		});
		const controller = new GridInteractionController(runtime, { arrowKeyNavigationEdit: true });

		controller.handleKeyDown({
			key: 'Escape',
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		expect(getCellState).not.toHaveBeenCalled();
		expect(runtime.stopEditing).toHaveBeenCalledWith(true);
	});

	it('commits the active draft through the kernel when stopEdit is called without cancellation', async () => {
		const commitEdit = vi.fn(async () => true);
		const runtime = createRuntime({
			commitEdit,
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					activeEdit: {
						rowId: 'r1',
						colField: 'name',
						colId: 'name-a',
						columnInstanceId: 'name-a',
						draftValue: 'Draft A',
					},
					columns: [
						{ field: 'name', colId: 'name-a', instanceId: 'name-a' },
						{ field: 'name', colId: 'name-b', instanceId: 'name-b' },
					],
				}) as GridStateSnapshot<TestRow>,
		});
		const controller = new GridInteractionController(runtime);

		controller.stopEdit(false);
		await flushAsyncWork();

		expect(commitEdit).toHaveBeenCalledWith('r1', 'name-a', 'Draft A');
		expect(runtime.stopEditing).not.toHaveBeenCalledWith(false);
	});

	it('moves edit selection only after a successful commit result', async () => {
		const commitEdit = vi.fn(async () => true);
		const runtime = createRuntime({
			commitEdit,
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					activeEdit: {
						rowId: 'r1',
						colField: 'name',
						colId: 'name-a',
						columnInstanceId: 'name-a',
						draftValue: 'Draft A',
					},
					columns: [
						{ field: 'name', colId: 'name-a', instanceId: 'name-a' },
						{ field: 'name', colId: 'name-b', instanceId: 'name-b' },
					],
				}) as GridStateSnapshot<TestRow>,
		});
		const controller = new GridInteractionController(runtime, { arrowKeyNavigationEdit: true });

		controller.handleKeyDown({
			key: 'ArrowRight',
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		await flushAsyncWork();

		expect(commitEdit).toHaveBeenCalledWith('r1', 'name-a', 'Draft A');
		expect(runtime.selectCell).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({
				rowId: 'r1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: 'name-b',
			}),
			'keyboard'
		);
		expect(runtime.startEditing).toHaveBeenCalledWith('r1', 'name-b', 'keyboard');
	});

	it('does not move edit selection when the commit result is rejected', async () => {
		const commitEdit = vi.fn(async () => false);
		const runtime = createRuntime({
			commitEdit,
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					activeEdit: {
						rowId: 'r1',
						colField: 'name',
						colId: 'name-a',
						columnInstanceId: 'name-a',
						draftValue: 'Draft A',
					},
					columns: [
						{ field: 'name', colId: 'name-a', instanceId: 'name-a' },
						{ field: 'name', colId: 'name-b', instanceId: 'name-b' },
					],
				}) as GridStateSnapshot<TestRow>,
		});
		const controller = new GridInteractionController(runtime, { arrowKeyNavigationEdit: true });

		controller.handleKeyDown({
			key: 'ArrowRight',
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		await flushAsyncWork();

		expect(commitEdit).toHaveBeenCalledWith('r1', 'name-a', 'Draft A');
		expect(runtime.selectCell).not.toHaveBeenCalled();
		expect(runtime.startEditing).not.toHaveBeenCalled();
	});

	it('coalesces rapid Tab and Enter navigation behind one edit commit', async () => {
		const commit = deferred<boolean>();
		const runtime = createRuntime({
			commitEdit: vi.fn(() => commit.promise),
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					activeEdit: {
						rowId: 'r1',
						colField: 'name',
						colId: 'name-a',
						columnInstanceId: 'name-a',
						draftValue: 'Draft A',
					},
					columns: [
						{ field: 'name', colId: 'name-a', instanceId: 'name-a' },
						{ field: 'name', colId: 'name-b', instanceId: 'name-b' },
					],
				}) as GridStateSnapshot<TestRow>,
			getVisualRow: (index: number) =>
				[
					{ kind: 'data', rowId: 'r1', id: 'r1', node: { id: 'r1', data: { id: 'r1', name: 'A' } } },
					{ kind: 'data', rowId: 'r2', id: 'r2', node: { id: 'r2', data: { id: 'r2', name: 'B' } } },
				][index] as any,
			getVisualRowCount: () => 2,
			getVisualIndexByRowId: (rowId: string) => (rowId === 'r1' ? 0 : rowId === 'r2' ? 1 : null),
			getRowModel: () =>
				({
					getVisualRowCount: () => 2,
					getVisualRow: (index: number) => (index < 2 ? ({ kind: 'data', rowId: index === 0 ? 'r1' : 'r2' } as any) : null),
					getVisualIndexByRowId: (rowId: string) => (rowId === 'r1' ? 0 : rowId === 'r2' ? 1 : -1),
				}) as any,
		});
		const controller = new GridInteractionController(runtime, { arrowKeyNavigationEdit: true });
		const key = (value: string) =>
			({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

		controller.handleKeyDown(key('Tab'));
		controller.handleKeyDown(key('Enter'));
		expect(runtime.commitEdit).toHaveBeenCalledTimes(1);

		commit.resolve(true);
		await flushAsyncWork();

		expect(runtime.selectCell).toHaveBeenCalledTimes(1);
		expect(runtime.selectCell).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({ rowId: 'r2', colField: 'name', columnInstanceId: 'name-a' }),
			'keyboard'
		);
		expect(runtime.startEditing).toHaveBeenCalledWith('r2', 'name-a', 'keyboard');
	});

	it('dispatchInput routes typed input commands through the kernel surface', () => {
		const runtime = createRuntime();
		const controller = new GridInteractionController(runtime);

		controller.dispatchInput({ kind: 'mouse-up' });
		controller.dispatchInput({
			kind: 'set-cell-editing',
			rowId: 'r1',
			colFieldOrInstanceId: 'name-a',
			isEditing: true,
			source: 'mouse',
		});

		expect(runtime.stopEditing).not.toHaveBeenCalled();
		expect(runtime.startEditing).toHaveBeenCalledWith('r1', 'name-a', 'mouse');
	});

	it('ctrl+End respects estimated row-model counts by clamping to the last represented data row', () => {
		const displayedColumns = [{ field: 'name', colId: 'name-a', instanceId: 'name-a' }] as any[];
		const runtime = createRuntime({
			getDisplayedColumns: () => displayedColumns as any,
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					columns: displayedColumns,
				}) as GridStateSnapshot<TestRow>,
			getVisualRow: (index: number) =>
				[
					{ kind: 'data', rowId: 'r1', id: 'r1', node: { id: 'r1', data: { id: 'r1', name: 'A' } } },
					{ kind: 'loading', id: 'loading-1', rowIndex: 1 },
					{ kind: 'placeholder', id: 'placeholder-2', rowIndex: 2, reason: 'waiting' },
					{ kind: 'data', rowId: 'r2', id: 'r2', node: { id: 'r2', data: { id: 'r2', name: 'B' } } },
					{ kind: 'failed', id: 'failed-4', rowIndex: 4, error: 'boom', retryable: true },
					{ kind: 'data', rowId: 'r3', id: 'r3', node: { id: 'r3', data: { id: 'r3', name: 'C' } } },
				][index] as any,
			getVisualRowCount: () => 6,
			getVisualIndexByRowId: (rowId: string) => ({ r1: 0, r2: 3, r3: 5 })[rowId] ?? null,
			getRowModel: () =>
				({
					getVisualRowCount: () => 6,
					getVisualRow: (index: number) =>
						[
							{ kind: 'data', rowId: 'r1' },
							{ kind: 'loading', id: 'loading-1', rowIndex: 1 },
							{ kind: 'placeholder', id: 'placeholder-2', rowIndex: 2, reason: 'waiting' },
							{ kind: 'data', rowId: 'r2' },
							{ kind: 'failed', id: 'failed-4', rowIndex: 4, error: 'boom', retryable: true },
							{ kind: 'data', rowId: 'r3' },
						][index] as any,
					getVisualIndexByRowId: (rowId: string) => ({ r1: 0, r2: 3, r3: 5 })[rowId] ?? -1,
					getRowCountKind: () => 'estimated',
				}) as any,
			getCellAccessByPointer: (pointer: GridCellPointer) => {
				const rowIndex = ({ r1: 0, r2: 3, r3: 5 }[pointer.rowId] ?? -1) as number;
				if (rowIndex < 0) return null;
				return {
					rowId: pointer.rowId,
					rowIndex,
					row: { id: pointer.rowId, name: pointer.rowId },
					node: null,
					colField: 'name',
					colIndex: 0,
					column: displayedColumns[0],
					value: pointer.rowId,
					rawValue: pointer.rowId,
					isFocused: false,
					isRowFocused: false,
					isSelected: false,
					isRowSelected: false,
					isEditing: false,
					isLoading: false,
				} as any;
			},
		});
		const controller = new GridInteractionController(runtime);

		controller.handleKeyDown({
			key: 'End',
			ctrlKey: true,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		expect(runtime.selectCell).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({
				rowId: 'r3',
				colField: 'name',
				colId: 'name-a',
				columnInstanceId: 'name-a',
			}),
			'keyboard'
		);
	});

	it('ctrl+End keeps navigation honest for unknown row counts by staying within represented rows', () => {
		const displayedColumns = [{ field: 'name', colId: 'name-a', instanceId: 'name-a' }] as any[];
		const runtime = createRuntime({
			getDisplayedColumns: () => displayedColumns as any,
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: null,
						range: null,
						bounds: null,
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 1,
					},
					columns: displayedColumns,
				}) as GridStateSnapshot<TestRow>,
			getVisualRow: (index: number) =>
				[
					{ kind: 'data', rowId: 'r1', id: 'r1', node: { id: 'r1', data: { id: 'r1', name: 'A' } } },
					{ kind: 'loading', id: 'loading-1', rowIndex: 1 },
				][index] as any,
			getVisualRowCount: () => 2,
			getVisualIndexByRowId: (rowId: string) => (rowId === 'r1' ? 0 : null),
			getRowModel: () =>
				({
					getVisualRowCount: () => 2,
					getVisualRow: (index: number) =>
						[
							{ kind: 'data', rowId: 'r1' },
							{ kind: 'loading', id: 'loading-1', rowIndex: 1 },
						][index] as any,
					getVisualIndexByRowId: (rowId: string) => (rowId === 'r1' ? 0 : -1),
					getRowCountKind: () => 'unknown',
				}) as any,
		});
		const controller = new GridInteractionController(runtime);

		controller.handleKeyDown({
			key: 'End',
			ctrlKey: true,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		expect(runtime.selectCell).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({
				rowId: 'r1',
				colField: 'name',
				colId: 'name-a',
				columnInstanceId: 'name-a',
			}),
			'keyboard'
		);
	});

	it('extends from the authoritative selection anchor instead of a controller-local shadow anchor', () => {
		const runtime = createRuntime({
			getStateSnapshot: () =>
				({
					selection: {
						focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						anchor: { rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: 'name-b' },
						range: {
							start: { rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: 'name-b' },
							end: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
						},
						bounds: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 },
						source: 'keyboard',
						focusOrigin: 'keyboard',
						version: 2,
					},
					columns: [
						{ field: 'name', colId: 'name-a', instanceId: 'name-a' },
						{ field: 'name', colId: 'name-b', instanceId: 'name-b' },
					],
				}) as GridStateSnapshot<TestRow>,
		});
		const controller = new GridInteractionController(runtime);

		controller.handleKeyDown({
			key: 'ArrowRight',
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: true,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);

		expect(runtime.selectRange).toHaveBeenCalledWith(
			expect.objectContaining<GridCellPointer>({
				rowId: 'r1',
				colId: 'name-b',
				columnInstanceId: 'name-b',
			}),
			expect.objectContaining<GridCellPointer>({
				rowId: 'r1',
				colId: 'name-a',
				columnInstanceId: 'name-a',
			}),
			'keyboard'
		);
		expect(runtime.extendSelection).not.toHaveBeenCalled();
	});
});

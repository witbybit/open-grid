import { describe, expect, it, vi } from 'vitest';
import type { GridCellPointer, GridStateSnapshot } from '../api/GridApi.js';
import type { GridPluginRuntime } from '../api/GridApiSurfaces.js';
import { GridInteractionController } from './GridInteractionController.js';

type TestRow = { id: string; name: string };

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
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

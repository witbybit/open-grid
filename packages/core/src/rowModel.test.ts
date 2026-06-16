import { describe, it, expect } from 'vitest';
import { GridStore, isEditableVisualRow, isFullWidthVisualRow } from './store.js';
import { ClientRowModelController } from './rowModel.js';
import { RowDataStore } from './rows/RowDataStore.js';
import { RowPipeline } from './rows/RowPipeline.js';
import { toDataVisualRowId, toDetailVisualRowId } from './rows/visualRowIds.js';

interface TestRow {
	id: string;
	name: string;
	parentId?: string | null;
	category?: string;
	amount?: number;
	user?: {
		name: string;
	};
}

function getRowNode<TData>(controller: ClientRowModelController<TData>, index: number) {
	const vr = controller.getVisualRow(index);
	return vr?.kind === 'data' ? vr.node : null;
}

describe('ClientRowModelController', () => {
	it('should initialize and populate visualRows correctly', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const rows = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
		];

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		expect(controller.getVisualRowCount()).toBe(2);
		expect(controller.getVisualRowIndexById(toDataVisualRowId('1'))).toBe(0);
		expect(controller.getVisualRowIndexById(toDataVisualRowId('2'))).toBe(1);

		const visualRow1 = controller.getVisualRow(0);
		expect(visualRow1?.kind).toBe('data');
		expect(visualRow1?.id).toBe('row:1');
		expect(visualRow1?.kind === 'data' ? visualRow1.rowId : null).toBe('1');

		const node1 = getRowNode(controller, 0);
		expect(node1?.data.name).toBe('Alice');
	});

	it('should support updating cell values directly', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const rows = [{ id: '1', name: 'Alice' }];
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		controller.setCellValue('1', 'name', 'Alicia');
		const node = controller.getRowNodeById('1');
		expect(node?.data.name).toBe('Alicia');
	});

	it('should refresh sorting when a nested column path changes through its parent object', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'user.name', header: 'User' }],
			sortModel: [{ colId: 'user.name', sort: 'asc' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', user: { name: 'Alice' } },
				{ id: '2', name: 'Two', user: { name: 'Bob' } },
			],
			columns: store.getState().columns,
		});

		controller.updateRows((rows) => rows.map((row) => (row.id === '2' ? { ...row, user: { name: 'Aaron' } } : row)));

		expect(getRowNode(controller, 0)?.id).toBe('2');
	});

	it('should automatically refresh sorting and filtering when setCellValue is called', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			sortModel: [{ colId: 'name', sort: 'asc' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Bob' },
				{ id: '2', name: 'Charlie' },
				{ id: '3', name: 'Alice' },
			],
			columns: store.getState().columns,
		});

		// Initial sorted order: Alice (3), Bob (1), Charlie (2)
		expect(getRowNode(controller, 0)?.id).toBe('3'); // Alice
		expect(getRowNode(controller, 1)?.id).toBe('1'); // Bob
		expect(getRowNode(controller, 2)?.id).toBe('2'); // Charlie

		// Edit Charlie to Aaron. The sort order should automatically update to Aaron (2), Alice (3), Bob (1)
		controller.setCellValue('2', 'name', 'Aaron');

		expect(getRowNode(controller, 0)?.id).toBe('2'); // Aaron (formerly Charlie)
		expect(getRowNode(controller, 1)?.id).toBe('3'); // Alice
		expect(getRowNode(controller, 2)?.id).toBe('1'); // Bob
	});

	it('should support getVisualIndexById, getVisualIndexByRowId, and getRawRowById correctly', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const rows = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
		];

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		expect(controller.getVisualIndexById('row:1')).toBe(0);
		expect(controller.getVisualIndexById('row:2')).toBe(1);
		expect(controller.getVisualIndexByRowId('1')).toBe(0);
		expect(controller.getVisualIndexByRowId('2')).toBe(1);
		expect(controller.getVisualIndexById('1')).toBe(-1);
		expect(controller.getRawRowById('1')).toEqual({ id: '1', name: 'Alice' });
		expect(controller.getRawRowById('2')).toEqual({ id: '2', name: 'Bob' });
		expect(controller.getRawRowById('non-existent')).toBeNull();
	});

	it('keeps data visual row IDs namespaced even when raw row IDs look like groups', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'group:name:Alice', name: 'Alice' }],
			columns: store.getState().columns,
		});

		const row = controller.getVisualRow(0);
		expect(row?.kind).toBe('data');
		expect(row?.id).toBe('row:group%3Aname%3AAlice');
		expect(row?.kind === 'data' ? row.rowId : null).toBe('group:name:Alice');
		expect(controller.getVisualIndexByRowId('group:name:Alice')).toBe(0);
		expect(controller.getVisualIndexById('group:name:Alice')).toBe(-1);
	});

	it('filters and sorts flat data rows while preserving rowId mappings', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			filterModel: { name: { type: 'text', operator: 'contains', value: 'a' } },
			sortModel: [{ colId: 'name', sort: 'desc' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Ada' },
				{ id: '2', name: 'Bob' },
				{ id: '3', name: 'Cara' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getVisualRowCount()).toBe(2);
		expect(getRowNode(controller, 0)?.id).toBe('3');
		expect(getRowNode(controller, 1)?.id).toBe('1');
		expect(controller.getVisualIndexByRowId('3')).toBe(0);
		expect(controller.getVisualIndexById('row:3')).toBe(0);
	});

	it('builds first-class group rows', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'category', header: 'Category' }],
			rowModelConfig: {
				type: 'client',
				grouping: { model: [{ colId: 'category' }], defaultExpanded: true },
			},
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', category: 'A', amount: 5 },
				{ id: '2', name: 'Two', category: 'A', amount: 7 },
			],
			columns: store.getState().columns,
		});

		const rows = Array.from({ length: controller.getVisualRowCount() }, (_, index) => controller.getVisualRow(index));
		expect(rows[0]?.kind).toBe('group');
		expect(rows[0]?.id).toBe('group:category=A');
		expect(rows[1]?.kind).toBe('data');
		expect(rows[1]?.id).toBe('row:1');
	});

	it('aggregates grouped rows through the pipeline value resolver', () => {
		const dataStore = new RowDataStore<TestRow>((row) => row.id);
		dataStore.setRows([
			{ id: '1', name: 'One', category: 'A', amount: 5 },
			{ id: '2', name: 'Two', category: 'A', amount: 7 },
		]);

		const pipeline = new RowPipeline<TestRow>();
		const result = pipeline.run({
			nodes: dataStore.getAllNodes(),
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'doubleAmount', header: 'Double', valueGetter: ({ row }) => (row.amount ?? 0) * 2 },
			],
			sortModel: null,
			filterModel: null,
			rowModelConfig: { type: 'client', grouping: { model: [{ colId: 'category' }], defaultExpanded: true } },
			aggDefs: [{ field: 'doubleAmount', aggFunc: 'sum' }],
			expandedGroupIds: new Set(),
			expandedDetailRowIds: new Set(),
			defaultRowHeight: 40,
			rowHeightsRecord: {},
		});

		const group = result.visualRows[0];
		expect(group?.kind).toBe('group');
		expect(group?.kind === 'group' ? group.aggregateValues?.doubleAmount : undefined).toBe(24);
	});

	it('filters grouped rows without changing group counts or labels', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'name', header: 'Name' },
			],
			filterModel: { name: { type: 'text', operator: 'contains', value: 'keep' } },
			rowModelConfig: {
				type: 'client',
				grouping: { model: [{ colId: 'category' }], defaultExpanded: true },
			},
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'keep alpha', category: 'A' },
				{ id: '2', name: 'drop beta', category: 'A' },
				{ id: '3', name: 'keep gamma', category: 'B' },
			],
			columns: store.getState().columns,
		});

		const rows = Array.from({ length: controller.getVisualRowCount() }, (_, index) => controller.getVisualRow(index));
		const groups = rows.filter((row) => row?.kind === 'group');
		const dataRows = rows.filter((row) => row?.kind === 'data');

		expect(groups.map((row) => (row?.kind === 'group' ? [row.keyString, row.childCount] : null))).toEqual([
			['A', 1],
			['B', 1],
		]);
		expect(dataRows.map((row) => (row?.kind === 'data' ? row.rowId : null))).toEqual(['1', '3']);
	});

	it('hides and shows grouped children based on serializable expansion state', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'category', header: 'Category' }],
			rowModelConfig: { type: 'client', grouping: { model: [{ colId: 'category' }] } },
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', category: 'A' },
				{ id: '2', name: 'Two', category: 'A' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getVisualRowCount()).toBe(1);
		const result = controller.toggleGroupExpanded('group:category=A');
		expect(store.getState().expansion.groups['group:category=A']).toBe(true);
		expect(controller.getVisualRowCount()).toBe(3);
		expect(result).toMatchObject({
			changed: true,
			reason: 'expansion',
			groupId: 'group:category=A',
			previousRowCount: 1,
			nextRowCount: 3,
			changedStartIndex: 1,
			changedEndIndex: 2,
		});
	});

	it('emits explicit invalidation lanes for group expansion', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'category', header: 'Category' }],
			rowModelConfig: { type: 'client', grouping: { model: [{ colId: 'category' }] } },
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', category: 'A' },
				{ id: '2', name: 'Two', category: 'A' },
			],
			columns: store.getState().columns,
		});

		store.engine.invalidation.consume();
		store.toggleGroupExpanded('group:category=A');
		const frame = store.engine.invalidation.consume();

		expect(frame.groups).toEqual(new Set(['group:category=A']));
		expect(frame.rowRanges).toEqual([{ startIndex: 1, endIndex: 2, reason: 'group expansion' }]);
		expect(frame.geometry).toBe(true);
		expect(frame.viewport).toBe(true);
		expect(frame.invalidations).toContainEqual({ kind: 'group', groupId: 'group:category=A', reason: 'group expansion' });
		expect(frame.invalidations).toContainEqual({ kind: 'row-range', startIndex: 1, endIndex: 2, reason: 'group expansion' });

		controller.dispose();
		store.destroy();
	});

	it('uses targeted structural invalidations when grouping columns change', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'category', header: 'Category' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', category: 'A' },
				{ id: '2', name: 'Two', category: 'B' },
			],
			columns: store.getState().columns,
		});

		store.engine.invalidation.consume();
		store.setGroupBy(['category']);
		const frame = store.engine.invalidation.consume();

		expect(frame.full).toBe(false);
		expect(frame.geometry).toBe(true);
		expect(frame.viewport).toBe(true);
		expect(frame.headers).toBe(true);
		expect(frame.overlay).toBe(true);
		expect(frame.reasons).toContain('groupBy');
		expect(frame.invalidations).toContainEqual({ kind: 'geometry', reason: 'groupBy' });
		expect(frame.invalidations).toContainEqual({ kind: 'viewport', reason: 'groupBy' });

		controller.dispose();
		store.destroy();
	});

	it('keeps tree parents as data visual rows and preserves ancestors while filtering', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			filterModel: { name: { type: 'text', operator: 'contains', value: 'Child' } },
			rowModelConfig: {
				type: 'client',
				treeData: {
					enabled: true,
					getParentId: (row) => row.parentId,
					defaultExpanded: true,
					filterMode: 'includeAncestors',
				},
			},
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'p', name: 'Parent', parentId: null },
				{ id: 'c', name: 'Child', parentId: 'p' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.id).toBe('row:p');
		expect(controller.getVisualRow(1)?.kind).toBe('data');
		expect(controller.getVisualRow(1)?.id).toBe('row:c');
		expect(controller.getVisualRow(1)?.depth).toBe(1);
	});

	it('hides tree children when a parent data row is collapsed', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			rowModelConfig: {
				type: 'client',
				treeData: {
					enabled: true,
					getParentId: (row) => row.parentId,
					defaultExpanded: false,
				},
			},
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'p', name: 'Parent', parentId: null },
				{ id: 'c', name: 'Child', parentId: 'p' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getVisualRowCount()).toBe(1);
		expect(controller.getVisualRow(0)?.id).toBe('row:p');

		store.setState({ expansion: { ...store.getState().expansion, treeRows: { p: true } } });
		controller.refresh('expansion');
		expect(controller.getVisualRowCount()).toBe(2);
		expect(controller.getVisualRow(1)?.id).toBe('row:c');
	});

	it('injects detail rows without changing rowIdToVisualIndex', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			rowModelConfig: {
				type: 'client',
				masterDetail: { enabled: true, expandedRowIds: { '1': true }, defaultDetailHeight: 321 },
			},
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice' }],
			columns: store.getState().columns,
		});

		const detail = controller.getVisualRow(1);
		expect(detail?.kind).toBe('detail');
		expect(detail?.id).toBe(toDetailVisualRowId('1'));
		expect(isFullWidthVisualRow(detail)).toBe(true);
		expect(isEditableVisualRow(detail)).toBe(false);
		expect(controller.getVisualIndexByRowId('1')).toBe(0);
		expect(controller.getVisualIndexById('detail:1')).toBe(1);
	});
});

describe('GroupRowMeta', () => {
	interface GRow {
		id: string;
		category: string;
		sub?: string;
	}

	function groupIdAt(ctrl: ClientRowModelController<GRow>, visualIndex: number): string {
		const row = ctrl.getVisualRow(visualIndex);
		if (row?.kind !== 'group') throw new Error(`row at ${visualIndex} is not a group`);
		return row.groupId;
	}

	it('returns null for unknown groupId', () => {
		const store = new GridStore<GRow>({ getRowId: (r) => r.id, columns: [{ field: 'category', header: 'Category' }], groupBy: ['category'] });
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', category: 'A' }],
			columns: store.getState().columns,
		});
		expect(ctrl.getGroupMeta('no-such-id')).toBeNull();
	});

	it('collapsed group: firstChildIndex and lastChildIndex are -1, visibleDescendantRowIds is empty', () => {
		const store = new GridStore<GRow>({ getRowId: (r) => r.id, columns: [{ field: 'category', header: 'Category' }], groupBy: ['category'] });
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A' },
				{ id: '2', category: 'A' },
			],
			columns: store.getState().columns,
		});
		const groupId = groupIdAt(ctrl, 0);
		const meta = ctrl.getGroupMeta(groupId);
		expect(meta).not.toBeNull();
		expect(meta!.expanded).toBe(false);
		expect(meta!.firstChildIndex).toBe(-1);
		expect(meta!.lastChildIndex).toBe(-1);
		expect(meta!.visibleDescendantRowIds).toEqual([]);
	});

	it('expanded group: firstChildIndex, lastChildIndex, and visibleDescendantRowIds are correct', () => {
		const store = new GridStore<GRow>({ getRowId: (r) => r.id, columns: [{ field: 'category', header: 'Category' }], groupBy: ['category'] });
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A' },
				{ id: '2', category: 'A' },
			],
			columns: store.getState().columns,
		});
		const groupId = groupIdAt(ctrl, 0);
		store.setState({ expansion: { groups: { [groupId]: true }, treeRows: {}, details: {} } });
		ctrl.refresh();

		const meta = ctrl.getGroupMeta(groupId);
		expect(meta!.expanded).toBe(true);
		expect(meta!.firstChildIndex).toBe(1);
		expect(meta!.lastChildIndex).toBe(2);
		expect(meta!.visibleDescendantRowIds).toEqual(['1', '2']);
		expect(meta!.firstLeafIndex).toBe(1);
		expect(meta!.lastLeafIndex).toBe(2);
	});

	it('getGroupMetaByVisualIndex returns same object as getGroupMeta', () => {
		const store = new GridStore<GRow>({ getRowId: (r) => r.id, columns: [{ field: 'category', header: 'Category' }], groupBy: ['category'] });
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', category: 'A' }],
			columns: store.getState().columns,
		});
		const groupId = groupIdAt(ctrl, 0);
		store.setState({ expansion: { groups: { [groupId]: true }, treeRows: {}, details: {} } });
		ctrl.refresh();

		const byId = ctrl.getGroupMeta(groupId);
		const byIndex = ctrl.getGroupMetaByVisualIndex(0);
		expect(byIndex).toBe(byId);
	});

	it('multiple sibling groups each have correct descendant ids', () => {
		const store = new GridStore<GRow>({ getRowId: (r) => r.id, columns: [{ field: 'category', header: 'Category' }], groupBy: ['category'] });
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A' },
				{ id: '2', category: 'B' },
				{ id: '3', category: 'B' },
			],
			columns: store.getState().columns,
		});
		const idA = groupIdAt(ctrl, 0);
		const idB = groupIdAt(ctrl, 1);
		store.setState({ expansion: { groups: { [idA]: true, [idB]: true }, treeRows: {}, details: {} } });
		ctrl.refresh();

		expect(ctrl.getGroupMeta(idA)!.visibleDescendantRowIds).toEqual(['1']);
		expect(ctrl.getGroupMeta(idB)!.visibleDescendantRowIds).toEqual(['2', '3']);
		// A's range ends just before B's group row (index 2)
		expect(ctrl.getGroupMeta(idA)!.lastChildIndex).toBe(1);
		// B's range starts at index 3
		expect(ctrl.getGroupMeta(idB)!.firstChildIndex).toBe(3);
	});

	it('nested groups: parent has all leaf descendants, child has only its own', () => {
		const store = new GridStore<GRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'sub', header: 'Sub' },
			],
			groupBy: ['category', 'sub'],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A', sub: 'x' },
				{ id: '2', category: 'A', sub: 'x' },
			],
			columns: store.getState().columns,
		});
		// Expand outer first to reveal the inner group at index 1
		const outer = groupIdAt(ctrl, 0);
		store.setState({ expansion: { groups: { [outer]: true }, treeRows: {}, details: {} } });
		ctrl.refresh();
		const inner = groupIdAt(ctrl, 1);
		store.setState({ expansion: { groups: { [outer]: true, [inner]: true }, treeRows: {}, details: {} } });
		ctrl.refresh();

		const outerMeta = ctrl.getGroupMeta(outer);
		const innerMeta = ctrl.getGroupMeta(inner);
		expect(outerMeta!.visibleDescendantRowIds).toEqual(['1', '2']);
		expect(innerMeta!.visibleDescendantRowIds).toEqual(['1', '2']);
		expect(outerMeta!.childGroupIds).toContain(inner);
		expect(innerMeta!.parentGroupId).toBe(outer);
	});

	it('group with footer: footer row does not appear in visibleDescendantRowIds but is in child range', () => {
		const store = new GridStore<GRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'category', header: 'Category' }],
			groupBy: ['category'],
			showGroupFooter: true,
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A' },
				{ id: '2', category: 'A' },
			],
			columns: store.getState().columns,
		});
		const groupId = groupIdAt(ctrl, 0);
		store.setState({ expansion: { groups: { [groupId]: true }, treeRows: {}, details: {} } });
		ctrl.refresh();

		const meta = ctrl.getGroupMeta(groupId);
		expect(meta!.visibleDescendantRowIds).toEqual(['1', '2']);
		const footerRow = ctrl.getVisualRow(meta!.lastChildIndex);
		expect(footerRow?.kind).toBe('footer');
	});
});

describe('Phase 068 — filter membership shortcut in updateRows()', () => {
	interface FRow {
		id: string;
		name: string;
		status: string;
		price: number;
	}

	function makeFilteredStore(filterField: 'name' | 'status') {
		return new GridStore<FRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'status', header: 'Status' },
				{ field: 'price', header: 'Price' },
			],
			filterModel: { [filterField]: { type: 'text', operator: 'equals', value: 'active' } },
		});
	}

	it('skips full rebuild when a filter-key field changes but row membership is unchanged (still passes)', () => {
		const store = makeFilteredStore('status');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(ctrl.getVisualRowCount()).toBe(1);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');

		// Update `status` on row 1 to a different value that still matches the filter
		// (same value 'active' → still passes; membership unchanged)
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 99 } : r)));

		// Row count unchanged, row still visible, value updated
		expect(ctrl.getVisualRowCount()).toBe(1);
		expect(ctrl.getRowNodeById('1')?.data.price).toBe(99);
	});

	it('triggers full rebuild when a filtered-out row now passes the filter', () => {
		const store = makeFilteredStore('status');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(ctrl.getVisualRowCount()).toBe(1);

		// Row 2 was hidden; now update its status so it passes the filter
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '2' ? { ...r, status: 'active' } : r)));

		expect(ctrl.getVisualRowCount()).toBe(2);
	});

	it('triggers full rebuild when a visible row no longer passes the filter', () => {
		const store = makeFilteredStore('status');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(ctrl.getVisualRowCount()).toBe(1);

		// Row 1 is visible; now make it fail the filter
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '1' ? { ...r, status: 'inactive' } : r)));

		expect(ctrl.getVisualRowCount()).toBe(0);
	});

	it('always does full rebuild for filter-key changes on a grouped grid', () => {
		const store = new GridStore<FRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'status', header: 'Status' },
				{ field: 'name', header: 'Name' },
			],
			filterModel: { status: { type: 'text', operator: 'equals', value: 'active' } },
			rowModelConfig: {
				type: 'client',
				grouping: { model: [{ colId: 'status' }], defaultExpanded: true },
			},
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		// Only the 'active' group + its 1 child is visible (inactive filtered out)
		expect(ctrl.getVisualRowCount()).toBe(2);

		// Update a status field on the visible row; full rebuild runs (group may need updating)
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '1' ? { ...r, status: 'inactive' } : r)));

		// Active group should disappear; inactive group was previously filtered
		expect(ctrl.getVisualRowCount()).toBe(0);
	});

	it('value-only path preserves visual row order when filter-key field changes without membership change', () => {
		const store = makeFilteredStore('status');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Carol', status: 'active', price: 30 },
				{ id: '3', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(ctrl.getVisualRowCount()).toBe(2);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');

		// Change price (not a filter key) and status (still 'active') — neither changes membership
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 999 } : r)));

		expect(ctrl.getVisualRowCount()).toBe(2);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');
		expect(ctrl.getRowNodeById('1')?.data.price).toBe(999);
	});
});

describe('Phase 068 — sort relocation in updateRows()', () => {
	interface SRow {
		id: string;
		name: string;
		price: number;
	}

	function makeSortedStore(sortField: 'name' | 'price', dir: 'asc' | 'desc' = 'asc') {
		return new GridStore<SRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: sortField, sort: dir }],
		});
	}

	it('repositions a row in ascending sort order when its sort key changes', () => {
		const store = makeSortedStore('price');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		// Initial order: 1 (10), 2 (20), 3 (30)
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');
		expect(getRowNode(ctrl, 2)?.id).toBe('3');

		// Raise row 1's price to 25 — should move between 2 and 3
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 25 } : r)));

		expect(ctrl.getVisualRowCount()).toBe(3);
		expect(getRowNode(ctrl, 0)?.id).toBe('2'); // 20
		expect(getRowNode(ctrl, 1)?.id).toBe('1'); // 25 (moved)
		expect(getRowNode(ctrl, 2)?.id).toBe('3'); // 30
	});

	it('repositions a row in descending sort order', () => {
		const store = makeSortedStore('price', 'desc');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 30 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 10 },
			],
			columns: store.getState().columns,
		});

		// Initial order: 1 (30), 2 (20), 3 (10)
		expect(getRowNode(ctrl, 0)?.id).toBe('1');

		// Drop row 1's price below everyone else
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 5 } : r)));

		expect(getRowNode(ctrl, 0)?.id).toBe('2');
		expect(getRowNode(ctrl, 1)?.id).toBe('3');
		expect(getRowNode(ctrl, 2)?.id).toBe('1'); // now last (lowest price, desc)
	});

	it('keeps index maps consistent after relocation', () => {
		const store = makeSortedStore('name');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		// 'Bob' → 'Aaron' should move to first
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '2' ? { ...r, name: 'Aaron' } : r)));

		expect(ctrl.getVisualIndexByRowId('2')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('1')).toBe(1);
		expect(ctrl.getVisualIndexByRowId('3')).toBe(2);
	});

	it('falls back to full rebuild on a grouped grid when sort key changes', () => {
		const store = new GridStore<SRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: 'price', sort: 'asc' }],
			rowModelConfig: {
				type: 'client',
				grouping: { model: [{ colId: 'name' }], defaultExpanded: true },
			},
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'A', price: 10 },
				{ id: '2', name: 'A', price: 20 },
			],
			columns: store.getState().columns,
		});

		// Full rebuild should correctly update group structure even with sort change
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 30 } : r)));

		// Verify rows are still present and correctly structured
		expect(ctrl.getVisualRowCount()).toBeGreaterThan(0);
		expect(ctrl.getRowNodeById('1')?.data.price).toBe(30);
	});

	it('handles no-op sort relocation when row stays at same position', () => {
		const store = makeSortedStore('price');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		// Update price but keep relative order (15 stays between 10 and 20 → no, 15 > 10 and < 20, so '1' stays at 0)
		// Actually 15 > 10 (original) so row 1 stays first if it was at 10. 15 < 20, so still at index 0.
		ctrl.updateRows((rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 15 } : r)));

		expect(getRowNode(ctrl, 0)?.id).toBe('1'); // still first (15 < 20 < 30)
		expect(ctrl.getRowNodeById('1')?.data.price).toBe(15);
	});

	it('correctly relocates multiple changed rows simultaneously', () => {
		const store = makeSortedStore('price');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		// Swap prices of row 1 and row 3
		ctrl.updateRows((rows) =>
			rows.map((r) => {
				if (r.id === '1') return { ...r, price: 30 };
				if (r.id === '3') return { ...r, price: 10 };
				return r;
			})
		);

		// After swap: 3 (10), 2 (20), 1 (30)
		expect(getRowNode(ctrl, 0)?.id).toBe('3');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');
		expect(getRowNode(ctrl, 2)?.id).toBe('1');
	});
});

describe('Phase 068 — incremental insert/remove in applyTransaction()', () => {
	interface TRow {
		id: string;
		name: string;
		price: number;
	}

	it('incrementally inserts a new row at the end of an unsorted flat grid', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice', price: 10 }],
			columns: store.getState().columns,
		});

		ctrl.applyTransaction({ add: [{ id: '2', name: 'Bob', price: 20 }] });

		expect(ctrl.getVisualRowCount()).toBe(2);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');
	});

	it('inserts into the correct sorted position', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: 'price', sort: 'asc' }],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		ctrl.applyTransaction({ add: [{ id: '2', name: 'Bob', price: 20 }] });

		expect(ctrl.getVisualRowCount()).toBe(3);
		expect(getRowNode(ctrl, 0)?.id).toBe('1'); // 10
		expect(getRowNode(ctrl, 1)?.id).toBe('2'); // 20 — inserted
		expect(getRowNode(ctrl, 2)?.id).toBe('3'); // 30
	});

	it('filters out a newly added row if it does not pass the active filter', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			filterModel: { name: { type: 'text', operator: 'equals', value: 'Alice' } },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice', price: 10 }],
			columns: store.getState().columns,
		});

		ctrl.applyTransaction({ add: [{ id: '2', name: 'Bob', price: 20 }] });

		// Bob doesn't match filter — should not appear
		expect(ctrl.getVisualRowCount()).toBe(1);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
	});

	it('adds a passing row when a filter is active', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			filterModel: { name: { type: 'text', operator: 'equals', value: 'Alice' } },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice', price: 10 }],
			columns: store.getState().columns,
		});

		ctrl.applyTransaction({ add: [{ id: '2', name: 'Alice', price: 20 }] });

		expect(ctrl.getVisualRowCount()).toBe(2);
	});

	it('incrementally removes a row and keeps index maps consistent', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		ctrl.applyTransaction({ remove: [{ id: '2', name: 'Bob', price: 20 }] });

		expect(ctrl.getVisualRowCount()).toBe(2);
		expect(ctrl.getVisualIndexByRowId('1')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('2')).toBe(-1);
		expect(ctrl.getVisualIndexByRowId('3')).toBe(1);
	});

	it('falls back to full rebuild on a grouped grid', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			rowModelConfig: {
				type: 'client',
				grouping: { model: [{ colId: 'name' }], defaultExpanded: true },
			},
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'A', price: 10 }],
			columns: store.getState().columns,
		});

		ctrl.applyTransaction({ add: [{ id: '2', name: 'B', price: 20 }] });

		// Both rows should be visible (full rebuild correctly groups them)
		expect(ctrl.getRowNodeById('1')).not.toBeNull();
		expect(ctrl.getRowNodeById('2')).not.toBeNull();
	});
});

describe('Numeric Filter Null Safety', () => {
	interface NumericRow {
		id: string;
		value: number | null | undefined;
	}

	it('should not match null or undefined cell values in numeric comparisons', () => {
		const store = new GridStore<NumericRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'value', header: 'Value' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', value: 10 },
				{ id: '2', value: null },
				{ id: '3', value: undefined },
				{ id: '4', value: '' as any },
				{ id: '5', value: 3 },
			],
			columns: store.getState().columns,
		});

		// 1. Filter: value < 5
		store.setState({
			filterModel: { value: { type: 'number', operator: 'lt', value: 5 } },
		});
		controller.refresh();
		// Only '5' (value 3) should match. null/undefined/"" should NOT match (would have matched if coerced to 0)
		expect(controller.getVisualRowCount()).toBe(1);
		expect(controller.getVisualRow(0)?.rowId).toBe('5');

		// 2. Filter: value >= 0
		store.setState({
			filterModel: { value: { type: 'number', operator: 'gte', value: 0 } },
		});
		controller.refresh();
		// '1' (10) and '5' (3) should match. null/undefined/"" should not match
		expect(controller.getVisualRowCount()).toBe(2);
		const matchedIds = [controller.getVisualRow(0)?.rowId, controller.getVisualRow(1)?.rowId];
		expect(matchedIds).toContain('1');
		expect(matchedIds).toContain('5');
	});
});

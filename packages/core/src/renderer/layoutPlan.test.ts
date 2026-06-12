// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { computeGridLayoutPlan, GROUP_BAND_HEIGHT, GROUP_PANEL_HEIGHT, LEAF_HEADER_HEIGHT } from './layoutPlan.js';

describe('GridLayoutPlan', () => {
	it('uses one chrome contract for group panel, header, sticky group, and overlay origins', () => {
		const store = new GridStore<{ id: string; name: string }>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			showGroupPanel: true,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'One' }],
			columns: store.getState().columns,
		});

		store.setViewportSize(500, 300);
		const plan = computeGridLayoutPlan(store.engine);

		expect(plan.chrome.groupPanelHeight).toBe(GROUP_PANEL_HEIGHT);
		expect(plan.chrome.leafHeaderHeight).toBe(LEAF_HEADER_HEIGHT);
		expect(plan.chrome.totalHeaderHeight).toBe(LEAF_HEADER_HEIGHT);
		expect(plan.chrome.topChromeHeight).toBe(GROUP_PANEL_HEIGHT + LEAF_HEADER_HEIGHT);
		expect(plan.origins.headerTop).toBe(GROUP_PANEL_HEIGHT);
		expect(plan.origins.overlayTop).toBe(plan.chrome.topChromeHeight);
		expect(plan.origins.stickyGroupLayerTop).toBe(plan.chrome.topChromeHeight);

		controller.dispose();
		store.destroy();
	});

	it('collapses group panel chrome when hidden', () => {
		const store = new GridStore<{ id: string; name: string }>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			defaultRowHeight: 40,
			showGroupPanel: false,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'One' }],
			columns: store.getState().columns,
		});

		store.setViewportSize(500, 300);
		const plan = computeGridLayoutPlan(store.engine);

		expect(plan.chrome.groupPanelHeight).toBe(0);
		expect(plan.chrome.topChromeHeight).toBe(LEAF_HEADER_HEIGHT);
		expect(plan.origins.headerTop).toBe(0);
		expect(plan.origins.overlayTop).toBe(LEAF_HEADER_HEIGHT);

		controller.dispose();
		store.destroy();
	});

	it('centralizes content dimensions and pinned column widths', () => {
		const store = new GridStore<{ id: string; a: string; b: string; c: string }>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'a', header: 'A', width: 80 },
				{ field: 'b', header: 'B', width: 120 },
				{ field: 'c', header: 'C', width: 160 },
			],
			defaultRowHeight: 30,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', a: 'a1', b: 'b1', c: 'c1' },
				{ id: '2', a: 'a2', b: 'b2', c: 'c2' },
			],
			columns: store.getState().columns,
		});

		store.setViewportSize(300, 180);
		store.setViewportPins({ left: 1, right: 1 });
		const plan = computeGridLayoutPlan(store.engine);

		expect(plan.dimensions.totalColumnsWidth).toBe(360);
		expect(plan.dimensions.contentWidth).toBe(360);
		expect(plan.dimensions.totalRowsHeight).toBe(60);
		expect(plan.columns.pinLeftWidth).toBe(80);
		expect(plan.columns.pinRightWidth).toBe(160);
		expect(plan.columns.centerWidth).toBe(60);

		controller.dispose();
		store.destroy();
	});

	it('projects displayed columns into header bands', () => {
		const store = new GridStore<{ id: string; a: string; b: string; c: string }>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'a', header: 'A', width: 80 },
				{ field: 'b', header: 'B', width: 120, movable: false },
				{ field: 'c', header: 'C', width: 160 },
			],
			defaultRowHeight: 30,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', a: 'a1', b: 'b1', c: 'c1' }],
			columns: store.getState().columns,
		});

		store.setViewportSize(300, 180);
		store.setViewportPins({ left: 1, right: 1 });
		const plan = computeGridLayoutPlan(store.engine);

		expect(plan.headerBands).toHaveLength(1);
		expect(plan.headerBands[0]).toMatchObject({ depth: 0, top: 0, height: LEAF_HEADER_HEIGHT });
		expect(plan.headerBands[0].cells.map((cell) => [cell.field, cell.label, cell.left, cell.width, cell.pinned, cell.movable])).toEqual([
			['a', 'A', 0, 80, 'left', true],
			['b', 'B', 80, 120, 'center', false],
			['c', 'C', 200, 160, 'right', true],
		]);

		controller.dispose();
		store.destroy();
	});

	it('no headerGroup → single leaf band, totalHeaderHeight = LEAF_HEADER_HEIGHT', () => {
		const store = new GridStore<{ id: string; a: string }>({
			getRowId: (r) => r.id,
			columns: [{ field: 'a', header: 'A', width: 100 }],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), { rows: [], columns: store.getState().columns });
		store.setViewportSize(200, 300);
		const plan = computeGridLayoutPlan(store.engine);

		expect(plan.headerBands).toHaveLength(1);
		expect(plan.headerBands[0].depth).toBe(0);
		expect(plan.headerBands[0].cells[0].isLeaf).toBe(true);
		expect(plan.chrome.columnGroupHeaderHeight).toBe(0);
		expect(plan.chrome.totalHeaderHeight).toBe(LEAF_HEADER_HEIGHT);

		ctrl.dispose();
		store.destroy();
	});

	it('single group level: one group band + leaf band, group spans matching columns', () => {
		const store = new GridStore<{ id: string; a: string; b: string; c: string }>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'a', header: 'A', width: 80, headerGroup: 'Revenue' },
				{ field: 'b', header: 'B', width: 80, headerGroup: 'Revenue' },
				{ field: 'c', header: 'C', width: 80 },
			],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), { rows: [], columns: store.getState().columns });
		store.setViewportSize(300, 300);
		const plan = computeGridLayoutPlan(store.engine);

		expect(plan.headerBands).toHaveLength(2);
		const [groupBand, leafBand] = plan.headerBands;

		// Group band
		expect(groupBand.depth).toBe(0);
		expect(groupBand.height).toBe(GROUP_BAND_HEIGHT);
		expect(groupBand.top).toBe(0);
		expect(groupBand.cells).toHaveLength(1); // A and B merge; C is ungrouped → no cell
		expect(groupBand.cells[0]).toMatchObject({ label: 'Revenue', colStart: 0, colEnd: 1, left: 0, width: 160, isLeaf: false });

		// Leaf band
		expect(leafBand.depth).toBe(1);
		expect(leafBand.top).toBe(GROUP_BAND_HEIGHT);
		expect(leafBand.cells).toHaveLength(3);
		expect(leafBand.cells[0].isLeaf).toBe(true);

		expect(plan.chrome.columnGroupHeaderHeight).toBe(GROUP_BAND_HEIGHT);
		expect(plan.chrome.totalHeaderHeight).toBe(GROUP_BAND_HEIGHT + LEAF_HEADER_HEIGHT);

		ctrl.dispose();
		store.destroy();
	});

	it('two group levels: two group bands + leaf band', () => {
		const store = new GridStore<{ id: string; a: string; b: string }>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'a', header: 'A', width: 100, headerGroup: ['Financials', 'Revenue'] },
				{ field: 'b', header: 'B', width: 100, headerGroup: ['Financials', 'Revenue'] },
			],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), { rows: [], columns: store.getState().columns });
		store.setViewportSize(300, 300);
		const plan = computeGridLayoutPlan(store.engine);

		expect(plan.headerBands).toHaveLength(3);
		expect(plan.headerBands[0]).toMatchObject({ depth: 0, top: 0, height: GROUP_BAND_HEIGHT });
		expect(plan.headerBands[0].cells[0]).toMatchObject({ label: 'Financials', colStart: 0, colEnd: 1, width: 200 });
		expect(plan.headerBands[1]).toMatchObject({ depth: 1, top: GROUP_BAND_HEIGHT, height: GROUP_BAND_HEIGHT });
		expect(plan.headerBands[1].cells[0]).toMatchObject({ label: 'Revenue', colStart: 0, colEnd: 1, width: 200 });
		expect(plan.headerBands[2]).toMatchObject({ depth: 2, top: GROUP_BAND_HEIGHT * 2, height: LEAF_HEADER_HEIGHT });
		expect(plan.chrome.totalHeaderHeight).toBe(GROUP_BAND_HEIGHT * 2 + LEAF_HEADER_HEIGHT);

		ctrl.dispose();
		store.destroy();
	});

	it('groups do not span across pin zone boundaries', () => {
		const store = new GridStore<{ id: string; a: string; b: string }>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'a', header: 'A', width: 100, headerGroup: 'Revenue', pin: 'left' },
				{ field: 'b', header: 'B', width: 100, headerGroup: 'Revenue' },
			],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), { rows: [], columns: store.getState().columns });
		store.setViewportSize(300, 300);
		store.setViewportPins({ left: 1, right: 0 });
		const plan = computeGridLayoutPlan(store.engine);

		const groupBand = plan.headerBands[0];
		// A is pinned-left, B is center — same group name but different zones → two separate cells
		expect(groupBand.cells).toHaveLength(2);
		expect(groupBand.cells[0]).toMatchObject({ label: 'Revenue', pinned: 'left', colStart: 0, colEnd: 0 });
		expect(groupBand.cells[1]).toMatchObject({ label: 'Revenue', pinned: 'center', colStart: 1, colEnd: 1 });

		ctrl.dispose();
		store.destroy();
	});
});

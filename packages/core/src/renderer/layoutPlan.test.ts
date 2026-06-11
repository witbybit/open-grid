// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { computeGridLayoutPlan, GROUP_PANEL_HEIGHT, LEAF_HEADER_HEIGHT } from './layoutPlan.js';

describe('GridLayoutPlan', () => {
	it('uses one chrome contract for group panel, header, sticky group, and overlay origins', () => {
		const store = new GridStore<{ id: string; name: string }>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			showGroupPanel: true,
		});
		const controller = new ClientRowModelController(store, {
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
		const controller = new ClientRowModelController(store, {
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
		const controller = new ClientRowModelController(store, {
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
		const controller = new ClientRowModelController(store, {
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
});

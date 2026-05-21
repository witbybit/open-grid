import { describe, it, expect } from 'vitest';
import { ViewportController } from './viewportController.js';
import { RowController } from './rowController.js';
import { ColumnController } from './columnController.js';
import { RowNode } from './store.js';

describe('ViewportController Scrolling Range Computations', () => {
	it('should calculate correct visible indices at static scroll position', () => {
		const viewport = new ViewportController();
		viewport.setViewportSize(300, 200); // 300px wide, 200px tall

		// Row Controller setup: 10 rows of height 40 (total height 400)
		const rowCtrl = new RowController(40);
		const mockRowModel = {
			getRowCount: () => 10,
			getRow: (idx: number) => ({ id: `row-${idx}` }),
			getRowNode: (idx: number) => new RowNode(`row-${idx}`, {}),
			getRowIndexById: () => -1,
		};
		rowCtrl.registerRowModel(mockRowModel);
		rowCtrl.refreshRowGeometry({});

		// Column Controller setup: 6 columns of width 100 (total width 600)
		const colCtrl = new ColumnController(100);
		colCtrl.updateColumns(
			[
				{ field: 'A', header: 'Col A' },
				{ field: 'B', header: 'Col B' },
				{ field: 'C', header: 'Col C' },
				{ field: 'D', header: 'Col D' },
				{ field: 'E', header: 'Col E' },
				{ field: 'F', header: 'Col F' },
			],
			{}
		);

		// Static scroll coordinates: top = 100, left = 150
		viewport.setScrollPosition(100, 150);

		// Visible rows search offset span: [100, 100 + 200] = [100, 300]
		// rowTops: 0, 40, 80, 120, 160, 200, 240, 280, 320, 360
		// visible indices: index 2 (top 80) is before 100 but includes it, index 7 (top 280) is before 300
		const visibleRows = viewport.getVisibleRowRange(rowCtrl);

		// With default overscan of 8:
		// active start index: 2, active end index: 7
		// startIdx: max(0, 2 - 8) = 0
		// endIdx: min(9, 7 + 8) = 9
		expect(visibleRows.startIdx).toBe(0);
		expect(visibleRows.endIdx).toBe(9);

		const visibleCols = viewport.getVisibleColumnRange(colCtrl);
		// With default overscan of 4:
		// scroll Left bounds span: [150, 450]
		// colLefts: 0, 100, 200, 300, 400, 500
		// active start index: 1 (left 100), active end index: 4 (left 400)
		// startIdx: max(0, 1 - 4) = 0
		// endIdx: min(5, 4 + 4) = 5
		expect(visibleCols.startIdx).toBe(0);
		expect(visibleCols.endIdx).toBe(5);
	});

	it('should calculate velocity and expand boundaries predictively during active high-speed scrolling', () => {
		const viewport = new ViewportController();
		viewport.setViewportSize(300, 200);

		const rowCtrl = new RowController(40);
		rowCtrl.registerRowModel({
			getRowCount: () => 100,
			getRow: (idx: number) => ({ id: `row-${idx}` }),
			getRowNode: (idx: number) => new RowNode(`row-${idx}`, {}),
			getRowIndexById: () => -1,
		});
		rowCtrl.refreshRowGeometry({});

		// Set initial scroll state at t=1000
		viewport.setScrollPosition(100, 0, 1000);

		// Set high-speed downward scroll at t=1100 (diff = 100ms, dy = 150px => vy = 1.5 px/ms)
		viewport.setScrollPosition(250, 0, 1100);

		const vel = viewport.getVelocity();
		expect(vel.vy).toBe(1.5);

		// Expected active scroll window: top = 250, bottom = 450
		// active start row index: top 240 is index 6.
		// active end row index: top 440 is index 11.
		// Since scrolling down fast, bottom overscan increases by vy * 15 = 1.5 * 15 = 22 rows.
		// total bottom overscan = 12 (base) + 22 = 34 rows.
		// visibleRowRange endIdx = min(99, 11 + 34) = 45
		const visibleRows = viewport.getVisibleRowRange(rowCtrl);
		expect(visibleRows.startIdx).toBe(0); // max(0, 6 - 12)
		expect(visibleRows.endIdx).toBe(45);
	});

	it('should respect left and right pinned columns config to isolate scrollable visible space', () => {
		const viewport = new ViewportController();
		viewport.setViewportSize(400, 200);

		// Column Controller setup: 10 columns of width 100 (total width 1000)
		const colCtrl = new ColumnController(100);
		const cols = Array.from({ length: 10 }, (_, i) => ({ field: `C${i}`, header: `Col ${i}` }));
		colCtrl.updateColumns(cols, {});

		// Set Left Pinned to 2 columns (index 0, 1) and Right Pinned to 1 column (index 9)
		viewport.pinLeftColumns = 2; // occupied width = 200px
		viewport.pinRightColumns = 1; // occupied width = 100px

		// Scroll to left = 300
		viewport.setScrollPosition(0, 300);

		// PinnedLeft occupy 200px, PinnedRight occupy 100px.
		// Visible width left for scrollable columns = 400 - 300 = 100px.
		// scrollable search space left bounds: [300 + 200, 300 + 400 - 100] = [500, 600]
		// active scrollable visible start offset = 500, active visible end offset = 600.
		// colLefts: 0, 100, 200, 300, 400, 500, 600, 700, 800, 900
		// index 5 starts at left 500, index 6 starts at 600.
		// active start col: 5, active end col: 6
		// with overscan cols base 4:
		// startIdx: max(pinLeft = 2, 5 - 4) = 2
		// endIdx: min(colCount - 1 - pinRight = 8, 6 + 4) = 8
		const range = viewport.getVisibleColumnRange(colCtrl);
		expect(range.startIdx).toBe(2);
		expect(range.endIdx).toBe(8);
	});
});

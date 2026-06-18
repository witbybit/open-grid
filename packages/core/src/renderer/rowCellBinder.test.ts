// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from './cellSlot.js';
import { bindCellDuringScroll, type RowCellBinderDeps } from './rowCellBinder.js';

describe('bindCellDuringScroll', () => {
	it('marks newly mounted portal cells dirty and avoids stale previous-column values when the display cache misses', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.lastFormattedValue = 'previous-column-value';

		const deps: RowCellBinderDeps<{ id: string; total: number }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
					getCellValue: vi.fn(() => 42),
				},
				hasFormula: vi.fn(() => true),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately,
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: (cell) => {
				const host = document.createElement('div');
				cell.appendChild(host);
				return host;
			},
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			cancelPendingPortalRelease: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', total: 42 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'total', cellRenderer: () => null } as any,
			pinLeftColumns: 0,
			pinRightStart: 1,
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] },
				rowVersions: new Map(),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
		});

		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).toHaveBeenCalledWith(expect.objectContaining({ value: '' }));
		expect((deps.engine.data as any).getCellValue).not.toHaveBeenCalled();
	});
});

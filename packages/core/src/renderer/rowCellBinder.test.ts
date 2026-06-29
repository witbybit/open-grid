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
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map(),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).toHaveBeenCalledWith(expect.objectContaining({ value: '' }));
		expect((deps.engine.data as any).getCellValue).not.toHaveBeenCalled();
	});

	it('preserves warm primitive text and class names for a stable cell when the display cache misses during scroll', () => {
		const dirty = vi.fn();
		const wrote = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell og-cell-selected custom-class', 'text', undefined, 'Warm value');

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
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
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: wrote,
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name' } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map(),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastFormattedValue).toBe('Warm value');
		expect(cellSlot.lastClassName).toBe('og-cell og-cell-selected custom-class');
		expect(cellSlot.element.textContent).toContain('Warm value');
		expect(wrote).not.toHaveBeenCalled();
	});
});

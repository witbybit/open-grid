// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from './cellSlot.js';
import { bindCellDuringScroll, type RowCellBinderDeps } from './rowCellBinder.js';
import { createCellInstanceRendererKey } from './identityKeys.js';

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
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
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
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
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

	it('reuses a fresh logical snapshot for offscreen primitive cells instead of blanking them', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'snap-class',
					decorationClassName: '',
					classTokens: ['og-cell', 'snap-class'],
					className: 'og-cell snap-class',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: 'Snapshot title',
					validationError: 'Invalid value',
				})),
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
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
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
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: false,
		});

		expect(cellSlot.lastFormattedValue).toBe('Snapshot value');
		expect(cellSlot.lastClassName).toBe('og-cell snap-class');
		expect(cellSlot.element.title).toBe('Snapshot title');
		expect(cellSlot.element.dataset.validationError).toBe('Invalid value');
	});

	it('prefers a fresh logical snapshot over warm primitive content for visible cells during scroll', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell warm-class', 'text', undefined, 'Warm value');
		cellSlot.lastMountedGlobalVersion = 7;
		cellSlot.lastMountedRowVersion = 3;
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => 'Cached value that should not win') },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'snap-class',
					decorationClassName: '',
					classTokens: ['og-cell', 'snap-class'],
					className: 'og-cell snap-class',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: 'Snapshot title',
				})),
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
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
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
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastFormattedValue).toBe('Snapshot value');
		expect(cellSlot.lastClassName).toBe('og-cell snap-class');
		expect(cellSlot.element.title).toBe('Snapshot title');
		expect(deps.engine.data.getCachedDisplayValue as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});

	it('does not read cached display values for a visible primitive cell during scroll when no snapshot exists', () => {
		const getCachedDisplayValue = vi.fn(() => 'Cached value that should not win');
		const markCellDirtyAfterScroll = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
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
			markCellDirtyAfterScroll,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
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
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				hasInsightDecorations: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: true,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(getCachedDisplayValue).not.toHaveBeenCalled();
		expect(cellSlot.lastFormattedValue).toBe('...');
		expect(markCellDirtyAfterScroll).toHaveBeenCalledWith(cellSlot.element);
	});

	it('does not dirty a visible primitive cell solely because insight layers exist when the snapshot insight version is fresh', () => {
		const markCellDirtyAfterScroll = vi.fn();
		const incrementStyleHookCallsDuringScroll = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 4,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: '',
					decorationClassName: 'og-cell-validation-error',
					classTokens: ['og-cell', 'og-cell-validation-error'],
					className: 'og-cell og-cell-validation-error',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: 'Needs review',
					validationError: 'Needs review',
				})),
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
			markCellDirtyAfterScroll,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll,
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
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
				globalVersion: 7,
				insightVersion: 4,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				hasInsightDecorations: true,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastClassName).toBe('og-cell og-cell-validation-error');
		expect(markCellDirtyAfterScroll).not.toHaveBeenCalled();
		expect(incrementStyleHookCallsDuringScroll).not.toHaveBeenCalled();
	});

	it('does not dirty a visible primitive cell solely because style rules changed when the snapshot style version is fresh', () => {
		const markCellDirtyAfterScroll = vi.fn();
		const incrementStyleHookCallsDuringScroll = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 5,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'styled-cell',
					decorationClassName: '',
					classTokens: ['og-cell', 'styled-cell'],
					className: 'og-cell styled-cell',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: '',
				})),
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
			markCellDirtyAfterScroll,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll,
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 5, loadingVersion: 0 }),
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
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 5,
				selectionVersion: 0,
				hasDeferredCellStyleRules: true,
				hasInsightDecorations: false,
				isScrolling: true,
				loadingVersion: 0,
				styleChangedDuringScroll: true,
				selectionChangedDuringScroll: false,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastClassName).toBe('og-cell styled-cell');
		expect(markCellDirtyAfterScroll).not.toHaveBeenCalled();
		expect(incrementStyleHookCallsDuringScroll).not.toHaveBeenCalled();
	});

	it('does not dirty a visible primitive cell solely because selection changed when the snapshot selection version is fresh', () => {
		const markCellDirtyAfterScroll = vi.fn();
		const incrementStyleHookCallsDuringScroll = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 5,
					loadingVersion: 0,
					selectionVersion: 9,
					baseClassName: 'og-cell',
					stateClassName: 'og-cell-selected',
					decorationClassName: '',
					classTokens: ['og-cell', 'og-cell-selected'],
					className: 'og-cell og-cell-selected',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: '',
				})),
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
			markCellDirtyAfterScroll,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll,
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 5, loadingVersion: 0 }),
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
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 5,
				selectionVersion: 9,
				hasDeferredCellStyleRules: true,
				hasInsightDecorations: false,
				isScrolling: true,
				loadingVersion: 0,
				styleChangedDuringScroll: false,
				selectionChangedDuringScroll: true,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastClassName).toBe('og-cell og-cell-selected');
		expect(markCellDirtyAfterScroll).not.toHaveBeenCalled();
		expect(incrementStyleHookCallsDuringScroll).not.toHaveBeenCalled();
	});

	it('reuses a fresh logical portal snapshot for buffered offscreen cells instead of downgrading them to empty', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell portal-warm', 'portal', undefined, '', portalKey);
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'portal-warm',
					decorationClassName: '',
					classTokens: ['og-cell', 'portal-warm'],
					className: 'og-cell portal-warm',
					contentKind: 'portal-live',
					contentMode: 'portal',
					formattedValue: '',
					title: 'Portal snapshot',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
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
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: false,
		});

		expect(cellSlot.lastContentMode).toBe('portal');
		expect(cellSlot.lastPortalKey).toBe(portalKey);
		expect(cellSlot.element.title).toBe('Portal snapshot');
	});

	it('materializes a buffered primitive compatibility snapshot before preserving offscreen warm content', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell warm-class', 'text', undefined, 'Name 1', undefined);
		cellSlot.element.title = 'Warm title';
		cellSlot.element.dataset.validationError = 'Needs review';
		const snapshotSet = vi.fn();

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
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
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
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
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: false,
		});

		expect(snapshotSet).toHaveBeenCalledTimes(1);
		expect(snapshotSet).toHaveBeenCalledWith(
			expect.objectContaining({
				rowId: 'r1',
				colField: 'name',
				contentMode: 'text',
				contentKind: 'text',
				formattedValue: 'Name 1',
				title: 'Warm title',
				validationError: 'Needs review',
			})
		);
		expect(cellSlot.lastFormattedValue).toBe('Name 1');
	});

	it('materializes a buffered portal compatibility snapshot before preserving offscreen warm portal content', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell portal-warm', 'portal', undefined, '', portalKey);
		cellSlot.element.title = 'Portal warm title';
		cellSlot.element.dataset.validationError = 'Needs review';
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;
		const snapshotSet = vi.fn();

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
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
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: false,
		});

		expect(snapshotSet).toHaveBeenCalledTimes(1);
		expect(snapshotSet).toHaveBeenCalledWith(
			expect.objectContaining({
				rowId: 'r1',
				colField: 'name',
				contentMode: 'portal',
				contentKind: 'portal-frozen',
				title: 'Portal warm title',
				validationError: 'Needs review',
			})
		);
		expect(cellSlot.lastPortalKey).toBe(portalKey);
	});

	it('trusts a fresh visible portal snapshot and host presence before consulting the mount registry', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const isCellMounted = vi.fn(() => {
			throw new Error('mount registry should not be consulted when snapshot + host are fresh');
		});
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell portal-warm', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 7;
		cellSlot.lastMountedRowVersion = 3;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'portal-warm',
					decorationClassName: '',
					classTokens: ['og-cell', 'portal-warm'],
					className: 'og-cell portal-warm',
					contentKind: 'portal-live',
					contentMode: 'portal',
					formattedValue: '',
					title: 'Portal snapshot',
				})),
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted,
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
			ensureCellPortalHost: () => host,
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(isCellMounted).not.toHaveBeenCalled();
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('materializes a compatibility snapshot for visible primitive cells when insight decorations are missing from the snapshot cache', () => {
		const dirty = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const snapshotSet = vi.fn();
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => 'Name 1'),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
				insights: {
					getCellDecorations: vi.fn(() => [
						{
							layerId: 'integrity',
							kind: 'validationError',
							className: 'og-cell-validation-error',
							title: 'Needs review',
						},
					]),
				},
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
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
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
				globalVersion: 7,
				hasDeferredCellStyleRules: false,
				hasInsightDecorations: true,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: true,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(cellSlot.lastClassName).toContain('og-cell-validation-error');
		expect(cellSlot.element.dataset.validationError).toBe('Needs review');
		expect(cellSlot.element.title).toContain('Needs review');
		expect(snapshotSet).toHaveBeenCalledTimes(1);
		expect(dirty).not.toHaveBeenCalled();
	});

	it('materializes a compatibility snapshot that preserves warm primitive content when insight decorations are missing', () => {
		const dirty = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell preserved', 'text', undefined, 'Name 1', undefined);
		cellSlot.lastMountedGlobalVersion = 7;
		cellSlot.lastMountedRowVersion = 3;
		const snapshotSet = vi.fn();

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => 'Name 1'),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
				insights: {
					getCellDecorations: vi.fn(() => [
						{
							layerId: 'integrity',
							kind: 'validationError',
							className: 'og-cell-validation-error',
							title: 'Needs review',
						},
					]),
				},
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
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
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
				globalVersion: 7,
				hasDeferredCellStyleRules: false,
				hasInsightDecorations: true,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastClassName).toContain('preserved');
		expect(cellSlot.lastClassName).toContain('og-cell-validation-error');
		expect(cellSlot.element.dataset.validationError).toBe('Needs review');
		expect(cellSlot.element.title).toContain('Needs review');
		expect(snapshotSet).toHaveBeenCalledTimes(1);
		expect(dirty).not.toHaveBeenCalled();
	});

	it('does not mark a stable frozen portal cell dirty during scroll when nothing changed', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 1;
		cellSlot.lastMountedRowVersion = 2;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
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
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
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
				rowVersions: new Map([['r1', 2]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('materializes a visible warm portal compatibility snapshot before preserving a stable frozen portal cell', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const snapshotSet = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 1;
		cellSlot.lastMountedRowVersion = 2;
		cellSlot.element.title = 'Portal warm title';
		cellSlot.element.dataset.validationError = 'Needs review';
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
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
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				hasDeferredCellStyleRules: false,
				insightVersion: 0,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 2]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(snapshotSet).toHaveBeenCalledTimes(1);
		expect(snapshotSet).toHaveBeenCalledWith(
			expect.objectContaining({
				rowId: 'r1',
				colField: 'name',
				contentMode: 'portal',
				contentKind: 'portal-frozen',
				title: 'Portal warm title',
				validationError: 'Needs review',
			})
		);
	});

	it('does not remount a stable frozen custom-live portal during scroll when versions are unchanged', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 4;
		cellSlot.lastMountedRowVersion = 7;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
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
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 4,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 7]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('does not dirty a stable frozen portal cell solely because insight layers exist when a fresh portal snapshot is available', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class og-cell-validation-error', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 4;
		cellSlot.lastMountedRowVersion = 7;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => ({
						rowId: 'r1',
						colField: 'name',
						rowVersion: 7,
						globalVersion: 4,
						insightVersion: 3,
						styleVersion: 0,
						loadingVersion: 0,
						selectionVersion: 0,
						contentKind: 'portal-live',
						contentMode: 'portal',
						formattedValue: '',
						baseClassName: 'og-cell',
						stateClassName: '',
						decorationClassName: 'og-cell-validation-error',
						classTokens: ['og-cell', 'og-cell-validation-error'],
						className: 'og-cell og-cell-validation-error',
						title: 'Needs review',
						validationError: 'Needs review',
					})),
				},
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
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
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 4,
				hasDeferredCellStyleRules: false,
				hasInsightDecorations: true,
				insightVersion: 3,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 7]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(cellSlot.element.dataset.validationError).toBe('Needs review');
	});

	it('remounts a visible portal cell when its host is empty even if the mount registry still says it is mounted', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		cellSlot.element.appendChild(host);
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 4;
		cellSlot.lastMountedRowVersion = 7;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
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
			ensureCellPortalHost: () => host,
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 4,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 7]]),
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

		expect(showPortalContent).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).toHaveBeenCalledWith(expect.objectContaining({ cellKey: portalKey, container: host }));
	});
});

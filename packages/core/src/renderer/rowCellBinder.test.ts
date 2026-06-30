// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from './cellSlot.js';
import { bindCellDuringScroll, type RowCellBinderDeps } from './rowCellBinder.js';
import { createCellInstanceRendererKey } from './identityKeys.js';

describe('bindCellDuringScroll', () => {
	it('shows text impostor for custom-mode portal cells during scroll without mounting the portal', () => {
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

		// custom-mode portals take the impostor path during scroll — no synchronous mount.
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).not.toHaveBeenCalled();
		// stale previous-column value must not bleed through (isWarmBindingVersionFresh is false for a new slot)
		expect(cellSlot.lastFormattedValue).toBe('');
		expect(cellSlot.lastContentMode).toBe('empty');
		expect((deps.engine.data as any).getCellValue).not.toHaveBeenCalled();
	});

	it('preserves warm primitive text and class names for a stable cell when the display cache misses during scroll', () => {
		const dirty = vi.fn();
		const wrote = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell og-cell-selected custom-class', 'text', undefined, 'Warm value');
		// Version stamps must match ctx for isWarmBindingVersionFresh to pass.
		cellSlot.lastMountedRowVersion = -1; // rowVersions is empty → rowVersion = -1
		cellSlot.lastMountedGlobalVersion = 1;
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
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
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

	it('does not promote buffered primitive DOM state into snapshot truth during scroll', () => {
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

		expect(snapshotSet).not.toHaveBeenCalled();
		expect(cellSlot.lastContentMode).toBe('empty');
		expect(cellSlot.lastFormattedValue).toBe('');
		expect(cellSlot.element.title).toBe('');
		expect(cellSlot.element.dataset.validationError).toBeUndefined();
	});

	it('does not promote buffered portal DOM state into snapshot truth during scroll', () => {
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

		expect(snapshotSet).not.toHaveBeenCalled();
		expect(cellSlot.lastContentMode).toBe('empty');
		expect(cellSlot.lastPortalKey).toBeUndefined();
		expect(cellSlot.element.title).toBe('');
		expect(cellSlot.element.dataset.validationError).toBeUndefined();
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

	it('uses a fresh custom-live impostor snapshot during scroll instead of immediately mounting the portal', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
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
					stateClassName: 'og-cell-readonly',
					decorationClassName: '',
					classTokens: ['og-cell', 'og-cell-readonly'],
					className: 'og-cell og-cell-readonly',
					contentKind: 'impostor',
					contentMode: 'fallback',
					formattedValue: 'Fallback name',
					title: 'Fallback title',
				})),
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

		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('Fallback name');
		expect(cellSlot.element.title).toBe('Fallback title');
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('synthesizes a cheap text impostor for a new custom-live cell with no prewarm snapshot instead of live-mounting during scroll', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; amount: number }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
				getCheapDisplayValue: vi.fn(() => '$42'),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
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
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
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
			node: { id: 'r1', data: { id: 'r1', amount: 42 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'amount', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 1]]),
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

		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('$42');
	});

	it('uses impostor snapshot for a pinned-left custom-live cell during scroll, same as center lane', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 1,
					globalVersion: 5,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell og-cell-pinned-left',
					stateClassName: '',
					decorationClassName: '',
					classTokens: ['og-cell', 'og-cell-pinned-left'],
					className: 'og-cell og-cell-pinned-left',
					contentKind: 'impostor',
					contentMode: 'fallback',
					formattedValue: 'Pinned value',
					title: '',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
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
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
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
			lane: 'left',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 5,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 1]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 120,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('Pinned value');
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('uses impostor snapshot for a pinned-right custom-live cell during scroll, same as center lane', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; score: number }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r2',
					colField: 'score',
					rowVersion: 2,
					globalVersion: 9,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell og-cell-pinned-right',
					stateClassName: '',
					decorationClassName: '',
					classTokens: ['og-cell', 'og-cell-pinned-right'],
					className: 'og-cell og-cell-pinned-right',
					contentKind: 'impostor',
					contentMode: 'fallback',
					formattedValue: '99',
					title: '',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
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
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
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
			node: { id: 'r2', data: { id: 'r2', score: 99 } } as any,
			rowIndex: 3,
			colIndex: 0,
			col: { field: 'score', cellRenderer: () => null } as any,
			lane: 'right',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 9,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r2', 2]]),
			} as any,
			pooledRowId: 'slot-2',
			pooledRowGeneration: 0,
			left: 0,
			right: 0,
			width: 80,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('99');
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('synthesizes a cheap text impostor for a new custom-imperative cell instead of live-mounting during scroll', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; price: number }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
				getCheapDisplayValue: vi.fn(() => '$99'),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
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
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
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
			node: { id: 'r1', data: { id: 'r1', price: 99 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'price', cellRenderer: () => null, cellRendererCapabilities: { imperativeUpdate: true } } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-imperative' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 1]]),
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

		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('$99');
	});

	it('uses scrollImpostor callback when provided, overriding the generic display value', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const scrollImpostor = vi.fn(({ formattedValue }: { value: unknown; formattedValue: string }) => `★ ${formattedValue}`);
		const deps: RowCellBinderDeps<{ id: string; price: number }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
				getCheapDisplayValue: vi.fn(() => '42'),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
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
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
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
			node: { id: 'r1', data: { id: 'r1', price: 42 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: {
				field: 'price',
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollBehavior: 'live', scrollImpostor },
			} as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 1]]),
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

		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(scrollImpostor).toHaveBeenCalled();
		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('★ 42');
	});

	it('marks visible primitive cells dirty instead of materializing insight snapshots during scroll', () => {
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

		expect(cellSlot.lastClassName).toBe('og-cell');
		expect(cellSlot.element.dataset.validationError).toBeUndefined();
		expect(cellSlot.element.title).toBe('');
		expect(snapshotSet).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastFormattedValue).toBe('...');
	});

	it('keeps warm visible primitive text as a temporary compatibility edge but still marks it dirty when snapshots are missing', () => {
		const dirty = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell preserved', 'text', undefined, 'Name 1', undefined);
		// All version stamps must match the ctx for isWarmBindingVersionFresh to pass.
		cellSlot.lastMountedGlobalVersion = 7;
		cellSlot.lastMountedRowVersion = 3;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;
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
				insightVersion: 0,
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

		expect(cellSlot.lastClassName).toContain('preserved');
		expect(cellSlot.lastClassName).not.toContain('og-cell-validation-error');
		expect(cellSlot.element.dataset.validationError).toBeUndefined();
		expect(cellSlot.element.title).toBe('');
		expect(snapshotSet).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastFormattedValue).toBe('Name 1');
	});

	it('does not mark a stable frozen portal cell dirty during scroll when nothing changed', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
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
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 2,
					globalVersion: 1,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'custom-class',
					decorationClassName: '',
					classTokens: ['og-cell', 'custom-class'],
					className: 'og-cell custom-class',
					contentKind: 'portal-frozen',
					contentMode: 'portal',
					formattedValue: '',
					title: '',
				})),
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
				globalVersion: 1,
				hasDeferredCellStyleRules: false,
				insightVersion: 0,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] },
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

		expect(showPortalContent).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).toHaveBeenCalledTimes(1);
		expect(snapshotSet).not.toHaveBeenCalled();
	});

	it('does not remount a stable frozen custom-live portal during scroll when versions are unchanged', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
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
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 7,
					globalVersion: 4,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'custom-class',
					decorationClassName: '',
					classTokens: ['og-cell', 'custom-class'],
					className: 'og-cell custom-class',
					contentKind: 'portal-frozen',
					contentMode: 'portal',
					formattedValue: '',
					title: '',
				})),
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
				insightVersion: 0,
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
	});

	it('does not dirty a stable frozen portal cell solely because insight layers exist when a fresh portal snapshot is available', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
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

	it('defers the portal mount to the fidelity lane when a custom-live host is empty, rather than mounting synchronously during scroll', () => {
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

		// The cell had an empty portal host — no live content to freeze.
		// The scroll frame must not call mountCellImmediately; instead, the cell
		// is shown as a cheap text impostor and deferred to the post-scroll fidelity lane.
		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		// No getCheapDisplayValue mock → empty fallback; cell shows 'empty' mode.
		expect(cellSlot.lastContentMode).toBe('empty');
	});
});

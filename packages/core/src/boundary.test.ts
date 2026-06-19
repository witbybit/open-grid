import { describe, it, expect } from 'vitest';
import * as publicApi from './index.js';
import * as experimentalApi from './experimental.js';
import * as internalApi from './internal.js';
import { createClientGrid, getStoreFromApi } from './createGrid.js';

describe('Public/internal boundary', () => {
	describe('Public entry (@open-grid/core)', () => {
		it('does not export GridStore', () => {
			expect((publicApi as Record<string, unknown>)['GridStore']).toBeUndefined();
		});

		it('does not export RenderEngine / GridEngine', () => {
			expect((publicApi as Record<string, unknown>)['RenderEngine']).toBeUndefined();
			expect((publicApi as Record<string, unknown>)['GridEngine']).toBeUndefined();
		});

		it('does not export RowRenderer', () => {
			expect((publicApi as Record<string, unknown>)['RowRenderer']).toBeUndefined();
		});

		it('does not export mountGridHost', () => {
			expect((publicApi as Record<string, unknown>)['mountGridHost']).toBeUndefined();
		});

		it('does not export InternalColumnDef', () => {
			// InternalColumnDef is a type-only export; at runtime it should not appear
			expect((publicApi as Record<string, unknown>)['InternalColumnDef']).toBeUndefined();
		});

		it('does not export renderer classes', () => {
			const rendererClasses = [
				'GeometryController',
				'InvalidationManager',
				'PortalMountManager',
				'RenderOrchestrator',
				'RenderScheduler',
				'CellRenderer',
				'FullWidthRowRenderer',
				'HeaderRenderer',
				'OverlayRenderer',
				'ViewportRenderer',
			];
			for (const name of rendererClasses) {
				expect((publicApi as Record<string, unknown>)[name], `${name} must not be in public entry`).toBeUndefined();
			}
		});

		it('exports createClientGrid', () => {
			expect(typeof publicApi.createClientGrid).toBe('function');
		});

		it('matches the reviewed alpha runtime export snapshot', () => {
			expect(Object.keys(publicApi).sort()).toEqual([
				'BUILT_IN_THEMES',
				'BUILT_IN_THEME_METADATA',
				'BUILT_IN_THEME_ORDER',
				'COOL_BLUE_THEME',
				'DARK_THEME',
				'DATE_OPS',
				'GRID_STATE_SCHEMA_VERSION',
				'GridEventName',
				'GridMetric',
				'HIGH_CONTRAST_DARK_THEME',
				'HIGH_CONTRAST_LIGHT_THEME',
				'LIGHT_THEME',
				'MINIMAL_MONOCHROME_THEME',
				'NUMBER_OPS',
				'RowNode',
				'TEXT_OPS',
				'ThemeManager',
				'WARM_ORANGE_THEME',
				'applyFilterToModel',
				'buildFilterByValue',
				'createApiFacade',
				'createClientGrid',
				'createLocalStorageAdapter',
				'createServerGrid',
				'createTheme',
				'defaultOpForType',
				'getBuiltInTheme',
				'getFilterChipText',
				'getOpMeta',
				'getOpsForType',
				'isBuiltInThemeName',
				'isDomCellRenderer',
				'isFilterableColumn',
				'registerGridContextMenu',
				'registerGridNavigation',
				'resolveColumnFilterDef',
				'themeToCSSVariables',
				'validateSchemaVersion',
			]);
		});

		it('does not export experimental style-rule compiler or concrete instrumentation helpers', () => {
			for (const name of [
				'compileStyleRules',
				'NoopGridInstrumentation',
				'RecordingGridInstrumentation',
				'NOOP_INSTRUMENTATION',
				'canEditCell',
				'canFocusVisualRow',
				'isDataVisualRow',
				'isDataCellSelectable',
				'isEditableVisualRow',
				'isFullWidthVisualRow',
				'isSelectableVisualRow',
				'parseVisualRowId',
				'toDataVisualRowId',
				'toDetailVisualRowId',
				'toFooterVisualRowId',
				'toGroupVisualRowId',
				'toLoadingVisualRowId',
			]) {
				expect((publicApi as Record<string, unknown>)[name], `${name} must not be in public entry`).toBeUndefined();
			}
		});

		it('exports ColumnDef-related types (runtime value: nothing) and GridApi (no runtime value)', () => {
			// These are type-only exports; they leave no runtime footprint — just confirm the module loads
			expect(publicApi).toBeDefined();
		});
	});

	describe('Experimental entry (@open-grid/core/experimental)', () => {
		it('exports style-rule compiler, visual-row helpers, and concrete instrumentation helpers', () => {
			expect(typeof (experimentalApi as Record<string, unknown>)['compileStyleRules']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['NoopGridInstrumentation']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['RecordingGridInstrumentation']).toBe('function');
			expect((experimentalApi as Record<string, unknown>)['NOOP_INSTRUMENTATION']).toBeDefined();
			expect(typeof (experimentalApi as Record<string, unknown>)['canEditCell']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['isDataVisualRow']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['parseVisualRowId']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['toDataVisualRowId']).toBe('function');
		});

		it('matches the reviewed experimental runtime export snapshot', () => {
			expect(Object.keys(experimentalApi).sort()).toEqual([
				'NOOP_INSTRUMENTATION',
				'NoopGridInstrumentation',
				'RecordingGridInstrumentation',
				'canEditCell',
				'canFocusVisualRow',
				'compileStyleRules',
				'isDataCellSelectable',
				'isDataVisualRow',
				'isEditableVisualRow',
				'isFullWidthVisualRow',
				'isSelectableVisualRow',
				'parseVisualRowId',
				'toDataVisualRowId',
				'toDetailVisualRowId',
				'toFooterVisualRowId',
				'toGroupVisualRowId',
				'toLoadingVisualRowId',
			]);
		});
	});

	describe('Internal entry (@open-grid/core/internal)', () => {
		it('exports mountGridHost', () => {
			expect(typeof (internalApi as Record<string, unknown>)['mountGridHost']).toBe('function');
		});

		it('exports the imperative renderer capability helper', () => {
			expect(typeof (internalApi as Record<string, unknown>)['hasImperativeRendererCapability']).toBe('function');
		});

		it('does not export raw store, engine, model, or renderer classes', () => {
			const rawInternals = [
				'GridStore',
				'GridEngine',
				'StateManager',
				'CommandHistory',
				'EventBus',
				'DataModel',
				'ColumnModel',
				'ViewportModel',
				'CellAccessModel',
				'GeometryController',
				'InvalidationManager',
				'PortalMountManager',
				'RenderEngine',
				'RenderOrchestrator',
				'RenderScheduler',
				'CellRenderer',
				'FullWidthRowRenderer',
				'HeaderRenderer',
				'OverlayRenderer',
				'RowRenderer',
				'ViewportRenderer',
				'getStoreFromApi',
			];
			for (const name of rawInternals) {
				expect((internalApi as Record<string, unknown>)[name], `${name} must not be in internal entry`).toBeUndefined();
			}
		});

		it('matches the reviewed adapter-only runtime export snapshot', () => {
			expect(Object.keys(internalApi).sort()).toEqual(['hasImperativeRendererCapability', 'mountGridHost']);
		});
	});

	describe('GridApi facade', () => {
		it('is frozen', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] });
			expect(Object.isFrozen(api)).toBe(true);
		});

		it('does not expose store, engine, or renderer-level methods on public API', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] }) as Record<string, unknown>;
			const internalOnlyMethods = [
				'store',
				'engine',
				'getState',
				'getRenderStats',
				'resetRenderStats',
				'getVisualRow',
				'getCellAccess',
				'subscribeToCell',
				'subscribeToRow',
				'subscribeToViewport',
				'getCachedDisplayValue',
				'getCheapDisplayValue',
				'getComputedCellValue',
				'getCellState',
				'getRowOverscanPx',
				'setRowOverscanPx',
			];
			for (const method of internalOnlyMethods) {
				expect(api[method], `${method} must not be on public GridApi`).toBeUndefined();
			}
		});

		it('exposes getStateSnapshot on the public API', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] });
			expect(typeof api.getStateSnapshot).toBe('function');
			expect(api.getStateSnapshot()).toEqual(
				expect.objectContaining({
					columns: expect.any(Array),
					selection: expect.any(Object),
					selectedRowIds: expect.any(Array),
				})
			);
		});

		it('getStoreFromApi returns a store for a valid API', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] });
			const store = getStoreFromApi(api);
			expect(typeof store.getState).toBe('function');
		});

		it('getStoreFromApi throws for a plain object', () => {
			expect(() => getStoreFromApi({} as never)).toThrow('Invalid GridApi');
		});

		it('getStoreFromApi throws for a frozen plain object', () => {
			const fake = Object.freeze({ getState: () => ({}) });
			expect(() => getStoreFromApi(fake as never)).toThrow('Invalid GridApi');
		});

		it('public API has no __getEngine escape hatch', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] }) as Record<string, unknown>;
			expect(api['__getEngine']).toBeUndefined();
		});

		it('public API has no __getInternalApi escape hatch', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] }) as Record<string, unknown>;
			expect(api['__getInternalApi']).toBeUndefined();
		});

		it('Object.getOwnPropertyNames(api) contains no hidden bridge properties', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] });
			const names = Object.getOwnPropertyNames(api);
			expect(names).not.toContain('__getEngine');
			expect(names).not.toContain('__getInternalApi');
		});
	});
});

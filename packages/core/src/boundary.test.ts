import { describe, it, expect } from 'vitest';
import * as publicApi from './index.js';
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

		it('exports ColumnDef-related types (runtime value: nothing) and GridApi (no runtime value)', () => {
			// These are type-only exports; they leave no runtime footprint — just confirm the module loads
			expect(publicApi).toBeDefined();
		});
	});

	describe('Internal entry (@open-grid/core/internal)', () => {
		it('exports mountGridHost', () => {
			expect(typeof (internalApi as Record<string, unknown>)['mountGridHost']).toBe('function');
		});

		it('exports getStoreFromApi', () => {
			expect(typeof (internalApi as Record<string, unknown>)['getStoreFromApi']).toBe('function');
		});

		it('exports getInternalApiFromApi', () => {
			expect(typeof (internalApi as Record<string, unknown>)['getInternalApiFromApi']).toBe('function');
		});

		it('exports renderer classes', () => {
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
				'RowRenderer',
				'ViewportRenderer',
			];
			for (const name of rendererClasses) {
				expect((internalApi as Record<string, unknown>)[name], `${name} must be in internal entry`).toBeDefined();
			}
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
	});
});

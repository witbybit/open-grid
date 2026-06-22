import { describe, expect, it } from 'vitest';
import * as publicApi from './index.js';
import * as experimentalApi from './experimental.js';

describe('React public boundary', () => {
	it('keeps the alpha entry focused on the grid and stable hooks', () => {
		expect((publicApi as Record<string, unknown>)['Grid']).toBeTypeOf('function');
		expect((publicApi as Record<string, unknown>)['useGridApi']).toBeTypeOf('function');
		expect((publicApi as Record<string, unknown>)['useGridSelector']).toBeTypeOf('function');
		expect((publicApi as Record<string, unknown>)['useGridKeySelector']).toBeTypeOf('function');
	});

	it('matches the reviewed alpha runtime export snapshot', () => {
		expect(Object.keys(publicApi).sort()).toEqual([
			'BUILTIN_COLUMN_TYPES',
			'BUILT_IN_THEMES',
			'BUILT_IN_THEME_METADATA',
			'BUILT_IN_THEME_ORDER',
			'CAPABILITY_ALLOWED',
			'CheckboxCellRenderer',
			'DateCellEditor',
			'DateCellRenderer',
			'Grid',
			'GridEventName',
			'MultiSelectCellRenderer',
			'TagsCellRenderer',
			'createDropdownCellEditor',
			'createDropdownCellRenderer',
			'createLocalStorageAdapter',
			'createLocalStorageWorkspaceAdapter',
			'createMultiSelectCellEditor',
			'createMultiSelectCellRenderer',
			'createNumberCellEditor',
			'createNumberCellRenderer',
			'createTheme',
			'dropdownColumnType',
			'getBuiltInTheme',
			'isBuiltInThemeName',
			'isDomCellRenderer',
			'multiSelectColumnType',
			'normalizeCapabilityResult',
			'numberColumnType',
			'parseMultiValue',
			'resolveColumnFilterDef',
			'themeToCSSVariables',
			'useGridApi',
			'useGridKeySelector',
			'useGridSelector',
		]);
	});

	it('does not export incubating portal, formula, chart, or filter renderer helpers from the main entry', () => {
		const removed = ['PortalCell', 'PortalManager', 'FormulaBar', 'ColumnFilterRenderer', 'ChartType', 'ChartTheme', 'ValueFormat'];
		for (const name of removed) {
			expect((publicApi as Record<string, unknown>)[name], `${name} must not be exported from @open-grid/react`).toBeUndefined();
		}
	});

	it('re-homes incubating helpers under the experimental entry', () => {
		expect((experimentalApi as Record<string, unknown>)['PortalCell']).toBeDefined();
		expect((experimentalApi as Record<string, unknown>)['PortalManager']).toBeDefined();
		expect((experimentalApi as Record<string, unknown>)['FormulaBar']).toBeDefined();
		expect((experimentalApi as Record<string, unknown>)['ColumnFilterRenderer']).toBeDefined();
	});

	it('matches the reviewed experimental runtime export snapshot', () => {
		expect(Object.keys(experimentalApi).sort()).toEqual(['ColumnFilterRenderer', 'FormulaBar', 'PortalCell', 'PortalManager']);
	});
});

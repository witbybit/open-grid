import { describe, expect, it } from 'vitest';
import * as publicApi from './index.js';

describe('React public boundary', () => {
	it('keeps the alpha entry focused on the grid and stable hooks', () => {
		expect((publicApi as Record<string, unknown>)['Grid']).toBeTypeOf('function');
		expect((publicApi as Record<string, unknown>)['useGridApi']).toBeTypeOf('function');
		expect((publicApi as Record<string, unknown>)['useGridSelector']).toBeTypeOf('function');
		expect((publicApi as Record<string, unknown>)['useGridKeySelector']).toBeTypeOf('function');
	});

	it('does not export incubating portal, formula, chart, or filter renderer helpers from the main entry', () => {
		const removed = ['PortalCell', 'PortalManager', 'FormulaBar', 'ColumnFilterRenderer', 'ChartType', 'ChartTheme', 'ValueFormat'];
		for (const name of removed) {
			expect((publicApi as Record<string, unknown>)[name], `${name} must not be exported from @open-grid/react`).toBeUndefined();
		}
	});
});

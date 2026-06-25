import { describe, expect, it } from 'vitest';
import * as publicApi from './index.js';
import * as experimentalApi from './experimental.js';

describe('React public boundary', () => {
	it('exports Grid as the canonical grid entrypoint', () => {
		expect(typeof (publicApi as Record<string, unknown>)['Grid']).toBe('function');
		// GridNext was merged into Grid — it no longer exists as a separate export
		expect((publicApi as Record<string, unknown>)['GridNext']).toBeUndefined();
	});

	it('exports React context and hooks', () => {
		expect(typeof (publicApi as Record<string, unknown>)['GridApiContext']).toBeDefined();
		expect(typeof (publicApi as Record<string, unknown>)['GridApiProvider']).toBe('function');
		expect(typeof (publicApi as Record<string, unknown>)['useGridApi']).toBe('function');
		expect(typeof (publicApi as Record<string, unknown>)['useGridSelector']).toBe('function');
		expect(typeof (publicApi as Record<string, unknown>)['useGridKeySelector']).toBe('function');
	});

	it('exports portal system', () => {
		expect(typeof (publicApi as Record<string, unknown>)['GridPortalStore']).toBe('function');
		expect(typeof (publicApi as Record<string, unknown>)['GridPortal']).toBe('function');
	});

	it('exports theme utilities', () => {
		expect(typeof (publicApi as Record<string, unknown>)['createTheme']).toBe('function');
		expect(typeof (publicApi as Record<string, unknown>)['BUILT_IN_THEMES']).toBe('object');
		expect(typeof (publicApi as Record<string, unknown>)['ThemeManager']).toBe('function');
	});

	it('does not export deleted internals', () => {
		expect((publicApi as Record<string, unknown>)['GridView']).toBeUndefined();
		expect((publicApi as Record<string, unknown>)['GridStore']).toBeUndefined();
		expect((publicApi as Record<string, unknown>)['GridEngine']).toBeUndefined();
	});

	it('experimental entry is empty during Stage 6 migration', () => {
		expect(Object.keys(experimentalApi)).toHaveLength(0);
	});
});

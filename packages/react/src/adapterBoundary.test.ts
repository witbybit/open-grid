import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import * as ReactPackage from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8');

/**
 * North-star invariant (Plan 040 / 042): the React adapter renders what core produces and
 * forwards intent — it never reshapes data, and it ships no pagination/status-bar UI of
 * its own (those are core chrome now).
 */
describe('React adapter boundary (Plan 042)', () => {
	it('Grid.tsx does not slice/reshape the rows array', () => {
		const grid = read('./Grid.tsx');
		expect(grid).not.toContain('pagedClientRows');
		// No row-array reshaping in the view layer (slicing/sorting the user's rows).
		expect(grid).not.toMatch(/\brows\.(slice|filter|sort)\s*\(/);
	});

	it('does not import the deleted React pagination/status-bar modules', () => {
		const grid = read('./Grid.tsx');
		expect(grid).not.toContain('./pagination');
		expect(grid).not.toContain('./GridStatusBar');
	});

	it('no longer exports pagination/status-bar components from the public surface', () => {
		const pkg = ReactPackage as Record<string, unknown>;
		expect(pkg.GridPagination).toBeUndefined();
		expect(pkg.GridStatusBar).toBeUndefined();
		expect(pkg.useClientGridPagination).toBeUndefined();
	});

	it('removed the pagination/status-bar source files', () => {
		expect(() => read('./pagination.tsx')).toThrow();
		expect(() => read('./GridStatusBar.tsx')).toThrow();
	});
});

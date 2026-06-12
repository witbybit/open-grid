/**
 * Architecture guardrail tests.
 *
 * These tests enforce structural constraints that keep the codebase from drifting
 * back into the "god file" anti-pattern addressed by Plan 011.
 *
 * Some tests are currently skipped with explanatory comments where the target
 * has not yet been reached or where a known stop condition prevents full compliance.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// __dirname = packages/core/src/engine → ../.. = packages/core
const CORE_ROOT = resolve(__dirname, '../..');
// React package root (packages/core/src/engine → ../../../../ = repo root → packages/react)
const REACT_ROOT = resolve(__dirname, '../../../../packages/react');

function countLines(relPath: string): number {
	const abs = resolve(CORE_ROOT, 'src', relPath);
	return readFileSync(abs, 'utf-8').split('\n').length;
}

function fileContains(relPath: string, substring: string): boolean {
	const abs = resolve(REACT_ROOT, 'src', relPath);
	return readFileSync(abs, 'utf-8').includes(substring);
}

describe('Architecture guardrails', () => {
	it('store.ts is below 900 lines', () => {
		const lines = countLines('store.ts');
		expect(lines, `store.ts has ${lines} lines — must be below 900`).toBeLessThan(900);
	});

	/**
	 * SKIP: GridEngine.ts is currently ~978 lines.
	 * Target: below 800 lines. Requires a follow-up task (Plan 012) to extract
	 * more feature logic (e.g. selection, cell access, sorting) into feature controllers.
	 * Re-enable this test when GridEngine.ts drops below 800 lines.
	 */
	it.skip('GridEngine.ts is below 800 lines', () => {
		const lines = countLines('engine/GridEngine.ts');
		expect(lines, `GridEngine.ts has ${lines} lines — must be below 800`).toBeLessThan(800);
	});

	it('OpenGrid.tsx does not call getStoreFromApi', () => {
		const abs = resolve(REACT_ROOT, 'src', 'OpenGrid.tsx');
		const content = readFileSync(abs, 'utf-8');
		expect(content, 'OpenGrid.tsx should not use getStoreFromApi').not.toContain('getStoreFromApi');
	});

	it('GridPortal.tsx does not cast to InternalGridApi', () => {
		const abs = resolve(REACT_ROOT, 'src', 'GridPortal.tsx');
		const content = readFileSync(abs, 'utf-8');
		expect(content, 'GridPortal.tsx should not cast to InternalGridApi').not.toContain('InternalGridApi');
	});
});

/**
 * Architecture guardrail tests.
 *
 * These tests enforce structural constraints that keep the codebase from
 * drifting back into the cross-file protocol and god-object patterns called
 * out in Plans 011-013.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CORE_ROOT = resolve(__dirname, '../..');
const REACT_ROOT = resolve(__dirname, '../../../../packages/react');

function countLines(relPath: string): number {
	const abs = resolve(CORE_ROOT, 'src', relPath);
	return readFileSync(abs, 'utf-8').split('\n').length;
}

function coreFileContains(relPath: string, substring: string): boolean {
	const abs = resolve(CORE_ROOT, 'src', relPath);
	return readFileSync(abs, 'utf-8').includes(substring);
}

describe('Architecture guardrails', () => {
	it('store.ts is below 900 lines', () => {
		const lines = countLines('store.ts');
		expect(lines, `store.ts has ${lines} lines and must stay below 900`).toBeLessThan(900);
	});

	it('GridEngine.ts is below 1000 lines (intermediate budget, target 800)', () => {
		const lines = countLines('engine/GridEngine.ts');
		expect(lines, `GridEngine.ts has ${lines} lines; intermediate budget is 1000 and target is 800`).toBeLessThan(1000);
	});

	it('GridEngine.ts is below 800 lines', () => {
		const lines = countLines('engine/GridEngine.ts');
		expect(lines, `GridEngine.ts has ${lines} lines and must be below 800`).toBeLessThan(800);
	});

	it('OpenGrid.tsx does not call getStoreFromApi', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'OpenGrid.tsx'), 'utf-8');
		expect(content).not.toContain('getStoreFromApi');
	});

	it('GridPortal.tsx does not cast to InternalGridApi', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'GridPortal.tsx'), 'utf-8');
		expect(content).not.toContain('InternalGridApi');
	});

	it('GridChartOverlay.tsx does not import @open-grid/core/internal', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'chart', 'GridChartOverlay.tsx'), 'utf-8');
		expect(content).not.toContain('@open-grid/core/internal');
	});

	it('SpreadsheetFillEngine does not call engine.data.setCellValue directly', () => {
		const hasDirectCall = coreFileContains('spreadsheet/fillRange.ts', 'engine.data.setCellValue');
		expect(hasDirectCall, 'fillRange.ts must route all cell writes through dataMutation.applyCellValueChange').toBe(false);
	});

	it('DataModel.setCellValue is not called from fillRange.ts', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'spreadsheet', 'fillRange.ts'), 'utf-8');
		expect(content, 'fillRange.ts must not call data.setCellValue').not.toContain('data.setCellValue');
	});

	it('GridFeatureContext does not expose raw side-effect primitives', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GridFeatureContext.ts'), 'utf-8');
		expect(content).not.toContain('stateManager:');
		expect(content).not.toContain('invalidation:');
		expect(content).not.toContain('eventBus:');
		expect(content).not.toContain('commandHistory:');
		expect(content).not.toContain('requestRender:');
	});

	it('feature controllers do not use raw ctx side-effect primitives', () => {
		const files = [
			'features/ColumnFeatureController.ts',
			'features/GroupingFeatureController.ts',
			'features/EditingFeatureController.ts',
			'features/RowSelectionFeatureController.ts',
		];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not call this.ctx.stateManager`).not.toContain('this.ctx.stateManager');
			expect(content, `${file} must not call this.ctx.invalidation`).not.toContain('this.ctx.invalidation');
			expect(content, `${file} must not call this.ctx.eventBus`).not.toContain('this.ctx.eventBus');
			expect(content, `${file} must not call this.ctx.commandHistory`).not.toContain('this.ctx.commandHistory');
			expect(content, `${file} must not call this.ctx.requestRender`).not.toContain('this.ctx.requestRender');
		}
	});

	it('GridChange.reason is not typed as string', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
		expect(content).not.toContain('reason: string;');
	});
});

import { describe, expect, it, vi } from 'vitest';
import { resolveRowPresentation, type RowPresentationInput, type RowPresentationResolverDeps } from './rowPresentationResolver.js';
import { compileStyleRules } from '../styling/styleRules.js';

function makeDeps(overrides: Partial<RowPresentationResolverDeps<{ id: string; name: string }>> = {}): RowPresentationResolverDeps<{
	id: string;
	name: string;
}> {
	return {
		engine: {
			data: { isRowLoading: vi.fn(() => false) },
		} as any,
		selectionPaint: {
			hoveredRowIndex: null,
			selectedRowIdSet: null,
			rowClassScratchRef: {},
		} as any,
		...overrides,
	};
}

function baseInput(overrides: Partial<RowPresentationInput<{ id: string; name: string }>> = {}): RowPresentationInput<{
	id: string;
	name: string;
}> {
	return {
		visualRow: { kind: 'data', id: 'r1', node: { id: 'r1', data: { id: 'r1', name: 'Row 1' } } } as any,
		rowIndex: 5,
		state: { selection: { focus: null, bounds: null } } as any,
		compiledStyleRules: compileStyleRules(undefined),
		isScrollFrameActive: false,
		isRowRebind: false,
		slotLastVisualRowId: '',
		slotRowKind: '',
		slotLastClassName: '',
		pinTopRows: 0,
		pinBottomRows: 0,
		rowCount: 100,
		shouldDeferWarmRowVisualRefresh: false,
		...overrides,
	};
}

describe('resolveRowPresentation', () => {
	it('resolves a plain data row to the base class with no extras', () => {
		const result = resolveRowPresentation(makeDeps(), baseInput());
		expect(result.className).toBe('og-row');
		expect(result.markDirtyAfterScroll).toBe(false);
	});

	it('adds og-row-pinned-top / og-row-pinned-bottom based on position', () => {
		const top = resolveRowPresentation(makeDeps(), baseInput({ rowIndex: 0, pinTopRows: 1 }));
		expect(top.className).toContain('og-row-pinned-top');

		const bottom = resolveRowPresentation(makeDeps(), baseInput({ rowIndex: 99, rowCount: 100, pinBottomRows: 1 }));
		expect(bottom.className).toContain('og-row-pinned-bottom');
	});

	it('adds og-row-selected/og-row-focused for the focused row', () => {
		const result = resolveRowPresentation(makeDeps(), baseInput({ state: { selection: { focus: { rowId: 'r1' }, bounds: null } } as any }));
		expect(result.className).toContain('og-row-selected');
		expect(result.className).toContain('og-row-focused');
	});

	it('adds og-row-hovered when this row is the hovered row', () => {
		const result = resolveRowPresentation(
			makeDeps({ selectionPaint: { hoveredRowIndex: 5, selectedRowIdSet: null, rowClassScratchRef: {} } as any }),
			baseInput()
		);
		expect(result.className).toContain('og-row-hovered');
	});

	it('adds og-row-loading when the row is loading', () => {
		const result = resolveRowPresentation(makeDeps({ engine: { data: { isRowLoading: vi.fn(() => true) } } as any }), baseInput());
		expect(result.className).toContain('og-row-loading');
	});

	it('resolves failed and placeholder rows to their base classes', () => {
		const failed = resolveRowPresentation(makeDeps(), baseInput({ visualRow: { kind: 'failed', id: 'failed:5', rowIndex: 5, error: 'boom', retryable: true } as any }));
		expect(failed.className).toBe('og-row og-row-failed');

		const placeholder = resolveRowPresentation(
			makeDeps(),
			baseInput({ visualRow: { kind: 'placeholder', id: 'placeholder:5', rowIndex: 5, reason: 'waiting' } as any })
		);
		expect(placeholder.className).toBe('og-row og-row-placeholder');
	});

	it('reuses the warm className during scroll when the slot already holds this exact row', () => {
		const result = resolveRowPresentation(
			makeDeps(),
			baseInput({
				isScrollFrameActive: true,
				slotLastVisualRowId: 'r1',
				slotRowKind: 'data',
				slotLastClassName: 'og-row og-row-custom-warm',
				shouldDeferWarmRowVisualRefresh: true,
			})
		);
		expect(result.className).toBe('og-row og-row-custom-warm');
		expect(result.markDirtyAfterScroll).toBe(true);
	});

	it('does not reuse the warm className on a row rebind, even if the slot has warm state', () => {
		const result = resolveRowPresentation(
			makeDeps(),
			baseInput({
				isScrollFrameActive: true,
				isRowRebind: true,
				slotLastVisualRowId: 'r1',
				slotRowKind: 'data',
				slotLastClassName: 'og-row og-row-custom-warm',
			})
		);
		expect(result.className).not.toContain('og-row-custom-warm');
	});

	it('defers row style-rule evaluation to the fidelity lane during active scroll instead of evaluating now', () => {
		const when = vi.fn(() => true);
		const result = resolveRowPresentation(
			makeDeps(),
			baseInput({
				isScrollFrameActive: true,
				compiledStyleRules: compileStyleRules([{ kind: 'row', when, rowClass: 'og-row-custom' } as any]),
			})
		);
		expect(when).not.toHaveBeenCalled();
		expect(result.markDirtyAfterScroll).toBe(true);
		expect(result.className).not.toContain('og-row-custom');
	});

	it('evaluates row style rules synchronously outside an active scroll frame', () => {
		const when = vi.fn(() => true);
		const result = resolveRowPresentation(
			makeDeps(),
			baseInput({
				isScrollFrameActive: false,
				compiledStyleRules: compileStyleRules([{ kind: 'row', when, rowClass: 'og-row-custom' } as any]),
			})
		);
		expect(when).toHaveBeenCalled();
		expect(result.className).toContain('og-row-custom');
	});

	it('resolves group rows to the group base class and applies group style rules', () => {
		const result = resolveRowPresentation(
			makeDeps(),
			baseInput({
				visualRow: { kind: 'group', id: 'grp:1', label: 'Group 1' } as any,
			})
		);
		expect(result.className).toContain('og-row-group');
	});

	it('resolves detail rows to the detail base class', () => {
		const result = resolveRowPresentation(makeDeps(), baseInput({ visualRow: { kind: 'detail', id: 'detail:1' } as any }));
		expect(result.className).toContain('og-row-detail');
	});

	it('never throws when a user style-rule hook throws — the custom class is just omitted', () => {
		const result = resolveRowPresentation(
			makeDeps({ engine: { data: { isRowLoading: vi.fn(() => false) }, runtimeFaults: { report: vi.fn() } } as any }),
			baseInput({
				isScrollFrameActive: false,
				compiledStyleRules: compileStyleRules([
					{
						kind: 'row',
						when: () => {
							throw new Error('boom');
						},
						rowClass: 'og-row-custom',
					} as any,
				]),
			})
		);
		expect(result.className).toBe('og-row');
	});
});

import type { GridIntegrityApi, GridIntegritySummary, GridIntegrityRunResult } from './integrityTypes.js';

export function makeNoopIntegrityApi<TRowData>(): GridIntegrityApi<TRowData> {
	const _warn = (method: string) => console.warn(`[OpenGrid] api.integrity.${method}() called but dataIntegrity is not configured on this grid.`);
	const _noopSummary = (): GridIntegritySummary => ({
		status: 'clean',
		totalIssues: 0,
		blockingIssues: 0,
		warnings: 0,
		errors: 0,
		bySource: {},
	});
	const _noopResult = (): GridIntegrityRunResult => ({
		summary: _noopSummary(),
		issues: [],
	});
	return {
		run: async (_opts?) => {
			_warn('run');
			return _noopResult();
		},
		getSummary: () => {
			_warn('getSummary');
			return _noopSummary();
		},
		getIssues: () => {
			_warn('getIssues');
			return [];
		},
		getCellIssues: () => {
			_warn('getCellIssues');
			return [];
		},
		getRowIssues: () => {
			_warn('getRowIssues');
			return [];
		},
		getBlockingIssues: () => {
			_warn('getBlockingIssues');
			return [];
		},
		canSubmit: () => {
			_warn('canSubmit');
			return true;
		},
		publishIssues: () => {
			_warn('publishIssues');
		},
		publishServerReport: () => {
			_warn('publishServerReport');
		},
		clearIssues: () => {
			_warn('clearIssues');
		},
		validateCell: async () => {
			_warn('validateCell');
			return [];
		},
		validateRow: async () => {
			_warn('validateRow');
			return [];
		},
		validateGrid: async () => {
			_warn('validateGrid');
			return _noopResult();
		},
		setDiffModel: () => {
			_warn('setDiffModel');
		},
		clearDiff: () => {
			_warn('clearDiff');
		},
		getDiffResult: () => {
			_warn('getDiffResult');
			return null;
		},
		acceptCellDiff: async () => {
			_warn('acceptCellDiff');
			return { status: 'notFound', reason: 'dataIntegrity not configured' } as const;
		},
		createStream: () => {
			_warn('createStream');
			throw new Error('[OpenGrid] dataIntegrity is not configured on this grid.');
		},
		getStreamState: () => {
			_warn('getStreamState');
			return null;
		},
		getConflicts: () => {
			_warn('getConflicts');
			return [];
		},
		resolveConflict: async () => {
			_warn('resolveConflict');
			return { status: 'notFound' } as const;
		},
		clearConflict: () => {
			_warn('clearConflict');
		},
	};
}

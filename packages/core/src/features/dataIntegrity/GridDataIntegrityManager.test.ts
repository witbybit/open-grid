import { describe, expect, it } from 'vitest';
import { GridStore } from '../../store.js';
import { ClientRowModelController } from '../../rowModel.js';
import { GridDataIntegrityManager } from './GridDataIntegrityManager.js';
import { ClientGridIntegrityRowProvider } from './GridIntegrityRowProvider.js';
import { defaultGridScheduler } from '../../renderer/gridScheduler.js';
import type { GridDataIntegrityConfig, GridApi } from './integrityTypes.js';

interface TestRow {
	id: string;
	name: string;
	score: number;
}

const COLUMNS = [{ field: 'name' }, { field: 'score' }] as const;
const INTEGRITY_CONFIG: GridDataIntegrityConfig<TestRow> = {
	validation: {
		cellRules: [
			{
				id: 'required-name',
				field: 'name',
				validate: ({ value }) => (value ? null : { message: 'Name is required' }),
			},
		],
	},
	diff: true,
	liveStream: true,
	conflicts: true,
};

function createStore(): GridStore<TestRow> {
	const store = new GridStore<TestRow>({ getRowId: (row) => row.id, columns: [...COLUMNS] }, { dataIntegrity: INTEGRITY_CONFIG });
	new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: [
			{ id: '1', name: '', score: 1 },
			{ id: '2', name: 'Beta', score: 2 },
		],
		columns: store.getState().columns,
	});
	return store;
}

function recreateManager(store: GridStore<TestRow>): GridDataIntegrityManager<TestRow> {
	const engine = store.engine;
	return new GridDataIntegrityManager<TestRow>(INTEGRITY_CONFIG, {
		ctx: {
			columns: engine.columns,
			getState: () => engine.getState(),
			applyChange: (change) => engine.changeApplier.commit(change),
		},
		data: engine.data,
		getRowModel: () => engine.getRowModel(),
		getApi: () => store as unknown as GridApi<TestRow>,
		scheduler: defaultGridScheduler,
		rowProvider: new ClientGridIntegrityRowProvider<TestRow>(
			() => engine.getRowModel(),
			() => engine.getState()
		),
		capabilityManager: engine.capabilityManager,
		commitCells: (updates) => engine.batchCellValues(updates as { rowId: string; colField: string; value: unknown }[], 'api'),
		applyRowPatch: (rowId, patch) => {
			const row = engine.getRowModel()?.getRawRowById(rowId);
			if (row) {
				engine.applyTransaction({ update: [{ ...row, ...patch }] });
			}
		},
		requestIntegrityRepaint: () => {},
	});
}

describe('GridDataIntegrityManager authoritative state', () => {
	it('writes validation, diff, live stream, conflict, and server report data into the canonical integrity slice', async () => {
		const store = createStore();

		await store.integrity.validateCell('1', 'name');
		let integrityState = store.engine.getState().integrity;
		expect(integrityState.validation.issues).toHaveLength(1);
		expect(integrityState.validation.cellErrorIndex['1:name']?.message).toBe('Name is required');

		store.integrity.setDiffModel({
			base: { rows: [{ id: '1', name: '', score: 1 }], getRowId: (row) => row.id },
			compare: { rows: [{ id: '1', name: 'Renamed', score: 1 }], getRowId: (row) => row.id },
		});
		integrityState = store.engine.getState().integrity;
		expect(integrityState.diff.result?.changedCells).toHaveLength(1);
		expect(integrityState.diff.cellDiffIndex['1\0name']?.newValue).toBe('Renamed');

		const stream = store.integrity.createStream({ dirtyCellPolicy: 'skip', flashChanges: false });
		stream.pushCells([{ rowId: '1', colField: 'score', value: 99 }]);
		integrityState = store.engine.getState().integrity;
		expect(integrityState.liveStream.session?.pendingUpdates).toBe(1);
		stream.flush();
		integrityState = store.engine.getState().integrity;
		expect(integrityState.liveStream.session?.pendingUpdates).toBe(0);

		store.startEditing('1', 'name');
		const conflictStream = store.integrity.createStream({ dirtyCellPolicy: 'markConflict', flashChanges: false });
		conflictStream.pushCells([{ rowId: '1', colField: 'name', value: 'Remote' }]);
		conflictStream.flush();
		integrityState = store.engine.getState().integrity;
		expect(integrityState.conflicts.conflicts).toHaveLength(1);
		const conflictId = integrityState.conflicts.conflicts[0]!.id;
		expect(integrityState.conflicts.cellConflictIndex['1\0name']).toBe(conflictId);
		store.stopEditing(true);
		await store.integrity.resolveConflict(conflictId, { strategy: 'local' });
		expect(store.engine.getState().integrity.conflicts.conflicts).toHaveLength(0);

		store.integrity.publishServerReport({
			scope: 'serverProvided',
			generatedAt: 1,
			complete: true,
			issues: [
				{
					id: 'srv-1',
					source: 'system',
					type: 'custom',
					severity: 'warning',
					message: 'Server warning',
					createdAt: 1,
				},
			],
		});
		integrityState = store.engine.getState().integrity;
		expect(integrityState.serverReport?.issues).toHaveLength(1);
		expect(integrityState.summary.bySource.system).toBe(1);

		store.integrity.clearDiff();
		store.integrity.clearIssues({ source: 'system' });
		integrityState = store.engine.getState().integrity;
		expect(integrityState.diff.result).toBeNull();
		expect(integrityState.serverReport).toBeNull();
	});

	it('rebuilds diagnostics and decorations from authoritative integrity state after manager recreation', async () => {
		const store = createStore();

		await store.integrity.validateCell('1', 'name');
		store.integrity.setDiffModel({
			base: { rows: [{ id: '1', name: '', score: 1 }], getRowId: (row) => row.id },
			compare: { rows: [{ id: '1', name: 'Renamed', score: 1 }], getRowId: (row) => row.id },
		});
		store.integrity.publishIssues('system', [
			{
				id: 'published-1',
				source: 'system',
				type: 'custom',
				severity: 'warning',
				rowId: '1',
				colField: 'name',
				message: 'Published issue',
				createdAt: 1,
			},
		]);
		store.integrity.publishServerReport({
			scope: 'serverProvided',
			generatedAt: 1,
			complete: true,
			issues: [
				{
					id: 'srv-1',
					source: 'system',
					type: 'custom',
					severity: 'warning',
					message: 'Server warning',
					createdAt: 1,
				},
			],
		});

		const recreated = recreateManager(store);
		const cellDecorations = recreated.getCellDecorations('1', 'name');
		expect(cellDecorations.some((decoration) => decoration.kind === 'validationError' && decoration.title === 'Name is required')).toBe(true);
		expect(cellDecorations.some((decoration) => decoration.kind === 'diffChanged')).toBe(true);
		expect(cellDecorations.some((decoration) => decoration.title === 'Published issue')).toBe(true);
		expect(recreated.getDiffResult()?.changedCells).toHaveLength(1);
		expect(recreated.getDiagnostics()).toMatchObject({
			summary: store.engine.getState().integrity.summary,
			serverReport: { scope: 'serverProvided', complete: true, issues: 1 },
			publishedIssues: { system: 1 },
		});
	});

	it('remote-wins stream commits, row patches, and flash decorations all flow through integrity ownership', () => {
		const store = createStore();
		const stream = store.integrity.createStream({ dirtyCellPolicy: 'remoteWins', flashChanges: true });

		stream.pushCells([{ rowId: '2', colField: 'score', value: 22 }]);
		stream.pushRows([{ rowId: '2', patch: { name: 'Remote Beta' } }]);
		stream.flush();

		expect(store.getCellValue('2', 'score')).toBe(22);
		expect(store.getRowNodeById('2')?.data.name).toBe('Remote Beta');
		expect(store.engine.getState().integrity.liveStream.session?.committedBatches).toBe(1);
		expect(store.engine.getState().integrity.liveStream.issues).toHaveLength(0);
		expect(store.engine.dataIntegrity?.getCellDecorations('2', 'score')).toEqual(
			expect.arrayContaining([expect.objectContaining({ className: 'og-cell-live-flash' })])
		);
	});

	it('stream skip and conflict paths publish authoritative integrity state', () => {
		const store = createStore();

		store.startEditing('1', 'name');
		const skipStream = store.integrity.createStream({ dirtyCellPolicy: 'skip', flashChanges: false });
		skipStream.pushCells([{ rowId: '1', colField: 'name', value: 'Skipped Remote' }]);
		skipStream.flush();
		expect(store.engine.getState().integrity.liveStream.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'streamSkipped', rowId: '1', colField: 'name' })])
		);

		const conflictStream = store.integrity.createStream({ dirtyCellPolicy: 'markConflict', flashChanges: false });
		conflictStream.pushCells([{ rowId: '1', colField: 'name', value: 'Conflicted Remote' }]);
		conflictStream.flush();
		expect(store.engine.getState().integrity.conflicts.conflicts).toHaveLength(1);
		expect(store.engine.getState().integrity.liveStream.session?.skippedDirtyUpdates).toBe(1);

		store.stopEditing(true);
	});
});

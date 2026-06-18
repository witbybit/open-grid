/**
 * Architecture guardrail tests.
 *
 * These tests enforce structural constraints that keep the codebase from
 * drifting back into the cross-file protocol and god-object patterns called
 * out in Plans 011-014.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path, { resolve } from 'path';

const CORE_ROOT = resolve(__dirname, '../..');
const REACT_ROOT = resolve(__dirname, '../../../../packages/react');
const DEMO_ROOT = resolve(__dirname, '../../../../demo');

function countLines(relPath: string): number {
	const abs = resolve(CORE_ROOT, 'src', relPath);
	return readFileSync(abs, 'utf-8').split('\n').length;
}

function coreFileContains(relPath: string, substring: string): boolean {
	const abs = resolve(CORE_ROOT, 'src', relPath);
	return readFileSync(abs, 'utf-8').includes(substring);
}

function collectSourceFiles(root: string): string[] {
	const entries = readdirSync(root);
	const files: string[] = [];
	for (const entry of entries) {
		const abs = resolve(root, entry);
		const stat = statSync(abs);
		if (stat.isDirectory()) {
			files.push(...collectSourceFiles(abs));
			continue;
		}
		if (/\.(tsx?|jsx?)$/.test(entry)) {
			files.push(abs);
		}
	}
	return files;
}

describe('Architecture guardrails', () => {
	it('store.ts is below 950 lines (target 850)', () => {
		const lines = countLines('store.ts');
		expect(lines, `store.ts has ${lines} lines; budget is 950 and target is 850`).toBeLessThan(950);
	});

	it('GridEngine.ts is below 1000 lines (intermediate budget, target 800)', () => {
		const lines = countLines('engine/GridEngine.ts');
		expect(lines, `GridEngine.ts has ${lines} lines; intermediate budget is 1000 and target is 800`).toBeLessThan(1000);
	});

	it('GridEngine.ts is below 900 lines (Plan 084 expanded domains)', () => {
		const lines = countLines('engine/GridEngine.ts');
		expect(lines, `GridEngine.ts has ${lines} lines and must be below 900`).toBeLessThan(900);
	});

	it('renderEngine.ts is below 1000 lines (intermediate budget, target 900)', () => {
		const lines = countLines('renderer/renderEngine.ts');
		expect(lines, `renderEngine.ts has ${lines} lines; intermediate budget is 1000 and target is 900`).toBeLessThan(1000);
	});

	it('rowRenderer.ts is below 800 lines (intermediate budget, target 750)', () => {
		const lines = countLines('renderer/rowRenderer.ts');
		expect(lines, `rowRenderer.ts has ${lines} lines; intermediate budget is 800 and target is 750`).toBeLessThan(800);
	});

	it('renderEngine.ts does not inline renderer subscription wiring', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		expect(content).not.toContain('stateManager.subscribeToKey');
		expect(content).not.toContain('eventBus.addEventListener');
	});

	it('RenderInvalidationCoordinator owns renderer subscription wiring', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'RenderInvalidationCoordinator.ts'), 'utf-8');
		expect(content).toContain('stateManager.subscribeToKey');
		expect(content).toContain('eventBus.addEventListener');
	});

	it('renderScrollCoordinator owns scroll-frame orchestration and cheap-path fan-out', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderScrollCoordinator.ts'), 'utf-8');
		expect(content).toContain('computeRenderWindowInto');
		expect(content).toContain('sameRenderedWindow');
		expect(content).toContain('public flushScrollFrame =');
		expect(content).toContain('public syncCheapScrollOnly');

		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		expect(engineContent).toContain('this.scrollCoordinator.flushScrollFrame()');
		// syncCheapScrollOnly is called internally by renderScrollCoordinator, not forwarded from renderEngine
		expect(engineContent).not.toContain('computeRenderWindowInto(');
		expect(engineContent).not.toContain('sameRenderedWindow(');
	});

	it('DefaultFrameCoordinator routes every paint callback through runPaintFrame (Plan 079)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// The private wrapper must exist.
		expect(content).toContain('private runPaintFrame()');
		// runtimeState is accepted as a dep and stored.
		expect(content).toContain('runtimeState?: RenderRuntimeState');
		expect(content).toContain('this.runtimeState = deps.runtimeState');
		// Both external call sites (RAF callback and flushNowForTests) must delegate to runPaintFrame.
		expect(content).toContain('this.runPaintFrame()');
		// runPaintFrame must enter and exit the paint-frame phase.
		expect(content).toContain("rs.transitionTo('paint-frame')");
		expect(content).toContain("rs.transitionTo('idle')");

		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		// renderEngine must wire runtimeState into the coordinator.
		expect(engineContent).toContain('runtimeState: this.runtimeState');
	});

	it('DefaultFrameCoordinator owns a distinct post-scroll callback and scroll epoch (Plan 080)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// Distinct callback — not an alias of onPaintFrame.
		expect(content).toContain('onPostScrollWork: () => void');
		expect(content).toContain('this.onPostScrollWork()');
		// Scroll epoch captured at schedule time for stale-work rejection.
		expect(content).toContain('this.runtimeState?.scrollEpoch');
		expect(content).toContain('rs.isScrollEpochCurrent(this.postScrollEpoch)');
		// Single RAF arbiter (Plan 093 replaced per-channel handles with a single rafId).
		expect(content).toContain('this.rafId');
		// renderScrollCoordinator must not import defaultGridScheduler directly.
		const scrollContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderScrollCoordinator.ts'), 'utf-8');
		expect(scrollContent).not.toContain('import { defaultGridScheduler }');
		expect(scrollContent).toContain('gridScheduler: GridScheduler');
		expect(scrollContent).toContain('this.deps.gridScheduler.');
	});

	it('renderPaintCoordinator owns paint lifecycle orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderPaintCoordinator.ts'), 'utf-8');
		expect(content).toContain('public flushPaint =');
		expect(content).toContain('public fullPaint =');
		expect(content).toContain('public refreshRendererEpochs');

		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		expect(engineContent).toContain('this.paintCoordinator.flushPaint()');
		expect(engineContent).toContain('this.paintCoordinator.fullPaint()');
		expect(engineContent).not.toContain('this.orchestrator.flush(frame)');
		expect(engineContent).not.toContain('refreshRendererEpochs()');
	});

	it('renderViewportCoordinator owns viewport layout and scroll-into-view orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderViewportCoordinator.ts'), 'utf-8');
		expect(content).toContain('computeGridLayoutPlan');
		expect(content).toContain('computeScrollTarget');
		expect(content).toContain('public syncLayoutPlan');
		expect(content).toContain('public recycleViewport');
		expect(content).toContain('public scrollCellIntoView');

		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		expect(engineContent).toContain('this.viewportCoordinator.syncLayoutPlan()');
		expect(engineContent).toContain('this.viewportCoordinator.recycleViewport(false, undefined, layoutPlan.renderWindow)');
		expect(engineContent).toContain('this.viewportCoordinator.scrollCellIntoView(rowId, colField)');
		expect(engineContent).not.toContain('computeGridLayoutPlan(');
		expect(engineContent).not.toContain('computeScrollTarget(');
	});

	it('rowRenderMaintenance owns scroll-idle repair and invalidation repaint orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRenderMaintenance.ts'), 'utf-8');
		expect(content).toContain('export function repaintInvalidatedRowsAndCells');
		expect(content).toContain('export function decorateDirtyCellsAfterScroll');
	});

	it('rowCellBindingLanes owns row lane binding orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBindingLanes.ts'), 'utf-8');
		expect(content).toContain('export function bindAllDataCells');
		expect(content).toContain('export function bindAllLoadingCells');
	});

	it('rowRenderer live row/data binding delegates lane orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRenderer.ts'), 'utf-8');
		expect(content).toContain('this.runtime.bindAllDataCells(');
		expect(content).toContain('this.runtime.bindAllLoadingCells(');
		expect(content).toContain('this.runtime.bindFullWidthRow(');
	});

	it('rowRendererRuntime owns runtime bridge assembly and coordination adapters', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRendererRuntime.ts'), 'utf-8');
		expect(content).toContain('export class RowRendererRuntimeBridge');
		expect(content).toContain('stateHost.programmaticScrollCell');
		expect(content).toContain('stateHost.currentScrollCellsVisited++');
		expect(content).toContain('public bindAllDataCells(');
		expect(content).toContain('public bindAllLoadingCells(');
		expect(content).toContain('public bindFullWidthRow(');
		expect(content).toContain('public repaintInvalidatedRowsAndCells(');
		expect(content).toContain('public decorateDirtyCellsAfterScroll(');
	});

	it('rowCellBinder owns extracted live cell-binding policy', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBinder.ts'), 'utf-8');
		expect(content).toContain('export function bindCellFull');
		expect(content).toContain('export function bindCellDuringScroll');
		expect(content).toContain('const programmaticScrollCell = deps.programmaticScrollCell;');
	});

	it('rowCellBindingLanes routes live cell binding through rowCellBinder', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBindingLanes.ts'), 'utf-8');
		expect(content).toContain("from './rowCellBinder.js'");
		expect(content).toContain('bindCellFull(deps.cellBinderDeps');
		expect(content).toContain('bindCellDuringScroll(deps.cellBinderDeps');
	});

	it('row renderer style hook paths report faults through runtime diagnostics', () => {
		const files = ['renderer/rowRenderer.ts', 'renderer/selectionPaintManager.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not use console.error for renderer style hooks`).not.toContain('console.error');
			expect(content, `${file} should route renderer faults through reportRendererFault`).toContain('reportRendererFault');
		}
	});

	it('GridView.tsx does not call getStoreFromApi', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'GridView.tsx'), 'utf-8');
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

	it('internal adapter entrypoint does not use broad export barrels', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'internal.ts'), 'utf-8');
		expect(content).not.toContain('export * from');
	});

	it('internal adapter entrypoint does not export raw implementation classes', () => {
		const forbiddenExports = [
			'./store.js',
			'./engine/GridEngine.js',
			'./state/StateManager.js',
			'./commands/CommandHistory.js',
			'./events/EventBus.js',
			'./renderer/renderEngine.js',
			'./renderer/rowRenderer.js',
		];
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'internal.ts'), 'utf-8');
		for (const forbidden of forbiddenExports) {
			expect(content, `internal.ts must not export ${forbidden}`).not.toContain(forbidden);
		}
	});

	it('React adapter does not import raw core internals', () => {
		const files = ['GridView.tsx', 'GridPortal.tsx'];
		const forbidden = ['GridStore', 'GridEngine', 'RenderEngine', 'RowRenderer', 'getStoreFromApi', 'InternalGridApi', 'InternalColumnDef'];
		for (const file of files) {
			const content = readFileSync(resolve(REACT_ROOT, 'src', file), 'utf-8');
			for (const token of forbidden) {
				expect(content, `${file} must not import ${token} from @open-grid/core/internal`).not.toMatch(
					new RegExp(`import[\\s\\S]*\\b${token}\\b[\\s\\S]*from ['"]@open-grid/core/internal['"]`)
				);
			}
			expect(content, `${file} must not import raw renderer files`).not.toMatch(/from ['"]@open-grid\/core\/internal\/renderer\//);
		}
	});

	it('reactHostBridge.ts is the only React-side file that imports @open-grid/core/internal', () => {
		const bridge = readFileSync(resolve(REACT_ROOT, 'src', 'reactHostBridge.ts'), 'utf-8');
		expect(bridge).toContain("from '@open-grid/core/internal'");

		const files = ['Grid.tsx', 'GridView.tsx', 'GridPortal.tsx', 'hooks.ts', 'gridContext.tsx'];
		for (const file of files) {
			const content = readFileSync(resolve(REACT_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not import @open-grid/core/internal directly`).not.toContain('@open-grid/core/internal');
		}
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

	it('core models do not depend on the concrete GridEngine type', () => {
		const files = ['models/DataModel.ts', 'models/ColumnModel.ts', 'models/CellAccess.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not reference GridEngine`).not.toContain('GridEngine<');
			expect(content, `${file} must not store a private engine field`).not.toContain('private engine!');
			expect(content, `${file} must not expose init(engine)`).not.toContain('init(engine');
		}
	});

	it('row models do not reach through store.engine', () => {
		const files = ['rowModel.ts', 'serverRowModel.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not use store.engine reach-through`).not.toContain('store.engine.');
		}
	});

	it('row models do not depend on the concrete GridStore type', () => {
		const files = ['rowModel.ts', 'serverRowModel.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not reference GridStore`).not.toContain('GridStore<');
			expect(content, `${file} must not keep a private store field`).not.toContain('private store:');
			expect(content, `${file} must not accept constructor(store: GridStore...)`).not.toContain('constructor(store: GridStore');
		}
	});

	it('core runtime fault paths do not use scattered console.error calls', () => {
		const files = [
			'contextMenu.ts',
			'events/EventBus.ts',
			'state/StateManager.ts',
			'commands/CommandHistory.ts',
			'plugins/GridPluginRegistry.ts',
			'engine/CellNotificationController.ts',
			'engine/createRowModelRuntimes.ts',
			'serverRowModel.ts',
			'rows/stages/aggregateStage.ts',
			'renderer/fillDragController.ts',
			'renderer/headerMenuController.ts',
			'renderer/headerRenderer.ts',
		];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must report faults through RuntimeFaultReporter`).not.toContain('console.error');
		}
	});

	it('row-model runtimes are defined in runtimePorts and used from factory wiring', () => {
		const runtimePorts = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'runtimePorts.ts'), 'utf-8');
		expect(runtimePorts).toContain('export interface ClientRowModelRuntime');
		expect(runtimePorts).toContain('export interface ServerRowModelRuntime');

		const createGrid = readFileSync(resolve(CORE_ROOT, 'src', 'createGrid.ts'), 'utf-8');
		expect(createGrid).toContain('store.getClientRowModelRuntime()');
		expect(createGrid).toContain('store.getServerRowModelRuntime()');
		expect(createGrid).not.toContain('new ClientRowModelController<TRowData>(store,');
		expect(createGrid).not.toContain('new ServerRowModelController<TRowData>(store,');
	});

	it('navigation and contextMenu plugins do not depend on GridStore downcasts', () => {
		const files = ['navigation.ts', 'contextMenu.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not reference GridStore`).not.toContain('GridStore');
			expect(content, `${file} must not cast api as GridStore`).not.toContain('api as GridStore');
		}
	});

	it('GridPlugin no longer initializes against InternalGridApi', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		expect(content).not.toContain('onInit?(api: InternalGridApi');
		expect(content).toContain('onInit?(api: GridPluginRuntime');
	});

	it('react exposes Grid as the only public grid entrypoint', () => {
		const indexContent = readFileSync(resolve(REACT_ROOT, 'src', 'index.ts'), 'utf-8');
		expect(indexContent).toContain("export { Grid } from './Grid.js';");

		const forbiddenExports = ['GridView', 'GridProvider', 'useOwnedClientGrid', 'useOwnedServerGrid', 'ClientGridOptions', 'ServerGridOptions'];
		for (const token of forbiddenExports) {
			expect(indexContent, `React public index must not export ${token}`).not.toContain(token);
		}

		expect(existsSync(resolve(REACT_ROOT, 'src', 'ownedGrid.ts')), 'ownedGrid.ts must not exist').toBe(false);
	});

	it('Grid.tsx does not contain the pagedServerDatasource wrapper', () => {
		const gridContent = readFileSync(resolve(REACT_ROOT, 'src', 'Grid.tsx'), 'utf-8');
		expect(gridContent, 'pagedServerDatasource wrapper must not exist in Grid.tsx').not.toContain('pagedServerDatasource');
	});

	it('demo code depends on the React Grid entrypoint instead of core or owned-grid internals', () => {
		const files = [...collectSourceFiles(resolve(DEMO_ROOT, 'src')), resolve(DEMO_ROOT, 'vite.config.ts'), resolve(DEMO_ROOT, 'package.json')];
		const forbiddenTokens = [
			'@open-grid/core',
			'useOwnedClientGrid',
			'useOwnedServerGrid',
			'useOwnedGrid',
			'useShowroomStores',
			'GridProvider',
			'GridView',
			'ownedGrid',
		];

		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			for (const token of forbiddenTokens) {
				expect(content, `${file} must not contain ${token}`).not.toContain(token);
			}
		}
	});

	// ── Plan 071 — store.ts hub decomposition boundary rules ─────────────────

	it('renderer production files do not import from store.ts barrel', () => {
		// Renderer source files should import types from narrow modules, not the store hub.
		// Test files (*.test.ts) are exempt — they need GridStore for setup.
		const rendererDir = resolve(CORE_ROOT, 'src', 'renderer');
		const files = collectSourceFiles(rendererDir).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes("from '../store.js'") || content.includes('from "../store.js"')) {
				violators.push(file.replace(rendererDir, 'renderer'));
			}
		}
		expect(violators, `renderer files still importing from store.ts: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('GridEventName is defined in api/GridEvents.ts, not store.ts', () => {
		const eventsContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridEvents.ts'), 'utf-8');
		expect(eventsContent).toContain('export enum GridEventName');
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(storeContent).not.toContain('export enum GridEventName');
	});

	it('GridState is defined in state/GridState.ts, not store.ts', () => {
		const stateContent = readFileSync(resolve(CORE_ROOT, 'src', 'state', 'GridState.ts'), 'utf-8');
		// GridState is a composed type alias (not an interface)
		expect(stateContent).toContain('export type GridState');
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(storeContent).not.toContain('export type GridState');
		expect(storeContent).not.toContain('export interface GridState');
	});

	// ── Plan 072 — GridInstrumentation hot-path boundary ─────────────────────

	it('renderer production files do not import RecordingGridInstrumentation (noop path must be tree-shakeable)', () => {
		// Renderer code must only depend on the GridInstrumentation interface.
		// RecordingGridInstrumentation is for tests and demos — importing it in the
		// renderer hot path would prevent the noop branch from being tree-shaken.
		const rendererDir = resolve(CORE_ROOT, 'src', 'renderer');
		const files = collectSourceFiles(rendererDir).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes('RecordingGridInstrumentation')) {
				violators.push(file.replace(rendererDir, 'renderer'));
			}
		}
		expect(violators, `renderer files importing RecordingGridInstrumentation: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('GridInstrumentation interface is defined in diagnostics/GridInstrumentation.ts', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'diagnostics', 'GridInstrumentation.ts'), 'utf-8');
		expect(content).toContain('export interface GridInstrumentation');
		expect(content).toContain('export const enum GridMetric');
		expect(content).toContain('export class NoopGridInstrumentation');
		expect(content).toContain('export class RecordingGridInstrumentation');
	});

	it('CellMountIdentity includes lane/laneIndex and CellPayloadIdentity is defined (Plan 081)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'IGridRenderer.ts'), 'utf-8');
		// Physical identity must include lane placement fields.
		expect(content).toContain("lane: 'left' | 'center' | 'right'");
		expect(content).toContain('laneIndex: number');
		// Logical payload identity must be kept separate from physical identity.
		expect(content).toContain('export interface CellPayloadIdentity');
		expect(content).toContain('rowId: string');
	});

	it('portal mount equality check compares slotGeneration (Plan 081)', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'gridPortalStore.ts'), 'utf-8');
		// slotGeneration must participate in the equality guard to prevent stale portal ownership.
		expect(content).toContain('existing.slotGeneration === slotGeneration');
	});

	it('deferred cell mounts validate generation before executing (Plan 081)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'portalMountManager.ts'), 'utf-8');
		// Stale deferred mounts must be rejected symmetrically to stale deferred releases.
		expect(content).toContain('activeGen > mount.slotGeneration');
	});

	it('RowDependencyRegistry expands sort/filter/group source fields and tracks opaque getters (Plan 082)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rows', 'rowMutationClassifier.ts'), 'utf-8');
		// Source dependency expansion must use valueGetterDependencies.
		expect(content).toContain('col?.valueGetterDependencies');
		// Opaque getter detection must set the flag.
		expect(content).toContain('opaqueStructuralDependency = true');
		// Opaque fallback in classifyMutation must exist.
		expect(content).toContain('registry.opaqueStructuralDependency');
		// Tree-parent precision: source fields tracked separately.
		expect(content).toContain('treeParentSourceFields');
		expect(content).toContain('treeParentDependencies');
	});

	it('treeData options expose getParentIdDependencies (Plan 082)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rows', 'RowPipeline.ts'), 'utf-8');
		expect(content).toContain('getParentIdDependencies');
	});

	it('incremental index maintenance uses reindexFrom and preserves Map identity (Plan 083)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		// reindexFrom must exist and update maps in-place (no new Map() calls in incremental paths).
		expect(content).toContain('private reindexFrom(');
		expect(content).toContain('this.reindexFrom(');
		// Cost model must exist.
		expect(content).toContain('isIncrementalCheaper');
		// Stale entries for removed rows must be deleted before splice.
		expect(content).toContain('this.rowIdToVisualIndex.delete(node.id)');
	});

	it('GridDomainVersions includes filtering and sorting domains (Plan 084)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'state', 'GridDomainVersions.ts'), 'utf-8');
		expect(content).toContain('filtering: number');
		expect(content).toContain('sorting: number');
	});

	it('GridEngine exposes incrementDomain covering all 7 domains (Plan 084 → Plan 097)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		// Plan 097: unified incrementDomain replaces per-domain increment callbacks
		expect(content).toContain('public incrementDomain(');
		expect(content).toContain("case 'columns'");
		expect(content).toContain("case 'rows'");
		expect(content).toContain("case 'geometry'");
		expect(content).toContain("case 'selection'");
		expect(content).toContain("case 'editing'");
		expect(content).toContain("case 'filtering'");
		expect(content).toContain("case 'sorting'");
	});

	it('subscribeDomain targeted API is present on GridEngine and GridApi (Plan 084)', () => {
		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(engineContent).toContain('public subscribeDomain(');
		const apiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		expect(apiContent).toContain('subscribeDomain(');
	});

	it('StateManager.debugGetStateCount is removed — reads route through GridInstrumentation (Plan 085)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'state', 'StateManager.ts'), 'utf-8');
		expect(content).not.toContain('debugGetStateCount');
		expect(content).toContain('GridMetric.STATE_READS');
	});

	it('GridInstrumentation exposes get() for zero-allocation counter reads (Plan 085)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'diagnostics', 'GridInstrumentation.ts'), 'utf-8');
		expect(content).toContain('get(metric: GridMetric): number');
		expect(content).toContain('STATE_READS');
		expect(content).toContain('ROW_MUTATION_INCREMENTAL');
		expect(content).toContain('ROW_MUTATION_FULL_REBUILD');
		expect(content).toContain('SLOT_REBINDS');
	});

	it('GridEngine exposes instrumentation field and setInstrumentation (Plan 085)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain('public instrumentation: GridInstrumentation');
		expect(content).toContain('public setInstrumentation(');
	});

	it('RuntimePortBinding interface exists with generation field (Plan 086)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'rendererPorts.ts'), 'utf-8');
		expect(content).toContain('export interface RuntimePortBinding');
		expect(content).toContain('readonly generation: number');
		// Stable singleton headless ports must exist to avoid allocation on every unmount.
		expect(content).toContain('export const HEADLESS_PORTS');
	});

	it('gridHost.ts uses bindRuntimePorts/unbindRuntimePorts instead of setRendererPorts (Plan 086)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'gridHost.ts'), 'utf-8');
		expect(content).toContain('bindRuntimePorts(');
		expect(content).toContain('unbindRuntimePorts(');
		expect(content).not.toContain('setRendererPorts(');
		// ResizeObserver must guard against stale bindings.
		expect(content).toContain('isBindingCurrent(binding)');
	});

	it('deprecated setRendererPorts and createHeadlessPorts are deleted (Plan 090)', () => {
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(storeContent).not.toContain('setRendererPorts');
		const portsContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'rendererPorts.ts'), 'utf-8');
		expect(portsContent).not.toContain('createHeadlessPorts');
	});

	// ── Plan 087 — store.ts boundary enforcement ─────────────────────────────

	it('engine/ production files import GridEventName from api/GridEvents.ts, not store.ts (Plan 087)', () => {
		const engineDir = resolve(CORE_ROOT, 'src', 'engine');
		const files = collectSourceFiles(engineDir).filter((f) => !f.endsWith('.test.ts'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			// GridStore import is allowed only in createRowModelRuntimes.ts (bridge factory).
			const isAllowedBridge = file.endsWith('createRowModelRuntimes.ts');
			if (!isAllowedBridge && (content.includes("from '../store.js'") || content.includes('from "../store.js"'))) {
				violators.push(path.relative(engineDir, file));
			}
		}
		expect(violators, `engine/ files still importing from store.ts: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('state/ production files do not import from store.ts barrel (Plan 087)', () => {
		const stateDir = resolve(CORE_ROOT, 'src', 'state');
		const files = collectSourceFiles(stateDir).filter((f) => !f.endsWith('.test.ts'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes("from '../store.js'") || content.includes('from "../store.js"')) {
				violators.push(path.relative(stateDir, file));
			}
		}
		expect(violators, `state/ files still importing from store.ts: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('production source files do not contain Plan NNN or Phase N: roadmap-chronology comments (Plan 088)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const allFiles = collectSourceFiles(srcDir).filter((f) => !f.endsWith('.test.ts'));
		// Pattern: "(Plan NNN" or "Phase N:" or "Phase N —" or "(Phase N)"
		const roadmapPattern = /\(Plan \d+|\bPhase \d+[:\s—]|\(Phase \d+\)/;
		const violators: string[] = [];
		for (const file of allFiles) {
			const content = readFileSync(file, 'utf-8');
			if (roadmapPattern.test(content)) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(violators, `Production files with roadmap-chronology comments: ${violators.join(', ')}`).toHaveLength(0);
	});

	// ── Plan 089: core-target.md dependency enforcement ───────────────────────

	it('core-target.md architecture constitution exists at docs/architecture/core-target.md (Plan 089)', () => {
		const constitutionPath = resolve(CORE_ROOT, '../../docs/architecture/core-target.md');
		expect(existsSync(constitutionPath), 'docs/architecture/core-target.md must exist').toBe(true);
	});

	it('core package does not import from packages/react (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const allFiles = collectSourceFiles(srcDir).filter((f) => !f.endsWith('.test.ts'));
		// Match only actual import/require statements, not comments mentioning the package name.
		// Covers: import ... from '@open-grid/react' and require('@open-grid/react')
		const reactImportPattern = /(?:from\s+|require\s*\(\s*)['"]@open-grid\/react['"]/;
		const violators: string[] = [];
		for (const file of allFiles) {
			const content = readFileSync(file, 'utf-8');
			if (reactImportPattern.test(content)) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(violators, `core files importing from react package: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('engine/, state/, models/, rows/ production files do not import React (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const protectedDirs = ['engine', 'state', 'models', 'rows'];
		const violators: string[] = [];
		for (const dir of protectedDirs) {
			const dirPath = resolve(srcDir, dir);
			if (!existsSync(dirPath)) continue;
			const files = collectSourceFiles(dirPath).filter((f) => !f.endsWith('.test.ts'));
			for (const file of files) {
				const content = readFileSync(file, 'utf-8');
				// Matches: from 'react', from "react", from 'react/', require('react')
				if (/from ['"]react['"/]|require\(['"]react['"]/.test(content)) {
					violators.push(path.relative(srcDir, file));
				}
			}
		}
		expect(violators, `domain layer files importing React: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('models/ production files do not import from renderer/ (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const modelsDir = resolve(srcDir, 'models');
		if (!existsSync(modelsDir)) return;
		const files = collectSourceFiles(modelsDir).filter((f) => !f.endsWith('.test.ts'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes("from '../renderer/") || content.includes('from "../renderer/')) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(violators, `models/ files importing from renderer/: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('renderer/ production files do not import from store.ts barrel (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const rendererDir = resolve(srcDir, 'renderer');
		const files = collectSourceFiles(rendererDir).filter((f) => !f.endsWith('.test.ts'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes("from '../store.js'") || content.includes('from "../store.js"')) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(violators, `renderer/ files importing from store.ts: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('browser scheduling APIs (setTimeout/rAF/rIC) are restricted to frame-coordination files (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const allFiles = collectSourceFiles(srcDir).filter((f) => !f.endsWith('.test.ts'));
		// Canonical sites: the only files that should schedule browser work.
		// Known exceptions document pre-existing usages that must be migrated in Plans 093–096.
		// Remove entries as each site is migrated; do not add new entries.
		const allowedFiles = new Set([
			// Canonical scheduling sites (Plan 089 target)
			resolve(srcDir, 'renderer', 'frameCoordinator.ts'),
			resolve(srcDir, 'renderer', 'gridScheduler.ts'),
			// Known exceptions — to be eliminated in Stage B plans
			resolve(srcDir, 'contextMenu.ts'),                          // focus + close delay
			resolve(srcDir, 'export', 'csvExport.ts'),                  // URL.revokeObjectURL cleanup
			resolve(srcDir, 'features', 'RowDragController.ts'),        // scroll-animation rAF loop
			resolve(srcDir, 'persistence', 'statePersistence.ts'),      // debounced auto-save
			resolve(srcDir, 'renderer', 'floatingFilterRenderer.ts'),   // filter debounce + focus
			resolve(srcDir, 'renderer', 'headerMenuController.ts'),     // filter debounce
			resolve(srcDir, 'renderer', 'scrollEngine.ts'),             // scroll-end timer
		]);
		const schedulingPattern = /\bsetTimeout\b|\brequestAnimationFrame\b|\brequestIdleCallback\b/;
		const violators: string[] = [];
		for (const file of allFiles) {
			if (allowedFiles.has(file)) continue;
			const content = readFileSync(file, 'utf-8');
			if (schedulingPattern.test(content)) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(
			violators,
			`New files calling browser scheduling APIs outside the allowed set — add migration plan or route through frameCoordinator/gridScheduler: ${violators.join(', ')}`
		).toHaveLength(0);
	});

	it('public index.ts does not re-export internal renderer or engine types (Plan 089)', () => {
		const indexPath = resolve(CORE_ROOT, 'src', 'index.ts');
		const content = readFileSync(indexPath, 'utf-8');
		// Renderer-internal types that must not appear in the public barrel
		const internalRendererTypes = ['RenderEngine', 'ViewportRenderer', 'RowRenderer', 'CellRenderer', 'PortalMountManager', 'RowSlot', 'CellSlot'];
		const violations: string[] = [];
		for (const t of internalRendererTypes) {
			// Match export { ... TypeName ... } or export type { ... TypeName ... }
			if (new RegExp(`\\b${t}\\b`).test(content)) {
				violations.push(t);
			}
		}
		expect(violations, `public index.ts re-exports renderer-internal types: ${violations.join(', ')}`).toHaveLength(0);
	});

	// ── Plan 090: feature surface triage ──────────────────────────────────────

	it('feature-registry.json exists and is valid JSON with required fields (Plan 090)', () => {
		const registryPath = resolve(CORE_ROOT, '../../docs/architecture/feature-registry.json');
		expect(existsSync(registryPath), 'docs/architecture/feature-registry.json must exist').toBe(true);
		const raw = readFileSync(registryPath, 'utf-8');
		let registry: { features?: unknown[]; alphaFeatureMatrix?: unknown[] };
		expect(() => { registry = JSON.parse(raw); }, 'feature-registry.json must be valid JSON').not.toThrow();
		registry = JSON.parse(raw);
		expect(Array.isArray(registry.features), 'feature-registry.json must have a features array').toBe(true);
		expect(Array.isArray(registry.alphaFeatureMatrix), 'feature-registry.json must have an alphaFeatureMatrix array').toBe(true);
		const validLevels = new Set(['foundation', 'reference', 'incubating', 'deferred']);
		const features = registry.features as Array<{ id?: unknown; level?: unknown }>;
		const badLevel = features.find((f) => !validLevels.has(f.level as string));
		expect(badLevel, `feature entry has invalid level: ${JSON.stringify(badLevel)}`).toBeUndefined();
		const missingId = features.find((f) => typeof f.id !== 'string' || !f.id);
		expect(missingId, `feature entry is missing id: ${JSON.stringify(missingId)}`).toBeUndefined();
	});

	it('deferred features are not directly imported by engine/ production files (Plan 090)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const registryPath = resolve(CORE_ROOT, '../../docs/architecture/feature-registry.json');
		const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as {
			features: Array<{ id: string; level: string; modules?: string[]; knownCoupling?: string }>;
		};
		// Collect modules for deferred features
		const deferredModules = registry.features
			.filter((f) => f.level === 'deferred')
			.flatMap((f) => f.modules ?? [])
			.map((m) => path.basename(m)); // match by filename
		if (deferredModules.length === 0) return;
		// Known couplings are documented in the registry; only new couplings are violations
		const knownCouplings = new Set(
			registry.features
				.filter((f) => f.level === 'deferred' && f.knownCoupling)
				.map((f) => path.basename(f.knownCoupling!.split(' imports ')[0]))
		);
		const engineDir = resolve(srcDir, 'engine');
		const engineFiles = collectSourceFiles(engineDir).filter(
			(f) => !f.endsWith('.test.ts') && !knownCouplings.has(path.basename(f))
		);
		const violators: string[] = [];
		for (const file of engineFiles) {
			const content = readFileSync(file, 'utf-8');
			for (const mod of deferredModules) {
				if (content.includes(mod.replace('.ts', ''))) {
					violators.push(`${path.relative(srcDir, file)} → ${mod}`);
				}
			}
		}
		expect(
			violators,
			`engine/ files with new deferred-feature imports (add knownCoupling to registry if intentional): ${violators.join(', ')}`
		).toHaveLength(0);
	});

	it('alpha feature matrix in feature-registry.json covers all foundation features (Plan 090)', () => {
		const registryPath = resolve(CORE_ROOT, '../../docs/architecture/feature-registry.json');
		const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as {
			features: Array<{ id: string; level: string }>;
			alphaFeatureMatrix: string[];
		};
		const foundationIds = registry.features.filter((f) => f.level === 'foundation').map((f) => f.id);
		const matrixSet = new Set(registry.alphaFeatureMatrix);
		const missing = foundationIds.filter((id) => !matrixSet.has(id));
		expect(
			missing,
			`foundation features missing from alphaFeatureMatrix: ${missing.join(', ')}`
		).toHaveLength(0);
	});

	// ── Plan 091: performance baseline laboratory ─────────────────────────────

	it('benchmark-scenarios.json exists and is valid JSON with scenarioVersion and scenarios array (Plan 091)', () => {
		const scenariosPath = resolve(CORE_ROOT, '../../docs/architecture/benchmark-scenarios.json');
		expect(existsSync(scenariosPath), 'docs/architecture/benchmark-scenarios.json must exist').toBe(true);
		const raw = readFileSync(scenariosPath, 'utf-8');
		let manifest: { scenarioVersion?: unknown; scenarios?: unknown[] };
		expect(() => { manifest = JSON.parse(raw); }, 'benchmark-scenarios.json must be valid JSON').not.toThrow();
		manifest = JSON.parse(raw);
		expect(typeof manifest.scenarioVersion, 'benchmark-scenarios.json must have a scenarioVersion field').toBe('string');
		expect(Array.isArray(manifest.scenarios), 'benchmark-scenarios.json must have a scenarios array').toBe(true);
		const scenarios = manifest.scenarios as Array<{ id?: unknown; level?: unknown }>;
		const missingId = scenarios.find((s) => typeof s.id !== 'string' || !s.id);
		expect(missingId, `scenario entry is missing id: ${JSON.stringify(missingId)}`).toBeUndefined();
	});

	it('baseline.json exists as pre-convergence metric snapshot (Plan 091)', () => {
		const baselinePath = resolve(CORE_ROOT, '../../docs/architecture/baseline.json');
		expect(existsSync(baselinePath), 'docs/architecture/baseline.json must exist').toBe(true);
		const raw = readFileSync(baselinePath, 'utf-8');
		let baseline: { capturedAt?: unknown; scenarios?: unknown[] };
		expect(() => { baseline = JSON.parse(raw); }, 'baseline.json must be valid JSON').not.toThrow();
		baseline = JSON.parse(raw);
		expect(typeof baseline.capturedAt, 'baseline.json must have a capturedAt field').toBe('string');
		expect(Array.isArray(baseline.scenarios), 'baseline.json must have a scenarios array').toBe(true);
	});

	it('ROW_MUTATION_INCREMENTAL and ROW_MUTATION_FULL_REBUILD are incremented in rowModel.ts (Plan 091)', () => {
		const rowModelPath = resolve(CORE_ROOT, 'src', 'rowModel.ts');
		const content = readFileSync(rowModelPath, 'utf-8');
		expect(content).toContain('GridMetric.ROW_MUTATION_FULL_REBUILD');
		expect(content).toContain('GridMetric.ROW_MUTATION_INCREMENTAL');
		expect(content).toContain('getInstrumentation().increment');
	});

	// ── Plan 092: aggregation input mutation correctness ─────────────────────

	it('aggregation-input is in RowMutationImpact and checked in classifyMutation (Plan 092)', () => {
		const classifierPath = resolve(CORE_ROOT, 'src', 'rows', 'rowMutationClassifier.ts');
		const content = readFileSync(classifierPath, 'utf-8');
		expect(content).toContain("'aggregation-input'");
		expect(content).toContain('aggregationFields');
		expect(content).toContain("return 'aggregation-input'");
	});

	it('applyTransaction classifies update impact and triggers refresh for aggregation-input (Plan 092)', () => {
		const rowModelPath = resolve(CORE_ROOT, 'src', 'rowModel.ts');
		const content = readFileSync(rowModelPath, 'utf-8');
		expect(content).toContain("impact === 'aggregation-input'");
		expect(content).toContain('classifyFieldMutation(allChangedFields)');
	});

	// ── Plan 093: single RAF frame arbitration ────────────────────────────────

	it('DefaultFrameCoordinator uses a single rafId (not per-channel RAF handles) (Plan 093)', () => {
		const fcPath = resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts');
		const content = readFileSync(fcPath, 'utf-8');
		// Single arbiter field
		expect(content).toContain('private rafId:');
		// Per-channel handles must not exist
		expect(content).not.toContain('scrollRafId');
		expect(content).not.toContain('paintRafId');
		expect(content).not.toContain('postScrollRafId');
	});

	it('DefaultFrameCoordinator uses pending bits (not per-channel scheduled flags) (Plan 093)', () => {
		const fcPath = resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts');
		const content = readFileSync(fcPath, 'utf-8');
		expect(content).toContain('pendingScroll');
		expect(content).toContain('pendingPaint');
		expect(content).toContain('pendingPostScroll');
		// Legacy per-channel scheduled booleans must not exist
		expect(content).not.toContain('scrollScheduled');
		expect(content).not.toContain('paintScheduled');
		expect(content).not.toContain('postScrollScheduled');
	});

	it('DefaultFrameCoordinator has scheduleFrame and flushFrame private methods (Plan 093)', () => {
		const fcPath = resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts');
		const content = readFileSync(fcPath, 'utf-8');
		expect(content).toContain('scheduleFrame()');
		expect(content).toContain('flushFrame()');
	});

	// ── Plan 094: exclusive runtime port binding ──────────────────────────────

	it('RuntimePortBindResult type exists in rendererPorts.ts (Plan 094)', () => {
		const portPath = resolve(CORE_ROOT, 'src', 'engine', 'rendererPorts.ts');
		const content = readFileSync(portPath, 'utf-8');
		expect(content).toContain('RuntimePortBindResult');
		expect(content).toContain("'already-bound'");
		expect(content).toContain("'destroyed'");
	});

	it('bindRuntimePorts returns RuntimePortBindResult and rejects concurrent binds (Plan 094)', () => {
		const storePath = resolve(CORE_ROOT, 'src', 'store.ts');
		const content = readFileSync(storePath, 'utf-8');
		expect(content).toContain('RuntimePortBindResult');
		// Must return early on already-bound without touching ports
		expect(content).toContain("reason: 'already-bound'");
		expect(content).toContain("reason: 'destroyed'");
		// storeDestroyed flag
		expect(content).toContain('storeDestroyed');
	});

	it('unbindRuntimePorts reports a fault on stale tokens instead of silently ignoring (Plan 094)', () => {
		const storePath = resolve(CORE_ROOT, 'src', 'store.ts');
		const content = readFileSync(storePath, 'utf-8');
		expect(content).toContain("operation: 'unbindRuntimePorts'");
	});

	it('gridHost.ts checks bindResult.ok before mounting (Plan 094)', () => {
		const hostPath = resolve(CORE_ROOT, 'src', 'gridHost.ts');
		const content = readFileSync(hostPath, 'utf-8');
		expect(content).toContain('bindResult');
		expect(content).toContain('bindResult.ok');
		expect(content).toContain('bindResult.binding');
	});

	// ── Plan 095: portal flush phase contract ─────────────────────────────────

	it('canFlushPortals() does not allow paint-frame (Plan 095)', () => {
		const rrPath = resolve(CORE_ROOT, 'src', 'renderer', 'renderRuntimeState.ts');
		const content = readFileSync(rrPath, 'utf-8');
		// Must NOT use paint-frame as an allowed phase for portal flushing
		// (it was removed in Plan 095)
		const canFlushMatch = content.match(/canFlushPortals\(\)[^}]+\}/s);
		expect(canFlushMatch, 'canFlushPortals method must exist').toBeTruthy();
		expect(canFlushMatch![0]).not.toContain("'paint-frame'");
	});

	it('withPortalFlushPermission exists and uses _portalFlushActive (Plan 095)', () => {
		const rrPath = resolve(CORE_ROOT, 'src', 'renderer', 'renderRuntimeState.ts');
		const content = readFileSync(rrPath, 'utf-8');
		expect(content).toContain('withPortalFlushPermission');
		expect(content).toContain('_portalFlushActive');
		expect(content).toContain('nested portal flush');
	});

	// ── Plan 096: frame epoch and post-scroll durability ─────────────────────

	it('FrameCoordinator owns scroll-frame/post-scroll transitions — not renderScrollCoordinator (Plan 096→098)', () => {
		const rscContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderScrollCoordinator.ts'), 'utf-8');
		const fcContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// Phase transitions must live in FrameCoordinator, not in the scroll coordinator callback.
		expect(rscContent).not.toContain("transitionTo('scroll-frame')");
		expect(rscContent).not.toContain("transitionTo('post-scroll')");
		// FrameCoordinator wraps the onScrollFrame callback with the transitions.
		expect(fcContent).toContain("transitionTo('scroll-frame')");
		expect(fcContent).toContain("transitionTo('post-scroll')");
	});

	it('flushFrame retains pendingPostScroll when epoch is valid but scrolling is active (Plan 096)', () => {
		const fcPath = resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts');
		const content = readFileSync(fcPath, 'utf-8');
		// Must check isScrolling and isFrameActive before running post-scroll work.
		expect(content).toContain('isScrolling()');
		expect(content).toContain('isFrameActive()');
		// Must NOT clear pendingPostScroll unconditionally — the retain comment must exist.
		expect(content).toContain('Retain pendingPostScroll');
	});

	// ── Plan 097: canonical domain command and mutation boundary ─────────────

	it('GridChange.domains field is declared on GridChangeApplier (Plan 097)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
		expect(content).toContain('domains?: ReadonlyArray<keyof GridDomainVersions>');
		expect(content).toContain('incrementDomain?:');
	});

	it('GridChangeApplier.apply increments declared domains before events (Plan 097)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
		// Domain increments must precede event dispatch — enforced by comment order in apply()
		expect(content).toContain('Increment declared domain versions');
		expect(content).toContain('Dispatch events');
		const incrementPos = content.indexOf('Increment declared domain versions');
		const dispatchPos = content.indexOf('Dispatch events');
		expect(incrementPos).toBeLessThan(dispatchPos);
	});

	it('GridStateReactionController no longer owns domain version increments (Plan 097)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridStateReactionController.ts'), 'utf-8');
		// These callbacks were removed — domain increments are declared on GridChange.domains
		expect(content).not.toContain('incrementColumnVersion');
		expect(content).not.toContain('incrementGeometryVersion');
		expect(content).not.toContain('incrementRowModelVersion');
		expect(content).not.toContain('incrementSelectionVersion');
		expect(content).not.toContain('incrementEditingVersion');
		expect(content).not.toContain('incrementFilteringVersion');
		expect(content).not.toContain('incrementSortingVersion');
	});

	it('feature controllers declare domains on their GridChange objects (Plan 097)', () => {
		const columnCtrl = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'ColumnFeatureController.ts'), 'utf-8');
		expect(columnCtrl).toContain("domains: ['columns', 'geometry']");
		const groupCtrl = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GroupingFeatureController.ts'), 'utf-8');
		expect(groupCtrl).toContain("domains: ['rows']");
		const editCtrl = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'EditingFeatureController.ts'), 'utf-8');
		expect(editCtrl).toContain("domains: ['editing']");
		const selCtrl = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'RowSelectionFeatureController.ts'), 'utf-8');
		expect(selCtrl).toContain("domains: ['selection']");
	});

	// ── Plan 098: render runtime convergence and demolition ──────────────────

	it('FrameCoordinator absorbs scroll-end detection — no second RAF loop in renderScrollCoordinator (Plan 098)', () => {
		const rscContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderScrollCoordinator.ts'), 'utf-8');
		// These fields and methods were removed in Plan 098 — FrameCoordinator owns scroll-end detection.
		expect(rscContent).not.toContain('scrollEndRafId');
		expect(rscContent).not.toContain('scrollEndTickerActive');
		expect(rscContent).not.toContain('scrollEndTick');
		expect(rscContent).not.toContain('scheduleScrollEnd');
		expect(rscContent).not.toContain('clearScrollEndTimer');
	});

	it('FrameCoordinator scroll-end detection uses quiet-frame counter (Plan 098)', () => {
		const fcContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// Single RAF loop with scroll-end detection via quiet frame counting.
		expect(fcContent).toContain('scrollEndQuietCount');
		expect(fcContent).toContain('scrollEndQuietThreshold');
		expect(fcContent).toContain('onScrollEnd');
		// Scroll-end fires after transitioning to idle — safe ordering.
		expect(fcContent).toContain("transitionTo('idle')");
	});

	it('FrameCoordinator keeps RAF alive while isScrolling (Plan 098)', () => {
		const fcContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// keepAlive logic: re-schedules if scrolling continues.
		expect(fcContent).toContain('isScrolling()');
		expect(fcContent).toContain('keepAlive');
	});

	it('renderEngine wires onScrollEnd to scrollCoordinator.finishScrolling (Plan 098)', () => {
		const reContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		// onScrollEnd callback must delegate to finishScrolling.
		expect(reContent).toContain('onScrollEnd');
		expect(reContent).toContain('finishScrolling');
		// Deleted forwarding methods must be gone.
		expect(reContent).not.toContain('scheduleScrollEnd');
		expect(reContent).not.toContain('clearScrollEndTimer');
	});

	// ── Plan 099: Row model and derived data authority ───────────────────────

	it('VisualRowModel interface is defined in rowModel.ts (Plan 099)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(content).toContain('export interface VisualRowModel<');
		// Core renderer-facing methods must be present.
		expect(content).toContain('getVisualRow(');
		expect(content).toContain('getVisualRowCount():');
		expect(content).toContain('getVisualIndexById(');
		expect(content).toContain('getVisualIndexByRowId(');
	});

	it('RowModel extends VisualRowModel (Plan 099)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(content).toContain('RowModel<TRowData = unknown> extends VisualRowModel<TRowData>');
	});

	it('GridEngine exposes getVisualRowModel() for renderer-agnostic row access (Plan 099)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain('getVisualRowModel()');
		expect(content).toContain('VisualRowModel<TRowData>');
	});

	it('renderer core paths use getVisualRowModel(), not getRowModel() (Plan 099)', () => {
		// These are the pure visual rendering paths that must not touch mutation APIs.
		const renderWindowContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderWindow.ts'), 'utf-8');
		expect(renderWindowContent).toContain('getVisualRowModel()');
		expect(renderWindowContent).not.toContain('engine.getRowModel()');

		const geometryContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'geometryController.ts'), 'utf-8');
		expect(geometryContent).toContain('getVisualRowModel()');
		expect(geometryContent).not.toContain('engine.getRowModel()');

		const maintenanceContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRenderMaintenance.ts'), 'utf-8');
		expect(maintenanceContent).toContain('getVisualRowModel()');
		expect(maintenanceContent).not.toContain('engine.getRowModel()');
	});

	// ── Plan 100: physical renderer and adapter contract ─────────────────────

	it('GridCellContentMount.slotGeneration is required (not optional) (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'IGridRenderer.ts'), 'utf-8');
		expect(content).toContain('slotGeneration: number;');
		expect(content).not.toContain('slotGeneration?: number');
	});

	it('GridCellContentMount.rowSlotId is required (not optional) (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'IGridRenderer.ts'), 'utf-8');
		expect(content).toContain('rowSlotId: string;');
		expect(content).not.toContain('rowSlotId?: string');
	});

	it('GridCellContentUnmount.slotGeneration is required (not optional) (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'IGridRenderer.ts'), 'utf-8');
		// GridCellContentUnmount section: must have required slotGeneration
		const unmountSection = content.slice(content.indexOf('GridCellContentUnmount'));
		expect(unmountSection).toContain('slotGeneration: number;');
	});

	it('PortalMountManager exposes getActiveGeneration() for deferred release generation capture (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'portalMountManager.ts'), 'utf-8');
		expect(content).toContain('getActiveGeneration(');
		expect(content).toContain('activeGenerationByKey.get(');
	});

	it('stale-detection guards in portalMountManager no longer have redundant !== undefined checks (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'portalMountManager.ts'), 'utf-8');
		expect(content).not.toContain('slotGeneration !== undefined');
	});

	it('releaseCellPortal captures generation at scheduling time via getActiveGeneration (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRendererRuntime.ts'), 'utf-8');
		expect(content).toContain('getActiveGeneration(cellKey)');
		expect(content).toContain('slotGeneration,');
	});
});

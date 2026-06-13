/**
 * Architecture guardrail tests.
 *
 * These tests enforce structural constraints that keep the codebase from
 * drifting back into the cross-file protocol and god-object patterns called
 * out in Plans 011-014.
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
	it('store.ts is below 875 lines (intermediate budget, target 850)', () => {
		const lines = countLines('store.ts');
		expect(lines, `store.ts has ${lines} lines; intermediate budget is 875 and target is 850`).toBeLessThan(875);
	});

	it('GridEngine.ts is below 1000 lines (intermediate budget, target 800)', () => {
		const lines = countLines('engine/GridEngine.ts');
		expect(lines, `GridEngine.ts has ${lines} lines; intermediate budget is 1000 and target is 800`).toBeLessThan(1000);
	});

	it('GridEngine.ts is below 800 lines', () => {
		const lines = countLines('engine/GridEngine.ts');
		expect(lines, `GridEngine.ts has ${lines} lines and must be below 800`).toBeLessThan(800);
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
		expect(engineContent).toContain('this.scrollCoordinator.syncCheapScrollOnly(layoutPlan)');
		expect(engineContent).not.toContain('computeRenderWindowInto(');
		expect(engineContent).not.toContain('sameRenderedWindow(');
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
		expect(content).toContain('bindAllDataCellsRuntime(createRowRendererRuntimeArgs(');
		expect(content).toContain('bindAllLoadingCellsRuntime(createRowRendererRuntimeArgs(');
	});

	it('rowCellBinder owns extracted live cell-binding policy', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBinder.ts'), 'utf-8');
		expect(content).toContain('export function bindCellFull');
		expect(content).toContain('export function bindCellDuringScroll');
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
});

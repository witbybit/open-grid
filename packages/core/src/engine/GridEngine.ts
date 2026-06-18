import { canEditCell, isDataCellSelectable } from '../visualRow.js';
import { GridEventName } from '../api/GridEvents.js';
import type { GridEventListener, GridEventPayloadMap } from '../api/GridEvents.js';
import type {
	CellSubscription,
	GridCellPointer,
	GridCellRange,
	GridSelectionSource,
	RowSelectionChangeResult,
	RowSelectionGesture,
	RowSelectionGestureSource,
	RowSelectionScope,
} from '../api/GridApi.js';
import type { ColumnDef } from '../columnDef.js';
import type { GridState, GridStateUpdater, Listener } from '../state/GridState.js';
import type { RowModel, VisualRowModel } from '../rowModel.js';
import { StateManager } from '../state/StateManager.js';
import { CommandHistory } from '../commands/CommandHistory.js';
import { EventBus } from '../events/EventBus.js';
import { DataModel } from '../models/DataModel.js';
import { ColumnModel } from '../models/ColumnModel.js';
import { ViewportModel } from '../models/ViewportModel.js';
import { GeometryModel } from '../models/GeometryModel.js';
import { SelectionModel } from '../models/SelectionModel.js';
import { EditModel } from '../models/EditModel.js';
import { CellAccessModel } from '../models/CellAccess.js';
import { DagEngine, type FormulaCellCoordinate } from '../calculations/dagEngine.js';
import { SpreadsheetFillEngine } from '../spreadsheet/fillRange.js';
import type { GridEngineConfig } from './GridEngineConfig.js';
import type { SortModel, FilterModel } from '../rowModel.js';
import { InvalidationManager } from '../renderer/invalidationManager.js';
import { GridChangeApplier } from './GridChangeApplier.js';
import { ColumnFeatureController } from '../features/ColumnFeatureController.js';
import { GroupingFeatureController } from '../features/GroupingFeatureController.js';
import { EditingFeatureController } from '../features/EditingFeatureController.js';
import { ValidationManager } from '../features/ValidationManager.js';
import { RowSelectionFeatureController } from '../features/RowSelectionFeatureController.js';
import { DataMutationController } from '../features/DataMutationController.js';
import { GridStateFeatureController } from '../features/GridStateFeatureController.js';
import { CellNotificationController } from './CellNotificationController.js';
import { GridStateReactionController } from './GridStateReactionController.js';
import { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';
import { ColumnAutoSizeController } from '../features/ColumnAutoSizeController.js';
import type { AutoSizeColumnOptions, AutoSizeAllColumnsOptions } from '../features/ColumnAutoSizeController.js';
import { ClipboardController } from '../features/ClipboardController.js';
import { computeDistinctValues } from '../filterModel.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import { type GridInstrumentation, NOOP_INSTRUMENTATION } from '../diagnostics/GridInstrumentation.js';

export class GridEngine<TRowData = unknown> {
	public readonly data: DataModel<TRowData>;
	public readonly columns: ColumnModel<TRowData>;
	public readonly viewport: ViewportModel<TRowData>;
	public readonly geometry: GeometryModel;
	public readonly selection: SelectionModel;
	public readonly edit: EditModel;
	public readonly cellAccess: CellAccessModel<TRowData>;

	public readonly stateManager: StateManager<TRowData>;
	public readonly commandHistory: CommandHistory;
	public readonly eventBus: EventBus<TRowData>;
	public readonly runtimeFaults: RuntimeFaultReporter<TRowData>;
	public readonly invalidation: InvalidationManager;
	public readonly changeApplier: GridChangeApplier<TRowData>;
	public readonly columnFeature: ColumnFeatureController<TRowData>;
	public readonly columnAutoSize: ColumnAutoSizeController<TRowData>;
	public readonly clipboard: ClipboardController<TRowData>;
	public readonly groupingFeature: GroupingFeatureController<TRowData>;
	public readonly editingFeature: EditingFeatureController<TRowData>;
	public readonly validationFeature: ValidationManager<TRowData>;
	public readonly rowSelectionFeature: RowSelectionFeatureController<TRowData>;
	public readonly dataMutation: DataMutationController<TRowData>;
	public readonly stateFeature: GridStateFeatureController<TRowData>;
	private readonly formulas: DagEngine;
	private readonly spreadsheetFill: SpreadsheetFillEngine<TRowData>;
	private readonly stateReactions: GridStateReactionController<TRowData>;

	private rowModel: RowModel<TRowData> | null = null;

	public geometryVersion = 0;
	public rowModelVersion = 0;
	public columnVersion = 0;
	public selectionVersion = 0;
	public editingVersion = 0;
	public filteringVersion = 0;
	public sortingVersion = 0;

	/** Active instrumentation sink. Defaults to noop; call setInstrumentation() to swap in a recording sink. */
	public instrumentation: GridInstrumentation = NOOP_INSTRUMENTATION;

	public setInstrumentation(inst: GridInstrumentation): void {
		this.instrumentation = inst;
		this.stateManager.instrumentation = inst;
	}

	private readonly domainVersionListeners = new Set<(v: GridDomainVersions) => void>();
	private readonly domainListeners = new Map<keyof GridDomainVersions, Set<(version: number) => void>>();

	/** Returns a snapshot of all formal domain version counters. */
	public getDomainVersions(): GridDomainVersions {
		return {
			columns: this.columnVersion,
			rows: this.rowModelVersion,
			geometry: this.geometryVersion,
			selection: this.selectionVersion,
			editing: this.editingVersion,
			filtering: this.filteringVersion,
			sorting: this.sortingVersion,
			styling: 0,
		};
	}

	/** Subscribes to domain version changes. The listener is called once per committed
	 *  logical mutation in any domain. Returns an unsubscribe function. */
	public subscribeToDomainVersions(listener: (v: GridDomainVersions) => void): () => void {
		this.domainVersionListeners.add(listener);
		return () => this.domainVersionListeners.delete(listener);
	}

	/** Subscribes to version increments for a single domain. The listener receives the new
	 *  version counter each time that domain is mutated. Returns an unsubscribe function. */
	public subscribeDomain(domain: keyof GridDomainVersions, listener: (version: number) => void): () => void {
		let set = this.domainListeners.get(domain);
		if (!set) {
			set = new Set();
			this.domainListeners.set(domain, set);
		}
		set.add(listener);
		return () => {
			const s = this.domainListeners.get(domain);
			if (s) s.delete(listener);
		};
	}

	private notifyDomainVersionListeners(domain?: keyof GridDomainVersions): void {
		const v = this.getDomainVersions();
		this.domainVersionListeners.forEach((l) => l(v));
		if (domain) {
			const set = this.domainListeners.get(domain);
			if (set) {
				const version = v[domain];
				set.forEach((l) => l(version));
			}
		}
	}

	public incrementDomain(domain: keyof GridDomainVersions): void {
		switch (domain) {
			case 'columns':
				this.columnVersion++;
				break;
			case 'rows':
				this.rowModelVersion++;
				break;
			case 'geometry':
				this.geometryVersion++;
				break;
			case 'selection':
				this.selectionVersion++;
				break;
			case 'editing':
				this.editingVersion++;
				break;
			case 'filtering':
				this.filteringVersion++;
				break;
			case 'sorting':
				this.sortingVersion++;
				break;
		}
		this.notifyDomainVersionListeners(domain);
	}

	// Per-row version map: rowId → version, bumped on each row data mutation.
	// Keyed directly on the engine (not in GridState) so updates are zero-allocation.
	public readonly rowVersions = new Map<string, number>();

	private _scrollStateProvider: { isScrolling(): boolean; phase: string } | null = null;

	/** Set once by the renderer during initialization; headless grids return false. */
	public setScrollStateProvider(provider: { isScrolling(): boolean; phase: string }): void {
		this._scrollStateProvider = provider;
	}

	public get isScrolling(): boolean {
		return this._scrollStateProvider?.isScrolling() ?? false;
	}

	public get isScrollFrameActive(): boolean {
		return this._scrollStateProvider?.phase === 'scroll-frame';
	}

	public getCellValueCallsDuringScroll = 0;
	public valueGetterCallsDuringScroll = 0;
	public formulaCallsDuringScroll = 0;
	public customRendererMountsDuringScroll = 0;
	public customRendererHydrationChunks = 0;
	public customRendererWarmHits = 0;
	public customRendererWarmMisses = 0;

	private readonly cellNotifications: CellNotificationController<TRowData>;
	private renderTransactionDepth = 0;
	private pendingRenderReason: string | null = null;

	private readonly getContainerElement: () => HTMLElement | null;

	constructor(config: GridEngineConfig<TRowData>) {
		this.getContainerElement = config.getContainerElement ?? (() => null);
		this.eventBus = new EventBus<TRowData>();
		this.runtimeFaults = new RuntimeFaultReporter<TRowData>({
			emit: (fault) => this.eventBus.dispatchEvent(GridEventName.runtimeFault, fault),
		});
		this.eventBus.setRuntimeFaultReporter(this.runtimeFaults);
		this.commandHistory = new CommandHistory(this.runtimeFaults);
		this.invalidation = new InvalidationManager();
		this.formulas = new DagEngine();
		this.spreadsheetFill = new SpreadsheetFillEngine(this);

		// Construct sub-models
		this.geometry = new GeometryModel();
		this.data = new DataModel<TRowData>({
			getState: () => this.stateManager.getState(),
			getRowModel: () => this.rowModel,
			getColumnDef: (colField) => this.columns.getColumnDef(colField),
			hasFormula: (rowId, colField) => this.hasFormula(rowId, colField),
			getFormula: (rowId, colField) => this.getFormula(rowId, colField),
			getCachedFormulaValue: (rowId, colField) => this.getCachedFormulaValue(rowId, colField),
			evaluateFormulaCell: (rowId, colField, getRawValue) => this.evaluateFormulaCell(rowId, colField, getRawValue),
			syncFormulaForCell: (rowId, colField, value) => this.syncFormulaForCell(rowId, colField, value),
			isScrolling: () => this.isScrolling,
			isScrollFrameActive: () => this.isScrollFrameActive,
			recordGetCellValueDuringScroll: () => {
				this.getCellValueCallsDuringScroll++;
			},
			recordValueGetterDuringScroll: () => {
				this.valueGetterCallsDuringScroll++;
			},
			recordFormulaDuringScroll: () => {
				this.formulaCallsDuringScroll++;
			},
		});
		this.columns = new ColumnModel<TRowData>({
			geometry: this.geometry,
			updateCompiledGetters: (columns) => this.data.updateCompiledGetters(columns),
			getPinnedColumnCounts: () => ({
				left: this.viewport.pinLeftColumns,
				right: this.viewport.pinRightColumns,
			}),
			getGeometryVersion: () => this.geometryVersion,
		});
		this.viewport = new ViewportModel<TRowData>();
		this.selection = new SelectionModel();
		this.edit = new EditModel();
		this.cellAccess = new CellAccessModel<TRowData>({
			getRowModel: () => this.rowModel,
			getColumnIndex: (colField) => this.columns.getColumnIndex(colField),
			getColumnDef: (colField) => this.columns.getColumnDef(colField),
			getCellValue: (rowId, colField) => this.data.getCellValue(rowId, colField),
			getRawCellValue: (rowId, colField) => this.data.getRawCellValue(rowId, colField),
			getState: () => this.stateManager.getState(),
			isRowSelected: (rowIndex) => this.selection.isRowSelected(rowIndex),
			isRowLoading: (rowId) => this.data.isRowLoading(rowId),
		});
		this.cellNotifications = new CellNotificationController<TRowData>({
			data: this.data,
			eventBus: this.eventBus,
			invalidation: this.invalidation,
			requestRender: (reason) => this.requestRender(reason),
			rowVersions: this.rowVersions,
			faultReporter: this.runtimeFaults,
		});
		this.stateReactions = new GridStateReactionController<TRowData>({
			getStateManager: () => this.stateManager,
			data: this.data,
			columns: this.columns,
			geometry: this.geometry,
			viewport: this.viewport,
			selection: this.selection,
			invalidation: this.invalidation,
			eventBus: this.eventBus,
			cellNotifications: this.cellNotifications,
			getRowModel: () => this.rowModel,
			getRowHeightsList: (rowModel, rowHeightsRecord, defaultRowHeight) => this.getRowHeightsList(rowModel, rowHeightsRecord, defaultRowHeight),
			notifyCellChange: (rowId, colField) => this.notifyCellChange(rowId, colField),
			requestRender: (reason) => this.requestRender(reason),
		});

		const initialSelection = config.selection ?? this.selection.createCellSelection(null, 'program');

		// Set initial state
		const initialState: GridState<TRowData> = {
			columns: config.columns || [],
			selection: initialSelection,
			selectedRowIds: config.selectedRowIds ?? [],
			rowSelection: config.rowSelection,
			rowHeights: config.rowHeights || {},
			columnWidths: config.columnWidths || {},
			defaultRowHeight: config.defaultRowHeight || 40,
			defaultColWidth: config.defaultColWidth || 100,
			enableColumnReorder: config.enableColumnReorder ?? true,
			activeEdit: config.activeEdit || null,
			sortModel: config.sortModel || null,
			filterModel: config.filterModel || null,
			themeName: config.themeName ?? 'dark',
			globalVersion: 0,
			visibleRowRange: { startIdx: 0, endIdx: 0 },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			getRowId: config.getRowId,
			loading: config.loading,
			loadingSkeletonCount: config.loadingSkeletonCount,
			styleRules: config.styleRules,

			// Tree / Grouping / Master-Detail State
			groupBy: config.groupBy,
			getParentId: config.getParentId,
			masterDetailEnabled: config.masterDetailEnabled,
			groupRowHeight: config.groupRowHeight,
			detailRowHeight: config.detailRowHeight,
			detailRenderer: config.detailRenderer,
			rowModelConfig: config.rowModelConfig,
			showGroupFooter: config.showGroupFooter,
			enableStickyGroupRows: config.enableStickyGroupRows,
			showGroupPanel: config.showGroupPanel,
			showFilterChipBar: config.showFilterChipBar,
			showFloatingFilters: config.showFloatingFilters,
			showStatusBar: config.showStatusBar,
			pagination: config.pagination,
			expansion: config.expansion ?? { groups: {}, treeRows: {}, details: {} },
			rowOverscanPx: config.rowOverscanPx ?? 400,
			colBuffer: config.colBuffer ?? 2,
			runtimeLimits: config.runtimeLimits,
			overscanAdaptive: config.overscanAdaptive,
		};

		// Construct StateManager with coordinate state update bridging
		this.stateManager = new StateManager<TRowData>(
			initialState,
			this.stateReactions.handleStateChanges,
			this.runtimeFaults,
			this.instrumentation
		);

		// Initialize changeApplier after stateManager is available
		this.changeApplier = new GridChangeApplier<TRowData>({
			stateManager: this.stateManager,
			invalidation: this.invalidation,
			eventBus: this.eventBus,
			commandHistory: this.commandHistory,
			requestRender: (reason) => this.requestRender(reason),
			incrementDomain: (domain) => this.incrementDomain(domain),
		});

		// Initialize feature controllers (columns model will be linked after sub-models init)
		const featureContext = {
			columns: this.columns,
			getState: () => this.stateManager.getState(),
			applyChange: (change: import('./GridChangeApplier.js').GridChange<TRowData>) => this.changeApplier.apply(change),
		};
		this.columnFeature = new ColumnFeatureController<TRowData>(featureContext);
		this.columnAutoSize = new ColumnAutoSizeController<TRowData>({
			getState: () => this.stateManager.getState(),
			columns: this.columns,
			data: this.data,
			columnFeature: this.columnFeature,
			getRowModel: () => this.rowModel,
			getContainerElement: () => this.getContainerElement(),
		});
		this.clipboard = new ClipboardController<TRowData>({
			getState: () => this.stateManager.getState(),
			getVisualRow: (idx) => this.rowModel?.getVisualRow(idx) ?? null,
			getVisualIndexByRowId: (id) => this.rowModel?.getVisualIndexByRowId(id) ?? null,
			getColumnIndex: (f) => this.columns.getColumnIndex(f),
			getCellValue: (rowId, colField) => this.data.getCellValue(rowId, colField),
			getCheapDisplayValue: (rowId, colField) => this.data.getCheapDisplayValue(rowId, colField),
			getRawRowById: (rowId) => this.rowModel?.getRawRowById(rowId) ?? null,
			batchCellValues: (updates, source) => this.batchCellValues(updates, source),
			dispatchEvent: (type, payload) => this.eventBus.dispatchEvent(type, payload),
		});
		this.groupingFeature = new GroupingFeatureController<TRowData>({
			ctx: featureContext,
			getRowModel: () => this.rowModel,
			invalidation: this.invalidation,
		});
		this.validationFeature = new ValidationManager<TRowData>({
			ctx: featureContext,
			getRowModel: () => this.rowModel,
			data: this.data,
			rowValidator: config.rowValidator,
		});
		this.editingFeature = new EditingFeatureController<TRowData>({
			ctx: featureContext,
			getRowModel: () => this.rowModel,
			data: this.data,
			notifyCellChange: (rowId, colField) => this.notifyCellChange(rowId, colField),
			setCellValue: (rowId, colField, value, undoable) => this.setCellValue(rowId, colField, value, undoable),
			clearValidationError: (rowId, colField) => this.validationFeature._setCellError(rowId, colField, null),
			setValidationError: (rowId, colField, error) => this.validationFeature._setCellError(rowId, colField, error),
			validateCellPostCommit: (rowId, colField) => this.validationFeature.validateCell(rowId, colField).then(() => undefined),
		});
		this.rowSelectionFeature = new RowSelectionFeatureController<TRowData>(featureContext, () => this.rowModel);
		this.stateFeature = new GridStateFeatureController<TRowData>({
			stateManager: this.stateManager,
			invalidation: this.invalidation,
			commandHistory: this.commandHistory,
			eventBus: this.eventBus,
			requestRender: (reason) => this.requestRender(reason),
			applyChange: (change) => this.changeApplier.apply(change),
		});
		this.dataMutation = new DataMutationController<TRowData>({
			data: this.data,
			columns: this.columns,
			commandHistory: this.commandHistory,
			eventBus: this.eventBus,
			getRowModel: () => this.rowModel,
			syncFormulaForCell: (rowId, colField, value) => this.syncFormulaForCell(rowId, colField, value),
			invalidateFormulaCell: (rowId, colField) => this.invalidateFormulaCell(rowId, colField),
			getBatchedUpdates: () => this.batchedUpdates,
			enqueueCellUpdate: (rowId, colField) => this.enqueueCellUpdate(rowId, colField),
			scheduleBatchFlush: () => this.scheduleBatchFlush(),
			notifyCellChange: (rowId, colField) => this.notifyCellChange(rowId, colField),
		});

		// Link sub-models back to this engine context
		this.viewport.init(this);
		this.geometry.init();
		this.selection.init();
		this.edit.init();

		// Setup columns if they are passed in config
		if (config.columns) {
			this.columns.updateColumns(config.columns, config.columnWidths || {}, config.defaultColWidth);
		}
	}

	public setData(payload: { columns?: ColumnDef<TRowData>[]; defaultColWidth?: number; defaultRowHeight?: number }): void {
		this.stateManager.setState((state) => ({
			...state,
			...payload,
		}));
		if (payload.columns !== undefined || payload.defaultColWidth !== undefined) {
			this.incrementDomain('columns');
		}
		if (payload.defaultRowHeight !== undefined) {
			this.incrementDomain('geometry');
		}
		this.invalidation.invalidateFull('set data');
		this.requestRender('set data');
		this.commandHistory.clear();
	}

	public getState(): GridState<TRowData> {
		return this.stateManager.getState();
	}
	public setState(updater: GridStateUpdater<TRowData>): void {
		this.stateManager.setState(updater);
	}
	/** Allowlisted direct write for row-model bootstrap. */
	public initializeRowModelState(model: { columns?: GridState<TRowData>['columns']; getRowId?: ((row: TRowData) => string) | undefined }): void {
		const nextState: Partial<GridState<TRowData>> = {};
		if (model.columns) nextState.columns = model.columns;
		if (model.getRowId !== undefined) nextState.getRowId = model.getRowId;
		if (Object.keys(nextState).length > 0) this.stateManager.setState(nextState);
	}
	/** Allowlisted direct write for derived row-model structural version bumps. */
	public bumpRowModelGlobalVersion(): void {
		this.stateManager.setState((state) => ({ globalVersion: state.globalVersion + 1 }));
		this.incrementDomain('rows');
	}
	/** Allowlisted direct write for derived expansion synchronization. */
	public updateExpansionState(updater: (expansion: GridState<TRowData>['expansion']) => GridState<TRowData>['expansion']): void {
		this.stateManager.setState((state) => ({ expansion: updater(state.expansion) }));
	}
	/** Allowlisted direct write for server row-model loading state. */
	public setRowModelLoadingState(loading: boolean): void {
		this.stateManager.setState((state) => ({ loading, globalVersion: state.globalVersion + 1 }));
		this.incrementDomain('rows');
		this.incrementDomain('geometry');
	}
	/** Allowlisted direct write for server-owned pagination metadata. */
	public setServerPaginationState(payload: NonNullable<GridState<TRowData>['serverPagination']>): void {
		this.stateManager.setState({ serverPagination: payload });
	}

	public subscribe(listener: Listener<TRowData>): () => void {
		return this.stateManager.subscribe(listener);
	}
	public subscribeToKey(key: string, listener: Listener<TRowData>): () => void {
		return this.stateManager.subscribeToKey(key, listener);
	}

	public addEventListener<K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	): () => void {
		return this.eventBus.addEventListener(type, callback);
	}

	public dispatchEvent<K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void {
		this.eventBus.dispatchEvent(type, payload);
	}

	public getRowId(row: TRowData): string {
		return this.data.getRowId(row);
	}
	public isRowLoading(rowId: string): boolean {
		return this.data.isRowLoading(rowId);
	}
	public getCellDisplayValue(rowId: string, colField: string): unknown {
		return this.data.getCellValue(rowId, colField);
	}
	public getCachedDisplayValue(rowId: string, colField: string): string | undefined {
		return this.data.getCachedDisplayValue(rowId, colField);
	}
	public getCheapDisplayValue(rowId: string, colField: string): string {
		return this.data.getCheapDisplayValue(rowId, colField);
	}
	public getComputedCellValue(rowId: string, colField: string): unknown {
		return this.data.getComputedCellValue(rowId, colField);
	}
	public getRawCellValue(rowId: string, colField: string): unknown {
		return this.data.getRawCellValue(rowId, colField);
	}
	public getDisplayedColumns(): ColumnDef<TRowData>[] {
		return this.columns.getDisplayedColumns().slice();
	}
	public getPinnedColumns(): { left: number; right: number } {
		return { left: this.viewport.pinLeftColumns, right: this.viewport.pinRightColumns };
	}
	public getColumnIndex(colField: string): number {
		return this.columns.getColumnIndex(colField);
	}
	public getColumnField(colIndex: number): string | null {
		return this.columns.getColumnField(colIndex);
	}
	public getColumnDef(colField: string): ColumnDef<TRowData> | undefined {
		return this.columns.getColumnDef(colField);
	}
	public getValueGetterDependents(colField: string): string[] {
		return this.columns.getValueGetterDependents(colField);
	}
	public hasValueGetter(colField: string): boolean {
		return this.columns.hasValueGetter(colField);
	}
	public getCompiledPlanVersion(): number {
		return this.columns.getCompiledPlanVersion();
	}
	public isScrollingFast(): boolean {
		return this.viewport.isScrollingFast;
	}
	public getScrollVelocity(): { vx: number; vy: number } {
		return this.viewport.getVelocity();
	}
	public getRowOverscanPx(): number {
		return this.stateFeature.getRowOverscanPx();
	}
	public setRowOverscanPx(px: number): void {
		this.stateFeature.setRowOverscanPx(px);
	}
	public getColBuffer(): number {
		return this.stateFeature.getColBuffer();
	}
	public setColBuffer(colBuffer: number): void {
		this.stateFeature.setColBuffer(colBuffer);
	}

	public selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'api'): void {
		this.applySelectionRange(start, end, source);
	}

	public resizeColumn(colField: string, width: number, undoable = true): void {
		this.columnFeature.resizeColumn(colField, width, undoable);
	}
	public autoSizeColumn(colField: string, opts?: AutoSizeColumnOptions): void {
		this.columnAutoSize.autoSizeColumn(colField, opts);
	}
	public autoSizeAllColumns(opts?: AutoSizeAllColumnsOptions): void {
		this.columnAutoSize.autoSizeAllColumns(opts);
	}
	public copySelectedRange(): Promise<void> {
		return this.clipboard.copySelectedRange();
	}
	public pasteFromClipboard(): Promise<void> {
		return this.clipboard.pasteFromClipboard();
	}
	public copyRange(minRow: number, maxRow: number, minCol: number, maxCol: number): Promise<void> {
		return this.clipboard.copyRange(minRow, maxRow, minCol, maxCol);
	}
	public getColumnDistinctValues(colField: string): (string | number | null)[] {
		return computeDistinctValues(this.rowModel?.getAllDataNodes?.() ?? [], colField);
	}
	public moveColumn(colField: string, toIndex: number): void {
		this.columnFeature.moveColumn(colField, toIndex);
	}
	public setColumnOrderByFields(colFields: string[]): void {
		this.columnFeature.setColumnOrderByFields(colFields);
	}
	public setColumnReorderEnabled(enabled: boolean): void {
		this.columnFeature.setColumnReorderEnabled(enabled);
	}
	public setStyleRules(styleRules: GridState<TRowData>['styleRules']): void {
		this.stateFeature.setStyleRules(styleRules);
	}
	public setShowFloatingFilters(enabled: boolean): void {
		this.stateFeature.setShowFloatingFilters(enabled);
	}
	public setSidebarOpenPanel(panelId: string | null): void {
		this.stateFeature.setSidebarOpenPanel(panelId);
	}
	public setChartOpen(chartOpen: boolean): void {
		this.stateFeature.setChartOpen(chartOpen);
	}
	public setThemeName(themeName: GridState<TRowData>['themeName']): void {
		this.stateFeature.setThemeName(themeName);
	}
	public resizeRow(rowId: string, height: number, undoable = true): void {
		this.stateFeature.resizeRow(rowId, height, undoable);
	}
	public setRowHeights(rowHeights: Record<string, number>): void {
		this.stateFeature.setRowHeights(rowHeights);
	}
	public setDefaultRowHeight(defaultRowHeight: number): void {
		this.stateFeature.setDefaultRowHeight(defaultRowHeight);
	}
	public setSortModel(sortModel: SortModel | null, undoable = true): void {
		this.stateFeature.setSortModel(sortModel, undoable);
	}
	public setFilterModel(filterModel: FilterModel | null, undoable = true): void {
		this.stateFeature.setFilterModel(filterModel, undoable);
	}
	public setPaginationPage(page: number, metrics?: { pageCount: number; totalRows: number }): void {
		this.stateFeature.setPaginationPage(page, metrics);
	}
	public setPinnedColumnsState(left: number, right: number): void {
		this.changeApplier.apply({
			reason: 'columns:set-pinned-counts',
			state: { pinnedColumns: { left, right } },
			invalidations: [
				{ kind: 'geometry', reason: 'pin' },
				{ kind: 'viewport', reason: 'pin' },
				{ kind: 'headers', reason: 'pin' },
			],
			domains: ['columns', 'geometry'],
			requestRender: true,
		});
	}

	public setGroupBy(colIds: string[]): void {
		this.groupingFeature.setGroupBy(colIds);
	}
	public addGroupBy(colId: string, atIndex?: number): void {
		this.groupingFeature.addGroupBy(colId, atIndex);
	}
	public removeGroupBy(colId: string): void {
		this.groupingFeature.removeGroupBy(colId);
	}
	public moveGroupBy(colId: string, toIndex: number): void {
		this.groupingFeature.moveGroupBy(colId, toIndex);
	}
	public setShowGroupPanel(enabled: boolean): void {
		this.groupingFeature.setShowGroupPanel(enabled);
	}
	public setAggDefs(defs: import('../rows/stages/aggregateStage.js').AggregationDef<TRowData>[]): void {
		this.groupingFeature.setAggDefs(defs);
	}
	public setShowGroupFooter(enabled: boolean): void {
		this.groupingFeature.setShowGroupFooter(enabled);
	}
	public setStickyGroupRows(enabled: boolean): void {
		this.groupingFeature.setStickyGroupRows(enabled);
	}
	public setCellValue(rowId: string, colField: string, value: unknown, undoable = true): void {
		this.dataMutation.applyCellValueChange(rowId, colField, value, { undoable });
	}

	public batchCellValues(updates: { rowId: string; colField: string; value: unknown }[], source: 'paste' | 'api' | 'fill' = 'api'): void {
		this.dataMutation.applyBatchCellValues(updates, { undoable: true, source });
	}

	public startEdit(rowId: string, colField: string): void {
		this.editingFeature.startEdit(rowId, colField);
	}

	public stopEdit(cancel = false): void {
		this.editingFeature.stopEdit(cancel);
	}

	public registerRowModel(rowModel: RowModel<TRowData>): void {
		this.rowModel = rowModel;
		this.rowModelVersion++;
		this.geometryVersion++;
		this.notifyDomainVersionListeners();
		// Refresh coordinates
		const state = this.stateManager.getState();
		this.geometry.updateRows(this.getRowHeightsList(rowModel, state.rowHeights, state.defaultRowHeight), state.defaultRowHeight);
		this.stateManager.setState({ globalVersion: state.globalVersion + 1 });
		this.invalidation.invalidateGeometry('row model registered');
		this.invalidation.invalidateFull('row model registered');
		this.requestRender('row model registered');
	}

	public getRowModel(): RowModel<TRowData> | null {
		return this.rowModel;
	}

	/** Renderer-facing row model contract. Renderer paths must use this, not getRowModel(). */
	public getVisualRowModel(): VisualRowModel<TRowData> | null {
		return this.rowModel;
	}

	public clearFormulas(): void {
		this.formulas.clearAll();
	}

	public hasFormula(rowId: string, colField: string): boolean {
		return this.formulas.hasFormula(rowId, colField);
	}

	public getFormula(rowId: string, colField: string): string | undefined {
		return this.formulas.getFormula(rowId, colField);
	}

	public syncFormulaForCell(rowId: string, colField: string, value: unknown): void {
		if (typeof value === 'string' && value.startsWith('=')) {
			this.formulas.registerFormula(rowId, colField, value);
			return;
		}
		this.formulas.clearFormula(rowId, colField);
	}

	public evaluateFormulaCell(rowId: string, colField: string, getRawValue: (rId: string, cField: string) => unknown): unknown {
		return this.formulas.getCellValue(rowId, colField, getRawValue);
	}

	public invalidateFormulaCell(rowId: string, colField: string): FormulaCellCoordinate[] {
		return this.formulas.invalidateCell(rowId, colField);
	}

	public getCachedFormulaValue(rowId: string, colField: string): { hasCached: boolean; value: unknown } {
		return this.formulas.getCachedFormulaValue(rowId, colField);
	}

	private getRowHeightsList(rowModel: RowModel<TRowData>, rowHeightsRecord: Record<string, number>, defaultRowHeight: number): number[] {
		let count = rowModel.getVisualRowCount();
		const state = this.stateManager.getState();
		if (state.loading && count === 0) {
			count = state.loadingSkeletonCount ?? 15;
		}
		const heights: number[] = [];
		for (let i = 0; i < count; i++) {
			const row = rowModel.getVisualRow(i);
			if (row) {
				const explicitHeight = row.height ?? rowHeightsRecord[row.id];
				heights.push(explicitHeight !== undefined ? explicitHeight : defaultRowHeight);
			} else {
				heights.push(defaultRowHeight);
			}
		}
		return heights;
	}

	public get batchedUpdates(): boolean {
		return this.cellNotifications.batchedUpdates;
	}

	public set batchedUpdates(enabled: boolean) {
		this.cellNotifications.batchedUpdates = enabled;
	}

	public batch = (callback: () => void): void => {
		this.beginRenderTransaction();
		this.stateManager.startTransaction();
		try {
			callback();
		} finally {
			this.stateManager.endTransaction();
			this.flushCellUpdatesSync();
			this.endRenderTransaction();
		}
	};

	public scheduleBatchFlush(): void {
		this.cellNotifications.scheduleBatchFlush();
	}

	public flushCellUpdates(): void {
		this.cellNotifications.flushCellUpdates();
	}

	public enqueueCellUpdate(rowId: string, colField: string): void {
		this.cellNotifications.enqueueCellUpdate(rowId, colField);
	}

	public flushCellUpdatesSync(): void {
		this.cellNotifications.flushCellUpdatesSync();
	}

	public notifyBulkCellChange(changes: Map<string, Set<string>>): void {
		this.cellNotifications.notifyBulkCellChange(changes);
	}

	public notifyCellChange(rowId: string, colField: string): void {
		this.cellNotifications.notifyCellChange(rowId, colField);
	}

	public registerCellSubscription = (sub: CellSubscription): void => {
		this.cellNotifications.registerCellSubscription(sub);
	};

	public unregisterCellSubscription = (sub: CellSubscription): void => {
		this.cellNotifications.unregisterCellSubscription(sub);
	};

	public updateCellSubscription = (sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void => {
		this.cellNotifications.updateCellSubscription(sub, oldRowId, oldColField, newRowId, newColField);
	};

	// ── Row node selection ─────────────────────────────────────────────────────

	public applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null {
		return this.rowSelectionFeature.applyRowSelectionGesture(gesture);
	}

	public selectRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.selectRowIds(rowIds, source);
	}

	public replaceRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.replaceRowIds(rowIds, source);
	}

	public deselectRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.deselectRowIds(rowIds, source);
	}

	public toggleRowId(rowId: string, source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.toggleRowId(rowId, source);
	}

	public selectAllDataRows(source: RowSelectionGestureSource = 'api', scope?: RowSelectionScope, mode?: 'add' | 'replace'): void {
		this.rowSelectionFeature.selectAllDataRows(source, scope, mode);
	}

	public clearRowSelection(source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.clearRowSelection(source);
	}

	private applySelectionRange = (start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'program'): void => {
		const validStart = this.isDataCellSelectable(start) ? start : null;
		const validEnd = this.isDataCellSelectable(end) ? end : null;
		if ((start || end) && (!validStart || !validEnd)) {
			start = validStart;
			end = validEnd;
		}
		const range = start !== null && end !== null ? { start, end } : null;
		const selection = this.selection.setSelection({
			focus: end,
			anchor: start,
			range,
			source,
		});
		this.stateManager.setState({
			selection,
		});
		this.incrementDomain('selection');
	};

	private canEditCell(rowId: string, colField: string): boolean {
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return canEditCell(visualRow, this.columns.getColumnDef(colField));
	}

	private isDataCellSelectable(pointer: GridCellPointer | null): pointer is GridCellPointer {
		if (!pointer) return false;
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(pointer.rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return isDataCellSelectable(visualRow, this.columns.getColumnDef(pointer.colField));
	}

	public setColumns(columns: ColumnDef<TRowData>[], undoable = false): void {
		this.columnFeature.setColumns(columns, undoable);
	}

	private requestRender(reason: string): void {
		if (this.renderTransactionDepth > 0) {
			this.pendingRenderReason = this.pendingRenderReason ? `${this.pendingRenderReason}+${reason}` : reason;
			return;
		}
		this.eventBus.dispatchEvent(GridEventName.renderInvalidated, { reason });
	}

	private beginRenderTransaction(): void {
		this.renderTransactionDepth++;
	}

	private endRenderTransaction(): void {
		if (this.renderTransactionDepth === 0) return;
		this.renderTransactionDepth--;
		if (this.renderTransactionDepth > 0) return;
		const reason = this.pendingRenderReason;
		this.pendingRenderReason = null;
		if (reason) {
			this.eventBus.dispatchEvent(GridEventName.renderInvalidated, { reason });
		}
	}

	public undo(): void {
		this.commandHistory.undo();
	}
	public redo(): void {
		this.commandHistory.redo();
	}
	public fillRange(source: GridCellRange, target: GridCellRange): void {
		this.spreadsheetFill.fillRange(source, target);
	}
	public destroy(): void {
		this.cellNotifications.clear();
		this.eventBus.clear();
		this.stateManager.destroy();
		this.domainVersionListeners.clear();
		this.domainListeners.clear();
	}
}

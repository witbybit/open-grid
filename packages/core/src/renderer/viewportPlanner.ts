import type { ColumnInstanceId, CompiledGridPlan, InternalColumnDef } from '../columnDef.js';
import { computeColumnWindowDelta, computeRoutineColumnWindowDelta, type ColumnWindowDelta, type CompiledColumnTopology } from './columnTopology.js';
import { diffRenderWindow, type RenderWindow, type ViewportDelta } from './renderWindow.js';

export interface Range {
	start: number;
	end: number;
}

export interface CellAddress {
	rowIndex: number;
	columnInstanceId: ColumnInstanceId;
}

export interface ViewportPlan {
	readonly epoch: number;
	readonly frame: number;
	readonly renderWindow: RenderWindow;
	readonly viewportDelta: ViewportDelta;
	readonly columnTopology: CompiledColumnTopology;
	readonly columnWindowDelta: ColumnWindowDelta | undefined;
	readonly visibleRows: Range;
	readonly renderedRows: Range;
	readonly primitiveRows: Range;
	readonly liveRowRange: Range;
	readonly visibleCenterColumns: ColumnInstanceId[];
	readonly renderedCenterColumns: ColumnInstanceId[];
	readonly liveCenterColumnWindow: ColumnInstanceId[];
	readonly pinnedLeftColumns: ColumnInstanceId[];
	readonly pinnedRightColumns: ColumnInstanceId[];
	readonly liveCells: {
		visible: CellAddress[];
		overscan: CellAddress[];
		exited: CellAddress[];
		mountPriority: CellAddress[];
		updatePriority: CellAddress[];
	};
	readonly retainedFocusEditRowIndices: ReadonlySet<number>;
	readonly reasons: {
		verticalRangeChanged: boolean;
		horizontalRangeChanged: boolean;
		topologyChanged: boolean;
		dataChanged: boolean;
		forceRefresh: boolean;
	};
}

function makeRange(start: number, end: number): Range {
	return { start, end };
}

function expandRange(range: Range, overscan: number, maxEnd: number): Range {
	return { start: Math.max(0, range.start - overscan), end: Math.min(maxEnd, range.end + overscan) };
}

function intersectRange(a: Range, b: Range): Range {
	return { start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) };
}

function columnIdsInRange(
	placements: readonly { readonly absoluteIndex: number; readonly columnId: ColumnInstanceId }[],
	start: number,
	end: number
): ColumnInstanceId[] {
	if (start > end || placements.length === 0) return [];

	const firstAbsoluteIndex = placements[0]!.absoluteIndex;
	const from = Math.max(0, start - firstAbsoluteIndex);
	const to = Math.min(placements.length, end - firstAbsoluteIndex + 1);
	if (from >= to) return [];
	return placements.slice(from, to).map((placement) => placement.columnId);
}

interface RendererModeClassification {
	readonly compiledPlanVersion: number;
	readonly topologyVersion: number;
	readonly hasCompiledPlan: boolean;
	readonly liveColumns: ReadonlySet<ColumnInstanceId>;
}

export class ViewportPlanner<TRowData = unknown> {
	private frameCounter = 0;
	private prevWindow: RenderWindow | null = null;
	private prevTopology: CompiledColumnTopology | null = null;
	private prevRenderedCenterColumns: ColumnInstanceId[] | null = null;
	private rendererModeClassification: RendererModeClassification | null = null;

	private getRendererModeClassification(
		compiledPlan: CompiledGridPlan<TRowData> | undefined,
		topology: CompiledColumnTopology
	): RendererModeClassification {
		const compiledPlanVersion = compiledPlan?.version ?? topology.version;
		const cached = this.rendererModeClassification;
		if (
			cached &&
			cached.compiledPlanVersion === compiledPlanVersion &&
			cached.topologyVersion === topology.version &&
			cached.hasCompiledPlan === !!compiledPlan
		) {
			return cached;
		}

		const liveColumns = new Set<ColumnInstanceId>();
		for (const column of (compiledPlan?.displayedColumns ?? []) as InternalColumnDef<TRowData>[]) {
			if (column.cellRendererCapabilities?.scrollPresentation === 'live') liveColumns.add(column.instanceId);
		}

		const classification = { compiledPlanVersion, topologyVersion: topology.version, hasCompiledPlan: !!compiledPlan, liveColumns };
		this.rendererModeClassification = classification;
		return classification;
	}

	public computePlan(
		window: RenderWindow,
		topology: CompiledColumnTopology,
		retainedFocusEditRowIndices: ReadonlySet<number> = new Set(),
		compiledPlan?: CompiledGridPlan<TRowData>,
		rendererOptions?: { liveReact?: { rowOverscan?: number; columnOverscan?: number } }
	): ViewportPlan {
		const viewportDelta = diffRenderWindow(this.prevWindow, window);
		const visibleRows = makeRange(window.visibleRowStart ?? window.rowStart, window.visibleRowEnd ?? window.rowEnd);
		const renderedRows = makeRange(window.rowStart, window.rowEnd);
		const liveRowRange = intersectRange(
			expandRange(visibleRows, rendererOptions?.liveReact?.rowOverscan ?? 0, Math.max(0, window.rowCount - 1)),
			renderedRows
		);

		const visibleColStart = window.visibleColStart ?? window.colStart;
		const visibleColEnd = window.visibleColEnd ?? window.colEnd;
		const visibleCenterColumns = columnIdsInRange(topology.center, visibleColStart, visibleColEnd);
		const renderedCenterColumns = columnIdsInRange(topology.center, window.colStart, window.colEnd);
		const prevRenderedCenterColumns = this.prevRenderedCenterColumns;
		const columnWindowDelta =
			this.prevTopology && prevRenderedCenterColumns
				? this.prevTopology.version !== topology.version
					? computeColumnWindowDelta(this.prevTopology, topology)
					: computeRoutineColumnWindowDelta(prevRenderedCenterColumns, renderedCenterColumns)
				: undefined;
		const pinnedLeftColumns = topology.left.map((placement) => placement.columnId);
		const pinnedRightColumns = topology.right.map((placement) => placement.columnId);

		const liveColumnOverscan = rendererOptions?.liveReact?.columnOverscan ?? 0;
		const liveCenterColumnWindow = columnIdsInRange(
			topology.center,
			Math.max(window.colStart, visibleColStart - liveColumnOverscan),
			Math.min(window.colEnd, visibleColEnd + liveColumnOverscan)
		);
		const { liveColumns } = this.getRendererModeClassification(compiledPlan, topology);
		const executableLiveColumns = [...pinnedLeftColumns, ...liveCenterColumnWindow, ...pinnedRightColumns];
		const visibleExecutableColumns = new Set([...pinnedLeftColumns, ...visibleCenterColumns, ...pinnedRightColumns]);

		const liveVisibleCells: CellAddress[] = [];
		const liveOverscanCells: CellAddress[] = [];
		for (let rowIndex = liveRowRange.start; rowIndex <= liveRowRange.end; rowIndex++) {
			for (const columnInstanceId of executableLiveColumns) {
				if (!liveColumns.has(columnInstanceId)) continue;
				const address = { rowIndex, columnInstanceId };
				if (rowIndex >= visibleRows.start && rowIndex <= visibleRows.end && visibleExecutableColumns.has(columnInstanceId)) {
					liveVisibleCells.push(address);
				} else {
					liveOverscanCells.push(address);
				}
			}
		}

		const plan: ViewportPlan = {
			epoch: ++this.frameCounter,
			frame: this.frameCounter,
			renderWindow: window,
			viewportDelta,
			columnTopology: topology,
			columnWindowDelta,
			visibleRows,
			renderedRows,
			primitiveRows: renderedRows,
			liveRowRange,
			visibleCenterColumns,
			renderedCenterColumns,
			liveCenterColumnWindow,
			pinnedLeftColumns,
			pinnedRightColumns,
			liveCells: {
				visible: liveVisibleCells,
				overscan: liveOverscanCells,
				exited: [],
				mountPriority: [...liveVisibleCells, ...liveOverscanCells],
				updatePriority: [...liveVisibleCells, ...liveOverscanCells],
			},
			retainedFocusEditRowIndices,
			reasons: {
				verticalRangeChanged: !this.prevWindow || this.prevWindow.rowStart !== window.rowStart || this.prevWindow.rowEnd !== window.rowEnd,
				horizontalRangeChanged: !this.prevWindow || this.prevWindow.colStart !== window.colStart || this.prevWindow.colEnd !== window.colEnd,
				topologyChanged: !!columnWindowDelta?.structural,
				dataChanged:
					!this.prevWindow ||
					(this.prevWindow.rowModelVersion ?? 0) !== (window.rowModelVersion ?? 0) ||
					(this.prevWindow.geometryVersion ?? 0) !== (window.geometryVersion ?? 0),
				forceRefresh: !this.prevWindow,
			},
		};

		this.prevWindow = window;
		this.prevTopology = topology;
		this.prevRenderedCenterColumns = renderedCenterColumns;
		return plan;
	}

	public reset(): void {
		this.prevWindow = null;
		this.prevTopology = null;
		this.prevRenderedCenterColumns = null;
		this.rendererModeClassification = null;
		this.frameCounter = 0;
	}
}

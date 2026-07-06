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
	readonly snapshotPrewarmRows: Range;
	readonly visibleCenterColumns: ColumnInstanceId[];
	readonly renderedCenterColumns: ColumnInstanceId[];
	readonly liveCenterColumnWindow: ColumnInstanceId[];
	readonly snapshotPrewarmColumns: ColumnInstanceId[];
	readonly pinnedLeftColumns: ColumnInstanceId[];
	readonly pinnedRightColumns: ColumnInstanceId[];
	readonly liveRows: Set<string>;
	readonly liveCenterColumns: Set<ColumnInstanceId>;
	readonly liveCells: {
		visible: CellAddress[];
		overscan: CellAddress[];
		exited: CellAddress[];
		mountPriority: CellAddress[];
		updatePriority: CellAddress[];
	};
	readonly htmlSnapshotCells: {
		visible: CellAddress[];
		prewarm: CellAddress[];
		pending: CellAddress[];
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

export class ViewportPlanner<TRowData = unknown> {
	private frameCounter = 0;
	private prevWindow: RenderWindow | null = null;
	private prevTopology: CompiledColumnTopology | null = null;

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
		const liveRowRange = expandRange(visibleRows, rendererOptions?.liveReact?.rowOverscan ?? 0, Math.max(0, window.rowCount - 1));

		const visibleCenterColumns = topology.center
			.filter(
				(placement) =>
					placement.absoluteIndex >= (window.visibleColStart ?? window.colStart) &&
					placement.absoluteIndex <= (window.visibleColEnd ?? window.colEnd)
			)
			.map((placement) => placement.columnId);
		const renderedCenterColumns = topology.center
			.filter((placement) => placement.absoluteIndex >= window.colStart && placement.absoluteIndex <= window.colEnd)
			.map((placement) => placement.columnId);
		const prevRenderedCenterColumns =
			this.prevTopology && this.prevWindow
				? this.prevTopology.center
						.filter(
							(placement) => placement.absoluteIndex >= this.prevWindow!.colStart && placement.absoluteIndex <= this.prevWindow!.colEnd
						)
						.map((placement) => placement.columnId)
				: null;
		const columnWindowDelta =
			this.prevTopology && prevRenderedCenterColumns
				? this.prevTopology.version !== topology.version
					? computeColumnWindowDelta(this.prevTopology, topology)
					: computeRoutineColumnWindowDelta(prevRenderedCenterColumns, renderedCenterColumns)
				: undefined;
		const pinnedLeftColumns = topology.left.map((placement) => placement.columnId);
		const pinnedRightColumns = topology.right.map((placement) => placement.columnId);

		const centerIds = topology.center.map((placement) => placement.columnId);
		const visibleStart = Math.max(0, (window.visibleColStart ?? window.colStart) - window.pinLeftCols);
		const visibleEnd = Math.max(visibleStart, (window.visibleColEnd ?? window.colEnd) - window.pinLeftCols);
		const liveCenterColumnWindow = centerIds.slice(
			Math.max(0, visibleStart - (rendererOptions?.liveReact?.columnOverscan ?? 0)),
			Math.min(centerIds.length, visibleEnd + (rendererOptions?.liveReact?.columnOverscan ?? 0) + 1)
		);

		const liveColumns = new Set<ColumnInstanceId>();
		const snapshotColumns: ColumnInstanceId[] = [];
		for (const column of (compiledPlan?.displayedColumns ?? []) as InternalColumnDef<TRowData>[]) {
			const mode = column.cellRendererCapabilities?.scrollPresentation;
			if (mode === 'live') liveColumns.add(column.instanceId);
			if (mode === 'html-snapshot') snapshotColumns.push(column.instanceId);
		}

		const liveVisibleCells: CellAddress[] = [];
		const liveOverscanCells: CellAddress[] = [];
		for (let rowIndex = liveRowRange.start; rowIndex <= liveRowRange.end; rowIndex++) {
			for (const columnInstanceId of [...pinnedLeftColumns, ...liveCenterColumnWindow, ...pinnedRightColumns]) {
				if (!liveColumns.has(columnInstanceId)) continue;
				const address = { rowIndex, columnInstanceId };
				if (rowIndex >= visibleRows.start && rowIndex <= visibleRows.end && visibleCenterColumns.includes(columnInstanceId)) {
					liveVisibleCells.push(address);
				} else {
					liveOverscanCells.push(address);
				}
			}
		}

		const snapshotVisibleCells: CellAddress[] = [];
		const snapshotPrewarmCells: CellAddress[] = [];
		for (let rowIndex = renderedRows.start; rowIndex <= renderedRows.end; rowIndex++) {
			for (const columnInstanceId of snapshotColumns) {
				const address = { rowIndex, columnInstanceId };
				if (rowIndex >= visibleRows.start && rowIndex <= visibleRows.end) snapshotVisibleCells.push(address);
				else snapshotPrewarmCells.push(address);
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
			snapshotPrewarmRows: renderedRows,
			visibleCenterColumns,
			renderedCenterColumns,
			liveCenterColumnWindow,
			snapshotPrewarmColumns: snapshotColumns,
			pinnedLeftColumns,
			pinnedRightColumns,
			liveRows: new Set(),
			liveCenterColumns: new Set(),
			liveCells: {
				visible: liveVisibleCells,
				overscan: liveOverscanCells,
				exited: [],
				mountPriority: [...liveVisibleCells, ...liveOverscanCells],
				updatePriority: [...liveVisibleCells, ...liveOverscanCells],
			},
			htmlSnapshotCells: {
				visible: snapshotVisibleCells,
				prewarm: snapshotPrewarmCells,
				pending: [],
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
		return plan;
	}

	public reset(): void {
		this.prevWindow = null;
		this.prevTopology = null;
		this.frameCounter = 0;
	}
}

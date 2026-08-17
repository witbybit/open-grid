import type {
	ActiveEditState,
	CanonicalGridCellPointer,
	CellSubscription,
	GridSnapshotKeyListener,
	GridSnapshotListener,
	GridSnapshotSelector,
	GridSnapshotSelectorEquality,
	GridStateSnapshot,
} from '../api/GridApi.js';
import type { ViewportRange } from '../viewportController.js';
import type { InternalGridState } from '../state/GridState.js';
import type { VisualRow } from '../visualRow.js';
import type { ColumnDef } from '../columnDef.js';
import type { SortModel } from '../rowModel.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import { areCanonicalCellPointersEqual } from '../interaction/cellPointer.js';
import { readInteractionState } from '../interaction/interactionState.js';

export interface GridStoreSubscriptionsFacade<TRowData = unknown> {
	subscribe(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToKey<K extends keyof GridStateSnapshot<TRowData>>(key: K, listener: GridSnapshotKeyListener<TRowData, K>): () => void;
	subscribeToSnapshotSelector<K extends keyof GridStateSnapshot<TRowData>, TValue>(
		keys: readonly K[],
		selector: GridSnapshotSelector<TRowData, TValue>,
		listener: (value: TValue) => void,
		isEqual?: GridSnapshotSelectorEquality<TValue>
	): () => void;
	subscribeToIntegrity(listener: (integrity: InternalGridState<TRowData>['integrity']) => void): () => void;
	subscribeToViewport(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToSelection(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToFocusedCell(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToEditingCell(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToCell(rowId: string, colField: string, listener: () => void): () => void;
	subscribeToRow(rowId: string, listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToColumn(colField: string, listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToHeaders(listener: GridSnapshotListener<TRowData>): () => void;
}

export interface GridStoreSubscriptionsDeps<TRowData = unknown> {
	subscribe(listener: () => void): () => void;
	subscribeToKey(key: string, listener: () => void): () => void;
	subscribeToSelector<TValue>(
		keys: readonly string[],
		selector: (state: InternalGridState<TRowData>) => TValue,
		listener: (value: TValue) => void,
		isEqual?: (left: TValue, right: TValue) => boolean
	): () => void;
	subscribeDomain(domain: keyof GridDomainVersions, listener: (version: number) => void): () => void;
	getState(): InternalGridState<TRowData>;
	getStateSnapshot(): GridStateSnapshot<TRowData>;
	getVisualIndexByRowId(rowId: string): number | null;
	getVisualRow(index: number): VisualRow<TRowData> | null;
	registerCellSubscription(sub: CellSubscription): void;
	unregisterCellSubscription(sub: CellSubscription): void;
	subscribeToRowChanges(rowId: string, listener: () => void): () => void;
	rowVersions: ReadonlyMap<string, number>;
}

export function createGridStoreSubscriptions<TRowData>(deps: GridStoreSubscriptionsDeps<TRowData>): GridStoreSubscriptionsFacade<TRowData> {
	const subscribeSnapshotProjection = <TValue>(
		keys: readonly string[],
		selector: (state: InternalGridState<TRowData>) => TValue,
		listener: GridSnapshotListener<TRowData>,
		isEqual: (left: TValue, right: TValue) => boolean = Object.is
	): (() => void) => deps.subscribeToSelector(keys, selector, () => listener(deps.getStateSnapshot()), isEqual);

	const getRowSubscriptionProjection = (rowId: string) => {
		const rowIndex = deps.getVisualIndexByRowId(rowId);
		const visualRow = rowIndex === null ? null : deps.getVisualRow(rowIndex);
		const visualRowId = visualRow?.id ?? null;
		const state = deps.getState();
		return {
			rowVersion: deps.rowVersions.get(rowId) ?? 0,
			rowIndex,
			visualRowId,
			height: visualRowId ? (state.rowHeights[visualRowId] ?? visualRow?.height ?? state.defaultRowHeight) : null,
		};
	};

	const getColumnSubscriptionProjection = (state: InternalGridState<TRowData>, colField: string) => {
		const column = state.columns.find((candidate) => candidate.field === colField) ?? null;
		return {
			column,
			width: state.columnWidths[colField] ?? column?.width ?? state.defaultColWidth,
			sortEntry: state.sortModel?.find((entry) => entry.colId === colField) ?? null,
		};
	};

	const subscribeDomainProjection = <TValue>(
		domains: readonly (keyof GridDomainVersions)[],
		selector: () => TValue,
		listener: GridSnapshotListener<TRowData>,
		isEqual: (left: TValue, right: TValue) => boolean = Object.is
	): (() => void) => {
		let current = selector();
		const notifyIfChanged = () => {
			const next = selector();
			if (isEqual(current, next)) return;
			current = next;
			listener(deps.getStateSnapshot());
		};
		const unsubscribers = domains.map((domain) => deps.subscribeDomain(domain, notifyIfChanged));
		return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
	};

	return {
		subscribe: (listener) => deps.subscribe(() => listener(deps.getStateSnapshot())),
		subscribeToKey: (key, listener) => deps.subscribeToKey(key as string, () => listener(deps.getStateSnapshot()[key])),
		subscribeToSnapshotSelector: (keys, selector, listener, isEqual = Object.is) =>
			deps.subscribeToSelector(keys as readonly string[], () => selector(deps.getStateSnapshot()), listener, isEqual),
		subscribeToIntegrity: (listener) => deps.subscribeToSelector(['integrity'], (state) => state.integrity, listener),
		subscribeToViewport: (listener) =>
			subscribeSnapshotProjection(['visibleRowRange'], (state) => state.visibleRowRange, listener, areViewportRangesEqual),
		subscribeToSelection: (listener) => subscribeSnapshotProjection(['selection'], (state) => state.selection, listener),
		subscribeToFocusedCell: (listener) =>
			subscribeSnapshotProjection(
				['selection', 'interaction'],
				(state) => readInteractionState(state).focus.cell,
				listener,
				areFocusedCellsEqual
			),
		subscribeToEditingCell: (listener) =>
			subscribeSnapshotProjection(
				['activeEdit', 'interaction'],
				(state) => readInteractionState(state).activeEdit.active,
				listener,
				areActiveEditsEqual
			),
		subscribeToCell: (rowId, colField, listener) => {
			const sub: CellSubscription = { rowId, colField, onStoreChange: listener };
			deps.registerCellSubscription(sub);
			return () => deps.unregisterCellSubscription(sub);
		},
		subscribeToRow: (rowId, listener) => {
			const getProjection = () => getRowSubscriptionProjection(rowId);
			let current = getProjection();
			const notifyIfChanged = () => {
				const next = getProjection();
				if (areRowSubscriptionProjectionsEqual(current, next)) return;
				current = next;
				listener(deps.getStateSnapshot());
			};
			const unsubscribeRowChanges = deps.subscribeToRowChanges(rowId, notifyIfChanged);
			const unsubscribeDomains = (['rows', 'geometry'] as const).map((domain) => deps.subscribeDomain(domain, notifyIfChanged));
			return () => {
				unsubscribeRowChanges();
				unsubscribeDomains.forEach((unsubscribe) => unsubscribe());
			};
		},
		subscribeToColumn: (colField, listener) =>
			subscribeDomainProjection(
				['columns', 'sorting'],
				() => getColumnSubscriptionProjection(deps.getState(), colField),
				listener,
				areColumnSubscriptionProjectionsEqual
			),
		subscribeToHeaders: (listener) =>
			subscribeDomainProjection(
				['columns', 'sorting'],
				() => {
					const state = deps.getState();
					return { columns: state.columns, columnWidths: state.columnWidths, sortModel: state.sortModel };
				},
				listener,
				areHeaderSubscriptionProjectionsEqual
			),
	};
}

function areViewportRangesEqual(left: ViewportRange, right: ViewportRange): boolean {
	return left.startIdx === right.startIdx && left.endIdx === right.endIdx;
}

function areFocusedCellsEqual(left: CanonicalGridCellPointer | null, right: CanonicalGridCellPointer | null): boolean {
	return areCanonicalCellPointersEqual(left, right);
}

function areActiveEditsEqual(left: ActiveEditState | null, right: ActiveEditState | null): boolean {
	return (
		areCanonicalCellPointersEqual(left, right) &&
		(left?.validationError ?? null) === (right?.validationError ?? null) &&
		Object.is(left?.draftValue, right?.draftValue) &&
		Object.is(left?.originalValue, right?.originalValue) &&
		(left?.startedBy ?? null) === (right?.startedBy ?? null) &&
		(left?.version ?? null) === (right?.version ?? null)
	);
}

function areRowSubscriptionProjectionsEqual(
	left: { rowVersion: number; rowIndex: number | null; visualRowId: string | null; height: number | null },
	right: { rowVersion: number; rowIndex: number | null; visualRowId: string | null; height: number | null }
): boolean {
	return (
		left.rowVersion === right.rowVersion &&
		left.rowIndex === right.rowIndex &&
		left.visualRowId === right.visualRowId &&
		left.height === right.height
	);
}

function areColumnSubscriptionProjectionsEqual(
	left: { column: ColumnDef<any> | null; width: number; sortEntry: SortModel[number] | null },
	right: { column: ColumnDef<any> | null; width: number; sortEntry: SortModel[number] | null }
): boolean {
	return left.column === right.column && left.width === right.width && left.sortEntry === right.sortEntry;
}

function areHeaderSubscriptionProjectionsEqual(
	left: { columns: readonly ColumnDef<any>[]; columnWidths: Record<string, number>; sortModel: SortModel | null },
	right: { columns: readonly ColumnDef<any>[]; columnWidths: Record<string, number>; sortModel: SortModel | null }
): boolean {
	return left.columns === right.columns && left.columnWidths === right.columnWidths && left.sortModel === right.sortModel;
}

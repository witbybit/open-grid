import { GridEventName, type ColumnDef, type ColumnState } from '../store.js';
import type { GridFeatureContext } from './GridFeatureContext.js';

export class ColumnFeatureController<TRowData = unknown> {
	constructor(private readonly ctx: GridFeatureContext<TRowData>) {}

	private applyColumnOrder(columns: ColumnDef<TRowData>[]): void {
		const prevFields = this.ctx.getState().columns.map((column) => column.field);
		const nextFields = columns.map((column) => column.field);
		if (prevFields.length === nextFields.length && prevFields.every((field, index) => field === nextFields[index])) {
			return;
		}
		this.ctx.applyChange({
			reason: 'columns:order',
			state: { columns },
			invalidations: [{ kind: 'full' }],
			events: [{ type: GridEventName.columnOrderChanged, payload: { columns, columnFields: nextFields } as never }],
		});
	}

	private moveColumnInList(columns: ColumnDef<TRowData>[], fromIndex: number, toIndex: number): ColumnDef<TRowData>[] {
		const nextColumns = [...columns];
		const [column] = nextColumns.splice(fromIndex, 1);
		nextColumns.splice(toIndex, 0, column);
		return nextColumns;
	}

	public resizeColumn(colField: string, width: number, undoable = true): void {
		const state = this.ctx.getState();
		const oldWidth = state.columnWidths[colField] ?? state.defaultColWidth;
		if (oldWidth === width) return;

		this.ctx.applyChange({
			reason: 'columns:resize',
			state: (currState) => ({ columnWidths: { ...currState.columnWidths, [colField]: width } }),
			invalidations: [{ kind: 'geometry' }, { kind: 'column', colId: colField }, { kind: 'headers' }],
			events: [{ type: GridEventName.columnResized, payload: { colField, width } as never }],
			...(undoable
				? {
						undo: {
							reason: 'columns:resize',
							state: (currState) => ({ columnWidths: { ...currState.columnWidths, [colField]: oldWidth } }),
							invalidations: [{ kind: 'geometry' }, { kind: 'column', colId: colField }, { kind: 'headers' }],
							events: [{ type: GridEventName.columnResized, payload: { colField, width: oldWidth } as never }],
						},
						redo: {
							reason: 'columns:resize',
							state: (currState) => ({ columnWidths: { ...currState.columnWidths, [colField]: width } }),
							invalidations: [{ kind: 'geometry' }, { kind: 'column', colId: colField }, { kind: 'headers' }],
							events: [{ type: GridEventName.columnResized, payload: { colField, width } as never }],
						},
					}
				: {}),
		});
	}

	public moveColumn(colField: string, toIndex: number): void {
		const state = this.ctx.getState();
		const displayedColumns = this.ctx.columns.getDisplayedColumns();
		const fromIndex = displayedColumns.findIndex((column) => column.field === colField);
		if (fromIndex === -1 || !Number.isFinite(toIndex)) return;

		const boundedToIndex = Math.max(0, Math.min(displayedColumns.length - 1, Math.trunc(toIndex)));
		if (fromIndex === boundedToIndex) return;

		const nextDisplayed = this.moveColumnInList(displayedColumns, fromIndex, boundedToIndex);
		const hiddenColumns = state.columns.filter((column) => column.hide === true);
		this.applyColumnOrder([...nextDisplayed, ...hiddenColumns]);
	}

	public setColumnOrderByFields(colFields: string[]): void {
		const state = this.ctx.getState();
		const orderedFieldSet = new Set<string>();
		const orderedFields = colFields.filter((field) => {
			if (orderedFieldSet.has(field)) return false;
			orderedFieldSet.add(field);
			return true;
		});
		const columnByField = new Map(state.columns.map((column) => [column.field, column]));
		const nextColumns = orderedFields.map((field) => columnByField.get(field)).filter((column): column is ColumnDef<TRowData> => !!column);

		for (const column of state.columns) {
			if (!orderedFieldSet.has(column.field)) {
				nextColumns.push(column);
			}
		}

		this.applyColumnOrder(nextColumns);
	}

	public setColumnReorderEnabled(enabled: boolean): void {
		this.ctx.applyChange({
			reason: 'columns:reorder-toggle',
			state: { enableColumnReorder: enabled },
			invalidations: [{ kind: 'headers' }],
			events: [{ type: GridEventName.columnReorderToggled, payload: { enabled } as never }],
		});
	}

	public setColumns(columns: ColumnDef<TRowData>[], undoable = false): void {
		const state = this.ctx.getState();
		const prevColumns = state.columns;
		const prevWidths = state.columnWidths;

		const nextWidths = columns.reduce<Record<string, number>>((acc, column) => {
			const existingWidth = prevWidths[column.field];
			if (existingWidth !== undefined) {
				acc[column.field] = existingWidth;
			} else if (column.width !== undefined) {
				acc[column.field] = column.width;
			}
			return acc;
		}, {});

		this.ctx.applyChange({
			reason: 'columns:set',
			state: { columns, columnWidths: nextWidths },
			invalidations: [{ kind: 'full' }],
			events: [{ type: GridEventName.columnsChanged, payload: { columns, columnFields: columns.map((c) => c.field) } as never }],
			...(undoable
				? {
						undo: {
							reason: 'columns:set',
							state: { columns: prevColumns, columnWidths: prevWidths },
							invalidations: [{ kind: 'full' }],
							requestRender: true,
						},
						redo: {
							reason: 'columns:set',
							state: { columns, columnWidths: nextWidths },
							invalidations: [{ kind: 'full' }],
							requestRender: true,
						},
					}
				: {}),
		});
	}

	public getColumnState(): ColumnState[] {
		const state = this.ctx.getState();
		return state.columns.map((col) => {
			const cs: ColumnState = { field: col.field };
			const width = state.columnWidths[col.field];
			if (width !== undefined) cs.width = width;
			if (col.hide) cs.hide = true;
			return cs;
		});
	}

	public applyColumnState(states: ColumnState[]): void {
		for (const cs of states) {
			if (cs.width !== undefined) this.resizeColumn(cs.field, cs.width, false);
			if (cs.hide !== undefined) {
				const columns = this.ctx.getState().columns;
				const column = columns.find((candidate) => candidate.field === cs.field);
				if (column && column.hide !== cs.hide) {
					this.setColumns(
						columns.map((candidate) => (candidate.field === cs.field ? { ...candidate, hide: cs.hide } : candidate)),
						false
					);
				}
			}
		}
	}
}

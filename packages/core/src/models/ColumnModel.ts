import type { ColumnDef } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { IndexMapper } from './IndexMapper.js';

export class ColumnModel<TRowData = unknown> {
	private engine!: GridEngine<TRowData>;
	private columnMap = new Map<string, ColumnDef<TRowData>>();
	private indexMapper = new IndexMapper<string>();
	private defaultColWidth = 100;

	public init(engine: GridEngine<TRowData>): void {
		this.engine = engine;
	}

	public updateColumns(columns: ColumnDef<TRowData>[], columnWidths: Record<string, number>, defaultColWidth?: number): void {
		if (defaultColWidth !== undefined) {
			this.defaultColWidth = defaultColWidth;
		}
		this.columnMap.clear();
		this.indexMapper.setIds(columns.map((column) => column.field));

		const widths: number[] = [];

		for (let i = 0; i < columns.length; i++) {
			const col = columns[i];
			if (col.field) {
				this.columnMap.set(col.field, col);

				const customWidth = columnWidths[col.field] ?? col.width;
				widths.push(customWidth !== undefined ? customWidth : this.defaultColWidth);
			} else {
				widths.push(this.defaultColWidth);
			}
		}

		this.engine.geometry.updateColumns(widths, this.defaultColWidth);
		this.engine.data.updateCompiledGetters(columns);
	}

	public getColumnIndex(colField: string): number {
		return this.indexMapper.idToVisualIndex(colField);
	}

	public getColumnField(colIdx: number): string | null {
		return this.indexMapper.visualIndexToId(colIdx);
	}

	public getPhysicalColumnIndex(colField: string): number {
		return this.indexMapper.idToPhysicalIndex(colField);
	}

	public getIndexMapper(): IndexMapper<string> {
		return this.indexMapper;
	}

	public getColumnDef(colField: string): ColumnDef<TRowData> | undefined {
		return this.columnMap.get(colField);
	}

	public getColLeft(colIdx: number): number {
		return this.engine.geometry.getColLeft(colIdx, this.defaultColWidth);
	}

	public getColWidth(colIdx: number): number {
		return this.engine.geometry.getColWidth(colIdx, this.defaultColWidth);
	}

	public getTotalWidth(): number {
		return this.engine.geometry.getTotalWidth(this.defaultColWidth);
	}
}

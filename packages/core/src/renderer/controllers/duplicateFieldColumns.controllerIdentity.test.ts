import { describe, expect, it } from 'vitest';
import { GridStore, type ColumnDef } from '../../store.js';
import { createCellDisplaySnapshot, CellDisplaySnapshotStore } from '../cellDisplaySnapshot.js';
import { HtmlScrollSnapshotStore } from '../htmlScrollSnapshotStore.js';
import { createCellInstanceRendererKey } from '../identityKeys.js';
import { getOrCreateCellCtrl } from './RowCtrl.js';

interface PriceRow {
	id: string;
	price: number;
}

function freshness() {
	return { rowVersion: 1, globalVersion: 1, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0 };
}

describe('duplicate field columns - controller identity', () => {
	it('keeps CellCtrl, renderer, HTML, and display snapshot identity split by columnInstanceId', () => {
		const RawRenderer = () => null;
		const BadgeRenderer = () => null;
		const TextRenderer = () => null;
		const columns: ColumnDef<PriceRow>[] = [
			{
				field: 'price',
				colId: 'priceRaw',
				header: 'Raw',
				renderer: { kind: 'react', component: RawRenderer, capabilities: { scrollPresentation: 'live' } },
			},
			{
				field: 'price',
				colId: 'priceBadge',
				header: 'Badge',
				renderer: { kind: 'react', component: BadgeRenderer, capabilities: { scrollPresentation: 'html-snapshot' } },
			},
			{
				field: 'price',
				colId: 'priceText',
				header: 'Text',
				renderer: {
					kind: 'react',
					component: TextRenderer,
					capabilities: { scrollPresentation: 'text-impostor', textImpostor: { render: ({ formattedValue }) => formattedValue } },
				},
			},
		];
		const store = new GridStore<PriceRow>({ columns, getRowId: (row) => row.id });
		const instanceIds = store.engine.columns.getColumnInstanceIdsByField('price');
		expect(instanceIds).toHaveLength(3);
		expect(new Set(instanceIds).size).toBe(3);

		const rowCtrl = store.engine.rowCtrls.getOrCreate('row-1');
		expect('cells' in rowCtrl).toBe(false);
		const cellCtrls = instanceIds.map((columnInstanceId, colIndex) => {
			const col = store.engine.columns.getColumnByInstanceId(columnInstanceId)!;
			return getOrCreateCellCtrl(rowCtrl, store.engine.rowCtrls.cellCtrls, columnInstanceId, {
				rowIndex: 0,
				rowCtrlKey: rowCtrl.rowId,
				colId: col.colId,
				colField: col.field,
				colIndex,
				scrollPresentation: col.cellRendererCapabilities?.scrollPresentation,
			}).cellCtrl;
		});

		expect(new Set(cellCtrls.map((cellCtrl) => cellCtrl.key)).size).toBe(3);
		expect(new Set(cellCtrls).size).toBe(3);
		for (const cellCtrl of cellCtrls) {
			expect(cellCtrl.field).toBe('price');
			expect(rowCtrl.cellKeysByColumnInstanceId.get(cellCtrl.columnInstanceId)).toBe(cellCtrl.key);
			expect(store.engine.rowCtrls.cellCtrls.getByRowAndColumn('row-1', cellCtrl.columnInstanceId)).toBe(cellCtrl);
		}

		const rendererKeys = instanceIds.map((instanceId) => createCellInstanceRendererKey('slot-1', instanceId));
		expect(new Set(rendererKeys).size).toBe(3);

		const htmlSnapshots = new HtmlScrollSnapshotStore();
		instanceIds.forEach((columnInstanceId, index) => {
			htmlSnapshots.set({
				rowId: 'row-1',
				columnInstanceId,
				colField: 'price',
				html: `<span>${index}</span>`,
				freshness: freshness(),
				rowHeight: 40,
				colWidth: 100,
				estimatedBytes: 14,
				capturedAtEpoch: index + 1,
				lastUsedEpoch: index + 1,
			});
		});
		expect(htmlSnapshots.get('row-1', instanceIds[0]!, freshness())?.html).toBe('<span>0</span>');
		expect(htmlSnapshots.get('row-1', instanceIds[1]!, freshness())?.html).toBe('<span>1</span>');
		expect(htmlSnapshots.get('row-1', instanceIds[2]!, freshness())?.html).toBe('<span>2</span>');

		const displaySnapshots = new CellDisplaySnapshotStore();
		instanceIds.forEach((columnInstanceId, index) => {
			displaySnapshots.set(
				createCellDisplaySnapshot({
					rowId: 'row-1',
					columnInstanceId,
					colField: 'price',
					baseClassName: 'og-cell',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: String(index),
					title: String(index),
					...freshness(),
				})
			);
		});
		expect(displaySnapshots.get('row-1', instanceIds[0]!)?.formattedValue).toBe('0');
		expect(displaySnapshots.get('row-1', instanceIds[1]!)?.formattedValue).toBe('1');
		expect(displaySnapshots.get('row-1', instanceIds[2]!)?.formattedValue).toBe('2');

		store.destroy();
	});
});

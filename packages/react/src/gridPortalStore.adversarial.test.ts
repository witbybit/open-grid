import { describe, expect, it, vi } from 'vitest';
import { RowNode, type ColumnDef, type VisualRow } from '@open-grid/core';
import { createPortalStore } from './gridPortalStore.js';

interface TestRow {
	id: string;
	name: string;
}

function makeLcg(seed: number): () => number {
	let s = seed >>> 0;
	return (): number => {
		s = Math.imul(1664525, s) + 1013904223;
		s = s >>> 0;
		return s / 0x100000000;
	};
}

function lcgInt(rng: () => number, max: number): number {
	return Math.floor(rng() * max);
}

function flushMicrotasks(): Promise<void> {
	return Promise.resolve().then(() => undefined);
}

const COLUMN: ColumnDef<TestRow> = { field: 'name', header: 'Name' };

function makeNode(id: string, name = id): RowNode<TestRow> {
	return new RowNode<TestRow>(id, { id, name });
}

function makeDetailRow(rowKey: string): VisualRow<TestRow> {
	return {
		kind: 'detail',
		id: rowKey,
		parentId: rowKey.replace('detail:', ''),
		depth: 0,
		height: 40,
		render: null,
	};
}

describe('createPortalStore — adversarial lifecycle invariants', () => {
	it('rejects stale imperative updates after slot generation rebinding', () => {
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');
		const nodeA = makeNode('row-a', 'Old');
		const nodeB = makeNode('row-b', 'New');
		const updater = vi.fn(() => true);

		store.mountCell('slot-0:name', container, 'Old', nodeA, COLUMN, false, false, undefined, undefined, undefined, undefined, {
			rowSlotId: 'slot-0',
			slotGeneration: 1,
		});
		store.registerImperativeUpdater?.('slot-0:name', updater);

		expect(
			store.tryImperativeUpdate?.('slot-0:name', 'Old+', nodeA, COLUMN, false, false, undefined, undefined, undefined, undefined, {
				rowSlotId: 'slot-0',
				slotGeneration: 1,
			})
		).toBe(true);
		expect(updater).toHaveBeenCalledTimes(1);

		store.mountCell('slot-0:name', container, 'New', nodeB, COLUMN, false, false, undefined, undefined, undefined, undefined, {
			rowSlotId: 'slot-0',
			slotGeneration: 2,
		});

		expect(
			store.tryImperativeUpdate?.('slot-0:name', 'STALE', nodeA, COLUMN, false, false, undefined, undefined, undefined, undefined, {
				rowSlotId: 'slot-0',
				slotGeneration: 1,
			})
		).toBe(false);
		expect(updater).toHaveBeenCalledTimes(1);
		expect(store.getCellData?.('slot-0:name')?.value).toBe('New');
		expect(store.getCellData?.('slot-0:name')?.physicalIdentity).toEqual({ rowSlotId: 'slot-0', slotGeneration: 2 });
	});

	it('rejects stale imperative updates when slot id mismatches even if generation matches', () => {
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');
		const updater = vi.fn(() => true);

		store.mountCell(
			'slot-0:name',
			container,
			'Current',
			makeNode('row-a', 'Current'),
			COLUMN,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				rowSlotId: 'slot-0',
				slotGeneration: 7,
			}
		);
		store.registerImperativeUpdater?.('slot-0:name', updater);

		expect(
			store.tryImperativeUpdate?.(
				'slot-0:name',
				'STALE-WRONG-SLOT',
				makeNode('row-a', 'Current'),
				COLUMN,
				false,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				{ rowSlotId: 'slot-1', slotGeneration: 7 }
			)
		).toBe(false);
		expect(updater).not.toHaveBeenCalled();
	});

	it('ignores stale unmounts when physical identity mismatches the current owner', () => {
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');

		store.mountCell(
			'slot-0:name',
			container,
			'Current',
			makeNode('row-a', 'Current'),
			COLUMN,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				rowSlotId: 'slot-0',
				slotGeneration: 2,
			}
		);

		store.unmountCell('slot-0:name', container, false, {
			rowSlotId: 'slot-0',
			slotGeneration: 1,
		});
		expect(store.getCellData?.('slot-0:name')?.value).toBe('Current');

		store.unmountCell('slot-0:name', container, false, {
			rowSlotId: 'slot-1',
			slotGeneration: 2,
		});
		expect(store.getCellData?.('slot-0:name')?.value).toBe('Current');
	});

	it('recycled containers retain only the latest cell and row owners under seeded churn', async () => {
		const rng = makeLcg(0x1080cafe);
		const store = createPortalStore<TestRow>();
		const cellContainers = [document.createElement('div'), document.createElement('div')];
		const rowContainers = [document.createElement('div'), document.createElement('div')];
		const activeCellByContainer = new Map<HTMLElement, string>();
		const activeRowByContainer = new Map<HTMLElement, string>();
		let nextCellId = 1;
		let nextRowId = 1;

		for (let step = 0; step < 80; step++) {
			const op = lcgInt(rng, 4);
			if (op === 0) {
				const container = cellContainers[lcgInt(rng, cellContainers.length)];
				const cellKey = `row-${nextCellId}:name`;
				const generation = nextCellId;
				nextCellId++;
				store.mountCell(
					cellKey,
					container,
					`value-${cellKey}`,
					makeNode(cellKey, `value-${cellKey}`),
					COLUMN,
					false,
					false,
					undefined,
					undefined,
					undefined,
					undefined,
					{ rowSlotId: `slot-${container === cellContainers[0] ? 0 : 1}`, slotGeneration: generation }
				);
				activeCellByContainer.set(container, cellKey);
			} else if (op === 1) {
				const container = cellContainers[lcgInt(rng, cellContainers.length)];
				const active = activeCellByContainer.get(container);
				if (active) {
					store.unmountCell(active, container);
					activeCellByContainer.delete(container);
				}
			} else if (op === 2) {
				const container = rowContainers[lcgInt(rng, rowContainers.length)];
				const rowKey = `detail:${nextRowId++}`;
				container.dataset.rowKey = rowKey;
				store.mountRow(rowKey, container, makeDetailRow(rowKey));
				activeRowByContainer.set(container, rowKey);
			} else {
				const container = rowContainers[lcgInt(rng, rowContainers.length)];
				const active = activeRowByContainer.get(container);
				if (active) {
					store.unmountRow(active, container);
					delete container.dataset.rowKey;
					activeRowByContainer.delete(container);
				}
			}
		}

		await flushMicrotasks();

		const cellSnapshotKeys = store.getCellSnapshot().cellPortalList.map((portal) => portal.cellKey);
		expect(new Set(cellSnapshotKeys)).toEqual(new Set(activeCellByContainer.values()));
		expect(cellSnapshotKeys).toHaveLength(activeCellByContainer.size);

		for (const [container, expectedCellKey] of activeCellByContainer) {
			expect(store.getCellSnapshot().cellPortalList.find((portal) => portal.container === container)?.cellKey).toBe(expectedCellKey);
		}

		const rowSnapshotKeys = store.getRowMenuSnapshot().rowPortalList.map((portal) => portal.rowKey);
		expect(new Set(rowSnapshotKeys)).toEqual(new Set(activeRowByContainer.values()));
		expect(rowSnapshotKeys).toHaveLength(activeRowByContainer.size);

		for (const [container, expectedRowKey] of activeRowByContainer) {
			expect(store.getRowMenuSnapshot().rowPortalList.find((portal) => portal.container === container)?.rowKey).toBe(expectedRowKey);
		}
	});
});

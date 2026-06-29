import { describe, expect, it } from 'vitest';
import { CellDisplaySnapshotStore } from './cellDisplaySnapshot.js';

describe('CellDisplaySnapshotStore', () => {
	it('stores snapshots by logical cell identity', () => {
		const store = new CellDisplaySnapshotStore();
		store.set({
			rowId: 'r1',
			colField: 'name',
			rowVersion: 2,
			globalVersion: 5,
			className: 'og-cell highlight',
			contentMode: 'text',
			formattedValue: 'Alice',
			title: 'User name',
			validationError: 'Required',
		});

		expect(store.get('r1', 'name')).toMatchObject({
			formattedValue: 'Alice',
			className: 'og-cell highlight',
			validationError: 'Required',
		});
	});

	it('replaces existing snapshots for the same logical cell', () => {
		const store = new CellDisplaySnapshotStore();
		store.set({
			rowId: 'r1',
			colField: 'name',
			rowVersion: 1,
			globalVersion: 1,
			className: 'og-cell',
			contentMode: 'text',
			formattedValue: 'Alice',
			title: '',
		});
		store.set({
			rowId: 'r1',
			colField: 'name',
			rowVersion: 2,
			globalVersion: 3,
			className: 'og-cell fresh',
			contentMode: 'text',
			formattedValue: 'Alicia',
			title: 'Updated',
		});

		expect(store.get('r1', 'name')).toMatchObject({
			rowVersion: 2,
			globalVersion: 3,
			formattedValue: 'Alicia',
			className: 'og-cell fresh',
		});
	});
});

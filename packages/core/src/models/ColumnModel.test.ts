import { describe, expect, it } from 'vitest';
import { ColumnModel } from './ColumnModel.js';
import { GeometryModel } from './GeometryModel.js';
import type { ColumnModelRuntime } from '../engine/runtimePorts.js';
import type { ColumnDef } from '../columnDef.js';

/**
 * Phase 2 identity-stability tests: ColumnModel must assign a stable ColumnInstanceId across
 * re-normalization of an equivalent column, and mint a fresh one when a field is semantically
 * replaced (different renderer/valueGetter) or removed and later re-added.
 */

function makeRuntime<TRowData = unknown>(): ColumnModelRuntime<TRowData> {
	return {
		geometry: new GeometryModel(),
		updateCompiledGetters: () => {},
		getPinnedColumnCounts: () => ({ left: 0, right: 0 }),
		getGeometryVersion: () => 1,
	};
}

function instanceIdOf<TRowData>(model: ColumnModel<TRowData>, field: string): string | undefined {
	return (model.getColumnDef(field) as { instanceId?: string } | undefined)?.instanceId;
}

describe('ColumnModel — column instance identity', () => {
	it('same field, same shape (no renderer) — instanceId is stable across updateColumns calls', () => {
		const model = new ColumnModel(makeRuntime());
		const columns: ColumnDef<unknown>[] = [{ field: 'a', header: 'A' }];
		model.updateColumns(columns, {});
		const first = instanceIdOf(model, 'a');
		expect(first).toBeTruthy();

		model.updateColumns([{ field: 'a', header: 'A (renamed header)' }], {});
		const second = instanceIdOf(model, 'a');
		expect(second).toBe(first);
	});

	it('same field, same renderer reference — instanceId is stable', () => {
		const model = new ColumnModel(makeRuntime());
		const Component = () => null;
		const columns: ColumnDef<unknown>[] = [{ field: 'a', header: 'A', renderer: { kind: 'react', component: Component } }];
		model.updateColumns(columns, {});
		const first = instanceIdOf(model, 'a');

		model.updateColumns([{ field: 'a', header: 'A', renderer: { kind: 'react', component: Component } }], {});
		const second = instanceIdOf(model, 'a');
		expect(second).toBe(first);
	});

	it('same field, different renderer component reference — instanceId changes (semantic replacement)', () => {
		const model = new ColumnModel(makeRuntime());
		const ComponentA = () => null;
		const ComponentB = () => null;
		model.updateColumns([{ field: 'a', header: 'A', renderer: { kind: 'react', component: ComponentA } }], {});
		const first = instanceIdOf(model, 'a');

		model.updateColumns([{ field: 'a', header: 'A', renderer: { kind: 'react', component: ComponentB } }], {});
		const second = instanceIdOf(model, 'a');
		expect(second).not.toBe(first);
	});

	it('same field, text renderer swapped for a custom renderer — instanceId changes', () => {
		const model = new ColumnModel(makeRuntime());
		model.updateColumns([{ field: 'a', header: 'A' }], {});
		const first = instanceIdOf(model, 'a');

		const Component = () => null;
		model.updateColumns([{ field: 'a', header: 'A', renderer: { kind: 'react', component: Component } }], {});
		const second = instanceIdOf(model, 'a');
		expect(second).not.toBe(first);
	});

	it('same field, different valueGetter reference — instanceId changes', () => {
		const model = new ColumnModel(makeRuntime());
		const getterA = () => 1;
		const getterB = () => 2;
		model.updateColumns([{ field: 'a', header: 'A', valueGetter: getterA }], {});
		const first = instanceIdOf(model, 'a');

		model.updateColumns([{ field: 'a', header: 'A', valueGetter: getterB }], {});
		const second = instanceIdOf(model, 'a');
		expect(second).not.toBe(first);
	});

	it('field removed then re-added — instanceId is never reused', () => {
		const model = new ColumnModel(makeRuntime());
		model.updateColumns(
			[
				{ field: 'a', header: 'A' },
				{ field: 'b', header: 'B' },
			],
			{}
		);
		const firstA = instanceIdOf(model, 'a');

		// 'a' removed
		model.updateColumns([{ field: 'b', header: 'B' }], {});
		expect(instanceIdOf(model, 'a')).toBeUndefined();

		// 'a' re-added
		model.updateColumns(
			[
				{ field: 'a', header: 'A' },
				{ field: 'b', header: 'B' },
			],
			{}
		);
		const secondA = instanceIdOf(model, 'a');
		expect(secondA).toBeTruthy();
		expect(secondA).not.toBe(firstA);
	});

	it('every column gets a distinct instanceId, even across identical-looking definitions', () => {
		const model = new ColumnModel(makeRuntime());
		model.updateColumns(
			[
				{ field: 'a', header: 'Same Header' },
				{ field: 'b', header: 'Same Header' },
			],
			{}
		);
		expect(instanceIdOf(model, 'a')).not.toBe(instanceIdOf(model, 'b'));
	});
});

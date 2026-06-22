import { describe, it, expect, vi } from 'vitest';
import { ValidationManager } from './ValidationManager.js';
import type { ValidationManagerDeps } from './ValidationManager.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

interface TestRow {
	id: string;
	name: string;
	age: number;
	email: string;
}

const ROWS: TestRow[] = [
	{ id: '1', name: 'Alice', age: 30, email: 'alice@example.com' },
	{ id: '2', name: '', age: -5, email: 'not-an-email' },
	{ id: '3', name: 'Bob', age: 25, email: 'bob@example.com' },
];

function makeStore(overrides?: Partial<Parameters<typeof GridStore>[0]>): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: [
			{
				field: 'name',
				header: 'Name',
				valueValidator: async ({ value }) => {
					// explicit async to avoid sync/microtask edge-cases in tests
					await Promise.resolve();
					return !value ? 'Name is required' : null;
				},
			},
			{
				field: 'age',
				header: 'Age',
				valueValidator: async ({ value }) => {
					await Promise.resolve();
					const n = Number(value);
					if (isNaN(n) || n < 0) return 'Age must be a non-negative number';
					return null;
				},
			},
			{
				field: 'email',
				header: 'Email',
				valueValidator: async ({ value }) => {
					await Promise.resolve();
					return String(value).includes('@') ? null : 'Invalid email address';
				},
			},
		],
		getRowId: (row) => row.id,
		...overrides,
	});
}

function makeController(store: GridStore<TestRow>): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: ROWS,
		columns: store.getState().columns,
	});
}

function makeValidationManager(store: GridStore<TestRow>): ValidationManager<TestRow> {
	const engine = (store as any).engine;
	return new ValidationManager<TestRow>({
		ctx: {
			columns: engine.columns,
			getState: () => engine.stateManager.getState(),
			applyChange: (change) => engine.changeApplier.apply(change),
		},
		getRowModel: () => engine.getRowModel(),
		data: engine.data,
	});
}

describe('ValidationManager', () => {
	describe('validateCell', () => {
		it('returns null and sets no error for a valid cell', async () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const vm = makeValidationManager(store);

			const error = await vm.validateCell('1', 'name');
			expect(error).toBeNull();
			expect(store.getState().validationErrors).toBeUndefined();

			ctrl.dispose();
			store.destroy();
		});

		it('returns error string and sets validationErrors state for an invalid cell', async () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const vm = makeValidationManager(store);

			const error = await vm.validateCell('2', 'name');
			expect(error).toBe('Name is required');
			expect(store.getState().validationErrors?.['2:name']).toBe('Name is required');

			ctrl.dispose();
			store.destroy();
		});

		it('handles async validators', async () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const vm = makeValidationManager(store);

			const error = await vm.validateCell('2', 'email');
			expect(error).toBe('Invalid email address');
			expect(store.getState().validationErrors?.['2:email']).toBe('Invalid email address');

			ctrl.dispose();
			store.destroy();
		});

		it('clears a previous error when cell becomes valid', async () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const vm = makeValidationManager(store);

			// First set an error
			await vm.validateCell('2', 'name');
			expect(store.getState().validationErrors?.['2:name']).toBe('Name is required');

			// Fix the value and revalidate
			store.setCellValue('2', 'name', 'Charlie');
			const error = await vm.validateCell('2', 'name');
			expect(error).toBeNull();
			expect(store.getState().validationErrors?.['2:name']).toBeUndefined();

			ctrl.dispose();
			store.destroy();
		});

		it('fires cellValidationChanged event', async () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const vm = makeValidationManager(store);
			const listener = vi.fn();
			store.addEventListener(GridEventName.cellValidationChanged, listener);

			await vm.validateCell('2', 'age');
			expect(listener).toHaveBeenCalledOnce();
			expect(listener.mock.calls[0][0].payload).toMatchObject({
				rowId: '2',
				colField: 'age',
				error: 'Age must be a non-negative number',
			});

			ctrl.dispose();
			store.destroy();
		});

		it('returns null for a column with no validator', async () => {
			const store = new GridStore<TestRow>({
				columns: [{ field: 'name', header: 'Name' }],
				getRowId: (r) => r.id,
			});
			const ctrl = makeController(store);
			const vm = makeValidationManager(store);

			const error = await vm.validateCell('1', 'name');
			expect(error).toBeNull();

			ctrl.dispose();
			store.destroy();
		});
	});
});

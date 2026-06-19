import { describe, it, expect, vi } from 'vitest';
import { StateManager } from './StateManager.js';
import type { InternalGridState } from './GridState.js';

type TestState = Pick<InternalGridState, 'defaultRowHeight' | 'defaultColWidth' | 'globalVersion'>;

function makeManager(initial?: Partial<TestState>) {
	return new StateManager<unknown>({
		defaultRowHeight: 40,
		defaultColWidth: 100,
		globalVersion: 0,
		...initial,
	} as InternalGridState<unknown>);
}

describe('StateManager.transaction()', () => {
	it('defers notifications until the outer transaction commits', () => {
		const mgr = makeManager();
		const listener = vi.fn();
		mgr.subscribe(listener);

		mgr.transaction(() => {
			mgr.setState({ defaultRowHeight: 50 });
			mgr.setState({ defaultColWidth: 120 });
			expect(listener).not.toHaveBeenCalled();
		});

		expect(listener).toHaveBeenCalledTimes(1);
		expect(mgr.getState().defaultRowHeight).toBe(50);
		expect(mgr.getState().defaultColWidth).toBe(120);
	});

	it('supports nested transactions — commits once at the outermost boundary', () => {
		const mgr = makeManager();
		const listener = vi.fn();
		mgr.subscribe(listener);

		mgr.transaction(() => {
			mgr.setState({ defaultRowHeight: 50 });
			mgr.transaction(() => {
				mgr.setState({ defaultColWidth: 120 });
				expect(listener).not.toHaveBeenCalled();
			});
			// Inner committed but outer still open — no notification yet
			expect(listener).not.toHaveBeenCalled();
		});

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('calls endTransaction even when work throws', () => {
		const mgr = makeManager();
		const listener = vi.fn();
		mgr.subscribe(listener);

		expect(() => {
			mgr.transaction(() => {
				mgr.setState({ defaultRowHeight: 50 });
				throw new Error('intentional');
			});
		}).toThrow('intentional');

		// Manager must not be stuck in batching mode — subsequent setState should fire immediately
		mgr.setState({ defaultColWidth: 120 });
		expect(listener).toHaveBeenCalledTimes(2); // one from the failed tx + one from the direct set
	});

	it('does not notify when no state changes occur inside the transaction', () => {
		const mgr = makeManager();
		const listener = vi.fn();
		mgr.subscribe(listener);

		mgr.transaction(() => {
			// No setState calls
		});

		expect(listener).not.toHaveBeenCalled();
	});

	it('returns the value produced by work', () => {
		const mgr = makeManager();
		const result = mgr.transaction(() => 42);
		expect(result).toBe(42);
	});

	it('restores non-batching mode after a nested transaction throws', () => {
		const mgr = makeManager();

		mgr.transaction(() => {
			expect(() => {
				mgr.transaction(() => {
					throw new Error('inner error');
				});
			}).toThrow('inner error');
			// Outer transaction is still active — state manager must still be in batching mode
			// but depth correctly restored to 1 (not 0)
			mgr.setState({ defaultRowHeight: 99 }); // should batch, not notify immediately
		});

		// After outer commits, the value is visible
		expect(mgr.getState().defaultRowHeight).toBe(99);
	});
});

describe('StateManager.startTransaction / endTransaction (legacy pair API)', () => {
	it('batches updates and notifies once at endTransaction', () => {
		const mgr = makeManager();
		const listener = vi.fn();
		mgr.subscribe(listener);

		mgr.startTransaction();
		mgr.setState({ defaultRowHeight: 50 });
		mgr.setState({ defaultColWidth: 120 });
		expect(listener).not.toHaveBeenCalled();
		mgr.endTransaction();

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('startTransaction is idempotent for depth-zero entry (no double-commit)', () => {
		const mgr = makeManager();
		const listener = vi.fn();
		mgr.subscribe(listener);

		mgr.startTransaction();
		mgr.startTransaction(); // second call increments depth
		mgr.setState({ defaultRowHeight: 50 });
		mgr.endTransaction(); // depth 2 → 1; no commit yet
		expect(listener).not.toHaveBeenCalled();
		mgr.endTransaction(); // depth 1 → 0; commits
		expect(listener).toHaveBeenCalledTimes(1);
	});
});

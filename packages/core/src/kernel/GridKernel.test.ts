import { describe, expect, it } from 'vitest';
import { GridKernel } from './GridKernel.js';
import { handlerApplied, handlerNoop, handlerRejected } from './GridCommit.js';
import type { GridEvent } from './GridEvent.js';

describe('GridKernel — command result semantics (ARCHITECTURE.md §3 R2)', () => {
	it('rejects a command with no registered handler — never a silent no-op', () => {
		const kernel = new GridKernel();
		const result = kernel.dispatch({ type: 'does.notExist', payload: {} });
		expect(result.status).toBe('rejected');
		if (result.status === 'rejected') {
			expect(result.reason).toContain('no handler');
		}
	});

	it('applied returns a commit id and a version-bump effect per dirty domain', () => {
		const kernel = new GridKernel();
		kernel.register('rows.touch', () => handlerApplied({ dirtyDomains: ['rows', 'pipeline'] }));

		const result = kernel.dispatch({ type: 'rows.touch', payload: {} });
		expect(result.status).toBe('applied');
		if (result.status !== 'applied') return;

		expect(result.commitId).toMatch(/^commit:\d+$/);
		const bumps = result.effects.filter((e) => e.kind === 'version-bump');
		expect(bumps.map((b) => (b.kind === 'version-bump' ? b.domain : null))).toEqual(['rows', 'pipeline']);
		expect(kernel.getVersion('rows')).toBe(1);
		expect(kernel.getVersion('pipeline')).toBe(1);
		expect(kernel.getVersion('columns')).toBe(0);
	});

	it('noop produces no version bump and no domain event', () => {
		const kernel = new GridKernel();
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));
		kernel.register('rows.maybe', () => handlerNoop('nothing changed'));

		const result = kernel.dispatch({ type: 'rows.maybe', payload: {} });
		expect(result.status).toBe('noop');
		expect(kernel.getVersion('rows')).toBe(0);
		expect(events).toHaveLength(0);
	});

	it('rejected (from handler) is not collapsed into noop and publishes grid.commandRejected', () => {
		const kernel = new GridKernel();
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));
		kernel.register('rows.bad', () => handlerRejected('unsupported on this row model'));

		const result = kernel.dispatch({ type: 'rows.bad', payload: {} });
		expect(result.status).toBe('rejected');
		expect(events).toHaveLength(1);
		expect(events[0]!.type).toBe('grid.commandRejected');
		expect(events[0]!.commitId).toBeNull();
	});

	it('a throwing handler becomes a rejected result, not an unhandled crash', () => {
		const kernel = new GridKernel();
		kernel.register('rows.throws', () => {
			throw new Error('boom');
		});
		const result = kernel.dispatch({ type: 'rows.throws', payload: {} });
		expect(result.status).toBe('rejected');
		if (result.status === 'rejected') {
			expect(result.reason).toBe('boom');
			expect(result.error).toBeInstanceOf(Error);
		}
	});
});

describe('GridKernel — events and publication (ARCHITECTURE.md §3 R1)', () => {
	it('stamps handler event drafts with the commit id and appends grid.commandApplied', () => {
		const kernel = new GridKernel();
		const events: GridEvent[] = [];
		kernel.subscribe((e) => events.push(e));
		kernel.register('test.replace', () =>
			handlerApplied({ dirtyDomains: ['rows'], events: [{ type: 'rows.replaced', payload: { count: 3 } }] }),
		);

		const result = kernel.dispatch({ type: 'test.replace', payload: {} });
		expect(result.status).toBe('applied');
		const commitId = result.status === 'applied' ? result.commitId : '';

		expect(events.map((e) => e.type)).toEqual(['rows.replaced', 'grid.commandApplied']);
		expect(events.every((e) => e.commitId === commitId)).toBe(true);
	});

	it('register rejects a duplicate handler for the same command type', () => {
		const kernel = new GridKernel();
		kernel.register('x.y', () => handlerNoop('a'));
		expect(() => kernel.register('x.y', () => handlerNoop('b'))).toThrow(/already has a handler/);
	});
});

describe('GridKernel — undo/redo foundation', () => {
	it('records an undo patch from an applied commit and replays it through dispatch', () => {
		const kernel = new GridKernel();
		const seen: Array<{ value: unknown; source?: string }> = [];
		kernel.register('cell.set', (command) => {
			const payload = command.payload as { value: unknown };
			seen.push({ value: payload.value, source: command.meta?.source });
			return handlerApplied({
				dirtyDomains: ['cells'],
				undoPatch: {
					label: 'set value',
					undo: { type: 'cell.set', payload: { value: 'old' } },
					redo: { type: 'cell.set', payload: { value: 'new' } },
				},
			});
		});

		expect(kernel.canUndo()).toBe(false);
		kernel.dispatch({ type: 'cell.set', payload: { value: 'new' } });
		expect(kernel.canUndo()).toBe(true);
		expect(kernel.canRedo()).toBe(false);

		const undoResult = kernel.undo();
		expect(undoResult.status).toBe('applied');
		expect(kernel.canRedo()).toBe(true);
		// the undo replay dispatched the patch's `undo` command, tagged source 'undo'
		expect(seen).toEqual([
			{ value: 'new', source: undefined },
			{ value: 'old', source: 'undo' },
		]);
	});

	it('undo on an empty stack is a noop, not a rejection', () => {
		const kernel = new GridKernel();
		expect(kernel.undo().status).toBe('noop');
		expect(kernel.redo().status).toBe('noop');
	});
});

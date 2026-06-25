import { handlerApplied, handlerNoop, handlerRejected } from '../../kernel/GridCommit.js';
import type { GridCommitDraft } from '../../kernel/GridCommit.js';
import type { GridKernel } from '../../kernel/GridKernel.js';
import type { CellAddress } from '../cells/CellAddress.js';
import { appliedCellWriteDraft } from '../cells/CellCommands.js';
import type { CellCommandHost, CellCommandOptions } from '../cells/CellCommands.js';
import type { CellValueEngine } from '../cells/CellValueEngine.js';
import type { EditModel } from './EditModel.js';

declare module '../../kernel/GridCommand.js' {
	interface GridCommandPayloads {
		'editing.start': { readonly address: CellAddress; readonly initialValue?: unknown };
		'editing.updateDraft': { readonly value: unknown };
		'editing.cancel': Record<string, never>;
		'editing.commit': Record<string, never>;
	}
}

/**
 * Register the editing transaction commands on the kernel (ARCHITECTURE.md §3 R1, R10). Editing is
 * a transaction: `start → updateDraft → commit/cancel`. `commit` delegates the actual write to the
 * shared {@link CellValueEngine} and reuses the exact `cell.setValue` commit mapping — value
 * semantics live in one place (R8). `commit` is capability-gated on `cellMutation`.
 *
 * @returns an unregister-all function.
 */
export function registerEditingCommands<TRow>(
	kernel: GridKernel,
	host: CellCommandHost,
	model: EditModel,
	engine: CellValueEngine<TRow>,
	options: CellCommandOptions<TRow> = {}
): () => void {
	const off: Array<() => void> = [];

	off.push(
		kernel.register('editing.start', (command, ctx) => {
			const { address } = command.payload;
			const initialValue = 'initialValue' in command.payload ? command.payload.initialValue : engine.getRawValue(address);
			const session = model.start(ctx.nextId('edit'), address, initialValue);
			return handlerApplied({
				dirtyDomains: ['editing'],
				events: [{ type: 'editing.started', payload: { editId: session.id, rowId: address.rowId, columnId: address.columnId } }],
				renderInvalidation: { scope: 'cells', domains: ['editing'] },
			});
		})
	);

	off.push(
		kernel.register('editing.updateDraft', (command) => {
			const session = model.updateDraft(command.payload.value);
			if (!session) return handlerRejected('no active edit session to update');
			return handlerApplied({
				dirtyDomains: ['editing'],
				renderInvalidation: { scope: 'cells', domains: ['editing'] },
			});
		})
	);

	off.push(
		kernel.register('editing.cancel', () => {
			const closed = model.close('cancelled');
			if (!closed) return handlerNoop('no active edit session to cancel');
			return handlerApplied({
				dirtyDomains: ['editing'],
				events: [{ type: 'editing.cancelled', payload: { editId: closed.id } }],
				renderInvalidation: { scope: 'cells', domains: ['editing'] },
			});
		})
	);

	off.push(
		kernel.register('editing.commit', () => {
			const active = model.getActive();
			if (!active || active.status !== 'active') return handlerNoop('no active edit session to commit');

			if (!host.capabilities.cellMutation) {
				model.close('rejected');
				return handlerRejected(`"cellMutation" unsupported by "${host.type}" row model`);
			}

			const valueSetter = options.resolveValueSetter?.(active.cell.columnId);
			const outcome = engine.applyCellValue(active.cell, active.draftValue, valueSetter ? { valueSetter } : {});

			if (outcome.status === 'rejected') {
				model.close('rejected');
				return handlerRejected(outcome.reason);
			}

			const closed = model.close('committed')!;
			const committedEvent = {
				type: 'editing.committed' as const,
				payload: { editId: closed.id, rowId: active.cell.rowId, columnId: active.cell.columnId },
			};

			if (outcome.status === 'applied') {
				const base = appliedCellWriteDraft(outcome, active.cell);
				const merged: GridCommitDraft = {
					...base,
					dirtyDomains: [...base.dirtyDomains, 'editing'],
					events: [...(base.events ?? []), committedEvent],
				};
				return handlerApplied(merged);
			}

			// committed with no value change (unchanged / declined / aborted): the session still closes.
			return handlerApplied({
				dirtyDomains: ['editing'],
				events: [committedEvent],
				renderInvalidation: { scope: 'cells', domains: ['editing'] },
			});
		})
	);

	return () => {
		for (const fn of off) fn();
	};
}
